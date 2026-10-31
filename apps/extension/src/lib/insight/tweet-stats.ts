/**
 * 本标签页的推文指标与作者统计（内存，不持久化，不上传）。
 *
 * 数据来自 MAIN-world 桥解析的 GraphQL 响应（已过 sanitizeBridgePayload）。
 * 同一条推文会随 X 的时间线轮询反复出现，每次都记一个浏览量观测点，
 * 两个观测点间隔够长时，流速改用差分计算（见 @feedsieve/metrics velocityPerHour）。
 */
import {
  accountTier,
  ageHours,
  breakoutRatio,
  heatScore,
  isColdStartWindow,
  projectedViews,
  replyOpportunity,
  resolveConfig,
  TIER_LEVELS,
  velocityPerHour,
  viralScore,
  type AccountTier,
  type MetricsConfig,
  type ReplyOpportunity,
  type ViewObservation,
} from '@feedsieve/metrics';
import { detect, HOT_LIST_HEURISTICS } from '@feedsieve/detector';
import type { SanitizedAuthorStat, SanitizedTweetStat } from '../platform/xhr-bridge-guard';

/** 内存上限：长时间刷推时按最早写入的条目淘汰。 */
const MAX_TWEETS = 3_000;
const MAX_AUTHORS = 3_000;
const MAX_SEEN = 3_000;
/**
 * 进出热帖列表的缓冲：到门槛才进，跌破门槛的 70% 才出。
 * 单个观测点的流速是模型推算的，会小幅波动；不加缓冲，门槛附近的帖子会时进时出。
 */
export const HOT_EXIT_RATIO = 0.7;
/** 按圈子调门槛：达到默认门槛的帖子少于这么多条、且样本够多时，改用本地流速分位数。 */
const ADAPTIVE_MIN_HOT = 5;
const ADAPTIVE_MIN_SAMPLES = 20;
const ADAPTIVE_QUANTILE = 0.9;
/** 自动调低也不低于这个流速（浏览/小时）。 */
export const ADAPTIVE_FLOOR_PER_HOUR = 300;

/**
 * 热帖门槛（浏览/小时）：默认 base（「火了」）；刷到的帖子普遍冷清、够门槛的不到 5 条时，
 * 取最近刷到的帖子里流速前 10% 的那条线，夹在 [ADAPTIVE_FLOOR_PER_HOUR, base] 之间。
 */
export function hotThreshold(velocities: readonly number[], base: number): number {
  if (velocities.length < ADAPTIVE_MIN_SAMPLES) return base;
  if (velocities.filter((v) => v >= base).length >= ADAPTIVE_MIN_HOT) return base;
  const sorted = [...velocities].sort((a, b) => a - b);
  const line = sorted[Math.floor(sorted.length * ADAPTIVE_QUANTILE)]!;
  return Math.min(base, Math.max(ADAPTIVE_FLOOR_PER_HOUR, line));
}
/** 差分基准点最多保留这么久，之后滚动到上一次观测，让流速反映最近的速度。 */
const ANCHOR_ROLL_MS = 60 * 60 * 1000;
/** 单个标签页的热帖窗口：只看最近这么久内出现过的推文。 */
export const HOT_WINDOW_MS = 30 * 60 * 1000;
/** 跨标签页共享的热帖窗口：弹窗里的热帖看最近 2 小时在所有 X 标签页刷到的帖子。 */
export const SHARED_HOT_WINDOW_MS = 2 * 60 * 60 * 1000;
export const HOT_LIST_LIMIT = 20;
/** 跨标签页共享的热帖列表上限：弹窗分批显示，滚到底自动加载更多。 */
export const SHARED_HOT_LIST_LIMIT = 200;

export interface TweetEntry {
  stat: SanitizedTweetStat;
  latest: ViewObservation | null;
  anchor: ViewObservation | null;
  lastSeenAt: number;
}

/**
 * 不进热帖的帖子：X 标了可能敏感（多为成人图片/视频），或正文、昵称是黄推 / 联系方式引流话术
 * （和全站热榜出榜前用同一组规则）。
 */
