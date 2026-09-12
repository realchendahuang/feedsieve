import type { Detection, DetectionSource } from './types';
import { DEFAULT_HEURISTICS, type HeuristicRule } from './heuristics';
import {
  contentFingerprint,
  contentFingerprintV1,
  fingerprintText,
  fingerprintTextV1,
} from './fingerprint';
import {
  SIMHASH_HAMMING_THRESHOLD,
  hammingDistance,
  isSimhashV1,
  simhashFromHex,
} from './simhash';

export function normalizeHandle(handle: string): string {
  return handle.trim().replace(/^@+/, '').toLowerCase();
}

/** Detector 的最小输入（x-adapter 的 FeedItem 结构上天然满足）。 */
export interface DetectInput {
  /** 必需：handle 是 MVP 唯一稳定身份字段（冻结决策 #8）。 */
  handle: string;
  displayName?: string;
  text?: string;
  /** 账号简介。XHR 桥可稳定提供（PureTwitter 证明垃圾号常在 bio 埋话术）。 */
  bio?: string;
  /** hostname 由 Reader 预先解析好，Detector 不做 URL 解析。 */
  links?: ReadonlyArray<{ href: string; hostname?: string; display?: string }>;
  /**
   * 官方词库已佐证（调用方显式注入）。历史设计是「keyword:*official* 规则
   * 命中后循环内向前传播」，但因为启发式命中即 return，后续规则永远吃不到
   * 这个 flag，生产管线也会在 keyword 命中时直接返回——它从未真正生效。
   * 现在只作为评测层输入：corpus 用例用手工注入表达「词库先命中」的场景。
   */
  keywordCorroborated?: boolean;
}

/** 名单条目的最小形状：协议里只有 handle 是必需的。 */
export type ListEntryLike = string | { handle: string };

/**
 * 把名单条目归一化成查询集合。
 * 接受字符串数组或 community/lists/*.json 的 entries 数组。
 */
export function toHandleSet(entries: Iterable<ListEntryLike>): Set<string> {
  const set = new Set<string>();
  for (const entry of entries) {
    const handle = typeof entry === 'string' ? entry : entry.handle;
    if (typeof handle === 'string') {
      const normalized = normalizeHandle(handle);
      if (normalized) {
        set.add(normalized);
      }
    }
  }
  return set;
}

export interface DetectorOptions {
  /** 名单查询集合（内置快照或社区快照，本地查询，绝不在滚动时请求服务器）。 */
  list?: ReadonlySet<string>;
  /** 名单来源会出现在标注理由里；默认按社区名单处理。 */
  listSource?: Extract<DetectionSource, 'builtin-list' | 'community-list'>;
  /**
   * 社区快照下发的已知垃圾模板指纹集合（v0.4）。
   * 间接证据，默认只在「大扫除」强度档传入（门槛在扩展接线层）。
   */
  fingerprints?: ReadonlySet<string>;
  /**
   * 社区快照下发的已知垃圾模板 SimHash 位向量集合（v0.5 Campaign）。
   * 精确指纹 miss 时，按汉明距离 <= SIMHASH_HAMMING_THRESHOLD 判「话术变体」。
   * 门槛同指纹（只在大扫除档启用，扩展接线层收口）。
   */
  simhashes?: ReadonlySet<string>;
  /** 社区快照下发的垃圾外链域名集合（v0.4，同上按强度档启用）。 */
  domains?: ReadonlySet<string>;
  /** 启发式集合；默认 DEFAULT_HEURISTICS。传 [] 可只跑名单/指纹/域名。 */
  heuristics?: readonly HeuristicRule[];
}

/**
 * 统一检测管线：名单优先 -> 社区指纹(exact) -> 话术变体(simhash) -> 社区域名
 * -> 启发式按序 -> 全部未命中返回 null。
 *
 * 返回的每个 Detection 都带 source / reason / ruleId，满足「标注必须可解释」。
 * 干净账号返回 null（不产出任何 UI）。
 */
