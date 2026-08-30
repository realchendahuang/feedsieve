import type { Detection, DetectionSource } from './types';
import { DEFAULT_HEURISTICS, type HeuristicRule } from './heuristics';
import {
  contentFingerprint,
  fingerprintText,
} from './fingerprint';
import {
  SIMHASH_HAMMING_THRESHOLD,
  hammingDistance,
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
      // exact 优先（v0.4 行为）：同一模板精确出现，直接命中
      const fp = contentFingerprint({ text });
      if (fp && options.fingerprints?.has(fp)) {
        return {
          handle,
          marked: true,
          source: 'fingerprint',
          reason: '已知垃圾模板 · 社区指纹命中',
          ruleId: 'community-fingerprint',
          matchedFingerprint: fp,
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
    } catch {
      // 单条规则异常不拖垮整个检测
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
 */
function findNearSimhash(
  text: string,
  simhashes: ReadonlySet<string>,
): string | null {
  const local = fingerprintText(text);
  if (!local) {
    return null;
  }
  const localBits = simhashFromHex(local);
  if (localBits === null) {
    return null;
  }
  let nearest: string | null = null;
  let nearestDist = SIMHASH_HAMMING_THRESHOLD + 1;
  for (const known of simhashes) {
    const knownBits = simhashFromHex(known);
    if (knownBits === null) {
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