export function isHotListExcluded(stat: SanitizedTweetStat): boolean {
  if (stat.sensitive === true) return true;
  return (
    detect(
      {
        handle: stat.handle,
        ...(stat.displayName ? { displayName: stat.displayName } : {}),
        ...(stat.snippet ? { text: stat.snippet } : {}),
      },
      { heuristics: HOT_LIST_HEURISTICS },
    ) !== null
  );
}

export interface AuthorEntry {
  followers?: number;
  followingCount?: number;
  tweets?: number;
  createdAt?: number;
}

export interface TweetInsight {
  postId: string;
  handle: string;
  /** 原创 / 回复 / 引用；主页上的倍数只给非回复的帖子算。 */
  kind?: SanitizedTweetStat['kind'];
  displayName?: string;
  avatarUrl?: string;
  verified?: boolean;
  snippet?: string;
  mediaUrl?: string;
  lang?: string;
  createdAt?: number;
  /** 第一次出现在用户屏幕上的时刻（「最近刷到」排序用）；X 预加载了但还没滑到的没有。 */
  seenAt?: number;
  views?: number;
  likes?: number;
  retweets?: number;
  replies?: number;
  quotes?: number;
  bookmarks?: number;
  followers?: number;
  /** 浏览/小时；算不出来为 null。 */
  velocity: number | null;
  breakout: number | null;
  heat: number | null;
  /** 发帖后小时数。 */
  ageHours?: number;
  /** 预计 24 小时浏览（X 热门帖子同款公式）。 */
  projected: number | null;
  /** 处在 X 冷启动试水期。 */
  coldStart: boolean;
  /** 爆帖指数 0–100。 */
  viral: number | null;
  /** 回复机会；窗口已过为 null。 */
  opportunity: ReplyOpportunity | null;
}

/**
 * heat 热度；opportunity 回复机会；followers 作者粉丝数；bookmarks 收藏数；
 * recent 最近刷到（按第一次出现在屏幕上的时刻，刚滑到的在前；只有「我刷到的」有）；
 * day 24 小时（全站热榜的第二个榜：24 小时内发布的帖子按浏览数；只有「全站」有）。
 */
export type HotSort = 'heat' | 'day' | 'opportunity' | 'followers' | 'bookmarks' | 'recent';
export const HOT_SORTS: readonly HotSort[] = [
  'heat',
  'day',
  'opportunity',
  'followers',
  'bookmarks',
  'recent',
];

export function isHotSort(value: unknown): value is HotSort {
  return typeof value === 'string' && (HOT_SORTS as readonly string[]).includes(value);
}

/** 各排序方式的排序键（越大越靠前）；缺数据的排到最后。 */
export function hotSortKey(
  item: {
    heat: number | null;
    opportunity: { score: number } | null;
    followers?: number;
    bookmarks?: number;
    seenAt?: number;
    views?: number;
  },
  sort: HotSort,
): number {
  switch (sort) {
    case 'heat':
      return item.heat ?? -1;
    case 'day':
      return item.views ?? -1;
    case 'opportunity':
      return item.opportunity?.score ?? -1;
    case 'followers':
      return item.followers ?? -1;
    case 'bookmarks':
      return item.bookmarks ?? -1;
    case 'recent':
      return item.seenAt ?? -1;
  }
}

export interface PageBrief {
  /** 最近 30 分钟见过的推文数。 */
  seen: number;
  /** 去重后的作者数。 */
  authors: number;
  /** 达到当前热帖门槛的推文数（和热帖列表同一个口径）。 */
  hot: number;
  /** 当前热帖门槛（浏览/小时）；冷清时会自动调低。 */
  threshold: number;
  /** 流速中位数（浏览/小时）。 */
  medianVelocity: number | null;
  /** 破圈倍数最高的一条。 */
  topBreakout: { ratio: number; handle: string; postId: string } | null;
  /** 作者量级分布（按去重作者）。 */
  tiers: Record<AccountTier, number>;
}

function touch<K, V>(map: Map<K, V>, key: K, value: V, max: number): void {
  // Map 保插入序：删了再插，等于把它移到「最近」
  map.delete(key);
  map.set(key, value);
  if (map.size > max) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
}

