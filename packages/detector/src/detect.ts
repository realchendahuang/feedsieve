import type { Detection, DetectionSource } from './types';
import { DEFAULT_HEURISTICS, type HeuristicRule } from './heuristics';

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
  /** 启发式集合；默认 DEFAULT_HEURISTICS。传 [] 可只跑名单。 */
  heuristics?: readonly HeuristicRule[];
}

/**
 * 统一检测管线：名单优先 -> 启发式按序 -> 全部未命中返回 null。
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