export function detect(
  input: DetectInput,
  options: DetectorOptions = {},
): Detection | null {
  const handle = normalizeHandle(input.handle);
  if (!handle) {
    return null;
  }

  if (options.list?.has(handle)) {
    return {
      handle,
      marked: true,
      source: options.listSource ?? 'community-list',
      reason: '名单命中',
      ruleId: 'list',
    };
  }

  if (options.simhashes?.size || options.fingerprints?.size) {
    const text = input.text?.trim() ? input.text : input.bio;
    if (text) {
      // exact 优先（v0.4 行为）：同一模板精确出现，直接命中。
      // v0/v1 指纹值同为 16 位 hex、字符串级匹配天然版本敏感，
      // 两个版本塞同一个 Set 也能正确区分（v1 值恒以 '3' 开头）。
      const fpV0 = contentFingerprint({ text });
      const fpV1 = contentFingerprintV1({ text });
      const exactHit =
        (fpV0 && options.fingerprints?.has(fpV0) && fpV0) ||
        (fpV1 && options.fingerprints?.has(fpV1) && fpV1) ||
        null;
      if (exactHit) {
        return {
          handle,
          marked: true,
          source: 'fingerprint',
          reason: '已知垃圾模板 · 社区指纹命中',
          ruleId: 'community-fingerprint',
          matchedFingerprint: exactHit,
        };
      }
      // 模糊兜底（v0.5）：精确集合 miss 时，按汉明距离找同模板的「换词变体」
      if (options.simhashes?.size) {
        const hit = findNearSimhash(text, options.simhashes);
        if (hit) {
          return {
            handle,
            marked: true,
            source: 'fingerprint',
            reason: '已知垃圾模板 · 话术变体（SimHash）',
            ruleId: 'community-fingerprint-sim',
            matchedFingerprint: hit,
          };
        }
      }
    }
  }

  if (options.domains?.size) {
    for (const link of input.links ?? []) {
      if (link.hostname && options.domains.has(link.hostname.toLowerCase())) {
        const hostname = link.hostname.toLowerCase();
        return {
          handle,
          marked: true,
          source: 'domain',
          reason: `链接指向社区名单域名（${hostname}）`,
          ruleId: 'community-domain',
        };
      }
    }
  }

  const heuristics = options.heuristics ?? DEFAULT_HEURISTICS;
  for (const rule of heuristics) {
    let matched: string | null;
    try {
      matched = rule.check({ ...input, handle });
    } catch (error) {
      // 单条规则异常不拖垮整个检测，但必须留痕：一条线上必炸的规则静默消失
      // 等于无声漏报。detection-log 不记异常，console 是唯一痕迹。
      console.warn(`[detector] heuristic ${rule.id} threw`, error);
      continue;
    }
    if (matched) {
      return {
        handle,
        marked: true,
        source: 'heuristic',
        reason: `启发式：${matched}`,
        ruleId: rule.id,
      };
    }
  }

  return null;
}

/**
 * 在 simhash 集合里找当前文本的「话术变体」：
 * 当前文本的位向量与某个已知模板的距离 <= 阈值即命中。
 * 集合/文本都不产位向量时返回 null（静默，与 exact 路径同语义）。
 *
 * v0.8 双版本：v1 算法空间与 v0 不同（NFKC + 停用字 + 新哈希 + 版本位），
 * 距离只在同版本模板内计算——本地同时产 v0/v1 指纹，
 * v0 指纹只与非 '3' 开头的模板比，v1 指纹只与 '3' 开头的模板比。
 * 生产 v0 值实测全部 'f' 开头（旧哈希高位坍缩），与 v1 的 '3' 前缀零重叠；
 * 假想的 '3' 开头 v0 旧值与 v1 距离属不同哈希族的伪随机值，阈值 2 必然拒绝。
 */
/**
 * 已知模板 hex→位向量的解析结果按集合缓存：指纹集有数千条，deep_clean
 * 下每条 miss 推文都会整集遍历，每次重新 parse hex 是纯浪费。
 * WeakMap 挂在集合对象上——快照更新产生新 Set 时自然失效。
 */
const SIMHASH_BITS_CACHE = new WeakMap<ReadonlySet<string>, Map<string, ReturnType<typeof simhashFromHex>>>();

function knownSimhashBits(simhashes: ReadonlySet<string>): Map<string, ReturnType<typeof simhashFromHex>> {
  let parsed = SIMHASH_BITS_CACHE.get(simhashes);
  if (!parsed) {
    parsed = new Map();
    SIMHASH_BITS_CACHE.set(simhashes, parsed);
  }
  return parsed;
}

function findNearSimhash(text: string, simhashes: ReadonlySet<string>): string | null {
  const localV0 = fingerprintText(text);
  const localV1 = fingerprintTextV1(text);
  const localBitsV0 = localV0 ? simhashFromHex(localV0) : null;
  const localBitsV1 = localV1 ? simhashFromHex(localV1) : null;
  const parsedBits = knownSimhashBits(simhashes);

  let nearest: string | null = null;
  let nearestDist = SIMHASH_HAMMING_THRESHOLD + 1;
  for (const known of simhashes) {
    if (!localBitsV0 && !localBitsV1) {
      break;
    }
    let knownBits = parsedBits.get(known);
    if (knownBits === undefined) {
      knownBits = simhashFromHex(known);
      parsedBits.set(known, knownBits);
      if (parsedBits.size > 100_000) parsedBits.clear(); // 环形保鲜，不熬内存
    }
    if (knownBits === null) {
      continue;
    }
    const localBits = isSimhashV1(known) ? localBitsV1 : localBitsV0;
    if (localBits === null) {
      continue;
    }
    const dist = hammingDistance(localBits, knownBits);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = known;
    }
  }
  return nearestDist <= SIMHASH_HAMMING_THRESHOLD ? nearest : null;
}