/** 可序列化的存储内容（跨标签页共享时写进 storage.session）。 */
export interface TweetStatsState {
  tweets: Array<[string, TweetEntry]>;
  authors: Array<[string, AuthorEntry]>;
  /** 帖子第一次出现在屏幕上的时刻；旧版本存的状态没有。 */
  seen?: Array<[string, number]>;
  /** 当前在热帖列表里的帖子（进出缓冲用）。 */
  hotMembers?: string[];
}

export function createTweetStatsStore(
  overrides?: Partial<MetricsConfig>,
  options: { hotWindowMs?: number } = {},
) {
  const config = resolveConfig(overrides);
  const hotWindowMs = options.hotWindowMs ?? HOT_WINDOW_MS;
  const tweets = new Map<string, TweetEntry>();
  const authors = new Map<string, AuthorEntry>();
  // 单独一张表：帖子上屏时 GraphQL 数据可能还没到，先记下时刻
  const seen = new Map<string, number>();
  // 上一次判定为热帖的帖子：跌破门槛的 70% 才移出
  let hotMembers = new Set<string>();
  // 内容过滤的结果按帖子缓存：正文不变就不用每次重跑规则
  const excluded = new Map<string, { stat: SanitizedTweetStat; value: boolean }>();

  function isExcluded(postId: string): boolean {
    const stat = tweets.get(postId)?.stat;
    if (!stat) return false;
    const cached = excluded.get(postId);
    if (cached?.stat === stat) return cached.value;
    const value = isHotListExcluded(stat);
    excluded.set(postId, { stat, value });
    if (excluded.size > MAX_TWEETS) {
      const oldest = excluded.keys().next().value;
      if (oldest !== undefined) excluded.delete(oldest);
    }
    return value;
  }

  /** 帖子出现在屏幕上：只记第一次（往回翻、重新刷到同一条，不算新刷到）。 */
  function recordSeen(postId: string, at: number): void {
    const first = seen.get(postId);
    if (first !== undefined && first <= at) return;
    seen.set(postId, at);
    if (seen.size > MAX_SEEN) {
      const oldest = seen.keys().next().value;
      if (oldest !== undefined) seen.delete(oldest);
    }
  }

  function recordTweet(stat: SanitizedTweetStat, at: number): void {
    const previous = tweets.get(stat.postId);
    // 多个标签页的观测可能乱序到达：比已有观测还旧的，只补缺失字段，不改观测点
    const stale = previous?.latest ? at < previous.latest.at : false;
    const entry: TweetEntry = previous
      ? {
          ...previous,
          stat: stale ? { ...stat, ...previous.stat } : { ...previous.stat, ...stat },
          lastSeenAt: Math.max(previous.lastSeenAt, at),
        }
      : { stat, latest: null, anchor: null, lastSeenAt: at };
    if (typeof stat.views === 'number' && !stale) {
      const observation = { views: stat.views, at };
      const prior = entry.latest;
      // 同一时刻的重复响应不算新观测
      if (!prior || prior.at !== at) {
        entry.latest = observation;
        if (prior && (!entry.anchor || at - entry.anchor.at > ANCHOR_ROLL_MS)) {
          entry.anchor = prior;
        }
      } else {
        entry.latest = observation;
      }
    }
    touch(tweets, stat.postId, entry, MAX_TWEETS);
  }

  function recordAuthor(stat: SanitizedAuthorStat): void {
    // 名字、头像、蓝标只给主页洞察用（profile-catalog），这里只留计数
    const { handle, followers, followingCount, tweets: count, createdAt } = stat;
    const rest: AuthorEntry = {
      ...(followers !== undefined ? { followers } : {}),
      ...(followingCount !== undefined ? { followingCount } : {}),
      ...(count !== undefined ? { tweets: count } : {}),
      ...(createdAt !== undefined ? { createdAt } : {}),
    };
    touch(authors, handle, { ...authors.get(handle), ...rest }, MAX_AUTHORS);
  }

  function author(handle: string): AuthorEntry | undefined {
    return authors.get(handle.toLowerCase());
  }

  function insight(postId: string, now: number): TweetInsight | null {
    const entry = tweets.get(postId);
    if (!entry) return null;
    const { stat } = entry;
    const followers = authors.get(stat.handle)?.followers;
    const age = ageHours(stat.createdAt, now);
    let velocity: number | null = null;
    if (entry.latest && age !== null && age <= config.velocityMaxAgeHours) {
      // 差分与均值都以「最近一次观测」为时刻：浏览量是那一刻的数
      velocity = velocityPerHour(
        {
          createdAt: stat.createdAt,
          views: entry.latest.views,
          now: entry.latest.at,
          ...(entry.anchor ? { previous: entry.anchor } : {}),
        },
        config,
      );
    }
    const breakout = breakoutRatio(stat.views, followers, config);
    const counts = {
      ...(stat.views !== undefined ? { views: stat.views } : {}),
      ...(stat.likes !== undefined ? { likes: stat.likes } : {}),
      ...(stat.retweets !== undefined ? { retweets: stat.retweets } : {}),
      ...(stat.replies !== undefined ? { replies: stat.replies } : {}),
      ...(stat.quotes !== undefined ? { quotes: stat.quotes } : {}),
      ...(stat.bookmarks !== undefined ? { bookmarks: stat.bookmarks } : {}),
    };
    return {
      postId,
      handle: stat.handle,
      ...(stat.kind ? { kind: stat.kind } : {}),
      ...(stat.displayName ? { displayName: stat.displayName } : {}),
      ...(stat.snippet ? { snippet: stat.snippet } : {}),
      ...(stat.avatarUrl ? { avatarUrl: stat.avatarUrl } : {}),
      ...(stat.verified !== undefined ? { verified: stat.verified } : {}),
      ...(stat.mediaUrl ? { mediaUrl: stat.mediaUrl } : {}),
      ...(stat.lang ? { lang: stat.lang } : {}),
      ...(stat.createdAt !== undefined ? { createdAt: stat.createdAt } : {}),
      ...(seen.has(postId) ? { seenAt: seen.get(postId)! } : {}),
      ...counts,
      ...(followers !== undefined ? { followers } : {}),
      velocity,
      breakout,
      heat: heatScore({ velocityPerHour: velocity, breakout, ageHours: age }, config),
      ...(age !== null ? { ageHours: age } : {}),
      projected: projectedViews(stat.views, age, config),
      coldStart: isColdStartWindow(
        {
          ageHours: age,
          ...(followers !== undefined ? { followers } : {}),
          ...(stat.views !== undefined ? { views: stat.views } : {}),
        },
        config,
      ),
      viral: viralScore(
        { ageHours: age, ...counts, ...(followers !== undefined ? { followers } : {}) },
        config,
      ),
      opportunity: replyOpportunity(
        {
          velocityPerHour: velocity,
          ageHours: age,
          ...(stat.replies !== undefined ? { replies: stat.replies } : {}),
        },
        config,
      ),
    };
  }

  /** 窗口内所有推文的指标，以及按这批数据算出的热帖门槛。 */
  function windowInsights(now: number): { items: TweetInsight[]; threshold: number } {
    const items: TweetInsight[] = [];
    for (const [postId, entry] of tweets) {
      if (now - entry.lastSeenAt > hotWindowMs) continue;
      const item = insight(postId, now);
      if (item) items.push(item);
    }
    const velocities = items.flatMap((item) => (item.velocity === null ? [] : [item.velocity]));
    return { items, threshold: hotThreshold(velocities, config.velocityHotPerHour) };
  }

  function isHot(item: TweetInsight, threshold: number): boolean {
    if (item.heat === null || item.velocity === null) return false;
    if (isExcluded(item.postId)) return false;
    if (item.velocity >= threshold) return true;
    return hotMembers.has(item.postId) && item.velocity >= threshold * HOT_EXIT_RATIO;
  }

  /**
   * 最近 hotWindowMs 内出现过、正在火的推文（流速达到 hotThreshold，带进出缓冲）。
   * 不够热的不进列表；排序方式只决定顺序。回复机会排序另外去掉窗口已过的帖子，
   * 最近刷到另外去掉没上过屏的帖子。同分时按热度。
   */
  function hotList(now: number, sort: HotSort = 'heat', limit = HOT_LIST_LIMIT): TweetInsight[] {
    const { items, threshold } = windowInsights(now);
    const hot = items.filter((item) => isHot(item, threshold));
    hotMembers = new Set(hot.map((item) => item.postId));
    const out = hot.filter(
      (item) =>
        (sort !== 'opportunity' || item.opportunity !== null) &&
        // 「最近刷到」只列真的滑到过的：X 预加载了、你还没看到的不算
        (sort !== 'recent' || item.seenAt !== undefined),
    );
    return out
      .sort(
        (a, b) =>
          hotSortKey(b, sort) - hotSortKey(a, sort) ||
          hotSortKey(b, 'heat') - hotSortKey(a, 'heat'),
      )
      .slice(0, limit);
  }

  /**
   * 简报：最近 hotWindowMs 内见过的推文的汇总（弹窗热帖页顶部）。
   * 作者量级按去重后的作者计。
   */
  function brief(now: number): PageBrief {
    const { items, threshold } = windowInsights(now);
    const velocities: number[] = [];
    const authors = new Set<string>();
    const tiers = Object.fromEntries(TIER_LEVELS.map((tier) => [tier, 0])) as PageBrief['tiers'];
    let seen = 0;
    let hot = 0;
    let topBreakout: PageBrief['topBreakout'] = null;
    for (const item of items) {
      seen += 1;
      if (item.velocity !== null) velocities.push(item.velocity);
      if (isHot(item, threshold)) hot += 1;
      if (item.breakout !== null && (!topBreakout || item.breakout > topBreakout.ratio)) {
        topBreakout = { ratio: item.breakout, handle: item.handle, postId: item.postId };
      }
      if (!authors.has(item.handle)) {
        authors.add(item.handle);
        const tier = accountTier(item.followers, config);
        if (tier !== null) tiers[tier] += 1;
      }
    }
    velocities.sort((a, b) => a - b);
    const mid = velocities.length >> 1;
    const medianVelocity =
      velocities.length === 0
        ? null
        : velocities.length % 2
          ? velocities[mid]!
          : (velocities[mid - 1]! + velocities[mid]!) / 2;
    return { seen, authors: authors.size, hot, threshold, medianVelocity, topBreakout, tiers };
  }

  /** 导出全部条目；插入顺序即淘汰顺序，导入后保持不变。 */
  function exportState(): TweetStatsState {
    return {
      tweets: [...tweets],
      authors: [...authors],
      seen: [...seen],
      hotMembers: [...hotMembers],
    };
  }

  /** 用导出的内容替换当前条目（只接受形状正确的条目）。 */
  function importState(state: unknown): void {
    tweets.clear();
    authors.clear();
    seen.clear();
    hotMembers = new Set();
    if (!state || typeof state !== 'object') return;
    const raw = state as Partial<TweetStatsState>;
    if (Array.isArray(raw.hotMembers)) {
      hotMembers = new Set(raw.hotMembers.filter((id): id is string => typeof id === 'string'));
    }
    for (const item of Array.isArray(raw.seen) ? raw.seen.slice(-MAX_SEEN) : []) {
      const [postId, at] = Array.isArray(item) ? item : [];
      if (typeof postId === 'string' && typeof at === 'number' && Number.isFinite(at)) {
        seen.set(postId, at);
      }
    }
    for (const item of Array.isArray(raw.tweets) ? raw.tweets.slice(-MAX_TWEETS) : []) {
      const [postId, entry] = Array.isArray(item) ? item : [];
      if (typeof postId === 'string' && entry && typeof entry === 'object' && entry.stat) {
        tweets.set(postId, entry);
      }
    }
    for (const item of Array.isArray(raw.authors) ? raw.authors.slice(-MAX_AUTHORS) : []) {
      const [handle, entry] = Array.isArray(item) ? item : [];
      if (typeof handle === 'string' && entry && typeof entry === 'object') {
        authors.set(handle, entry);
      }
    }
  }

  return {
    recordTweet,
    recordSeen,
    recordAuthor,
    author,
    insight,
    hotList,
    brief,
    exportState,
    importState,
  };
}

export type TweetStatsStore = ReturnType<typeof createTweetStatsStore>;
