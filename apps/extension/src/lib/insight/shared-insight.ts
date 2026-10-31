/**
 * 跨标签页共享的热帖数据（后台 service worker 里汇总）。
 *
 * 数据流：
 *   X 页面加载时间线（用户滚动、X 自己拉新帖）
 *     → MAIN world 桥解析 GraphQL 响应
 *     → 内容脚本消毒，记进本标签页的内存 store（推文上的流速 / 量级用）
 *     → 每 2 秒把这段时间的观测批量发给后台（createInsightUplink）
 *     → 后台合并进共享 store，写进 storage.session（service worker 被回收也不丢）
 *     → 广播 `feedsieve:insight-updated`，开着的弹窗 / 侧边栏自动重新取热帖
 *
 * 存储位置是 storage.session：只在内存里，浏览器关闭即清空，不落盘、不上传。
 * 扩展不会为了热帖主动请求 X，数据全部来自用户自己正常浏览时 X 已经返回的响应。
 */
import { accountTier } from '@feedsieve/metrics';
import type { SanitizedAuthorStat, SanitizedTweetStat } from '../platform/xhr-bridge-guard';
import {
  createTweetStatsStore,
  SHARED_HOT_LIST_LIMIT,
  SHARED_HOT_WINDOW_MS,
  type HotSort,
  type PageBrief,
  type TweetInsight,
} from './tweet-stats';

export const SHARED_INSIGHT_KEY = 'insightSharedV1';
export const INSIGHT_UPDATED_MESSAGE = 'feedsieve:insight-updated';
export const INSIGHT_OBSERVE_MESSAGE = 'feedsieve:insight-observe';
const READ_KEY = 'insightReadV1';
/** 已读记录上限，超出时淘汰最早的。 */
const MAX_READ = 5_000;

/** 内容脚本一次观测：同一批 GraphQL 响应里的推文与作者，带观测时刻。 */
export interface InsightObservation {
  at: number;
  tweets: SanitizedTweetStat[];
  authors: SanitizedAuthorStat[];
  /** 是否来自可以参与全站热榜的页面（私信、通知、书签、列表等页面上看到的不算）。 */
  shareable?: boolean;
  /** 观测时所在个人主页的主人（主页洞察给他建帖子库）。 */
  profile?: string;
}

/**
 * 只有公开浏览场景里看到的帖子才能进全站热榜：首页、搜索、个人主页、帖子详情、探索。
 * 私信、通知、书签、列表、社群、设置页面上看到的内容带着个人上下文，不上报。
 */
export function isShareablePath(pathname: string): boolean {
  return !/^\/(messages|notifications|settings|i\/(bookmarks|lists|communities|chat|grok))(\/|$)/.test(
    pathname,
  );
}

export interface SharedInsightStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

const POST_ID = /^\d{1,20}$/;
const HANDLE = /^[a-z0-9_]{1,15}$/;
/** 观测时刻只接受最近 10 分钟内的（挡住伪造的未来时刻和过期批次）。 */
const MAX_OBSERVATION_AGE_MS = 10 * 60 * 1000;

function isTweetStat(value: unknown): value is SanitizedTweetStat {
  const raw = value as Partial<SanitizedTweetStat> | null;
  return Boolean(
    raw &&
    typeof raw === 'object' &&
    typeof raw.postId === 'string' &&
    POST_ID.test(raw.postId) &&
    typeof raw.handle === 'string' &&
    HANDLE.test(raw.handle),
  );
}

function isAuthorStat(value: unknown): value is SanitizedAuthorStat {
  const raw = value as Partial<SanitizedAuthorStat> | null;
  return Boolean(
    raw && typeof raw === 'object' && typeof raw.handle === 'string' && HANDLE.test(raw.handle),
  );
}

export function createSharedInsight(deps: {
  storage: SharedInsightStorage;
  broadcast: () => void;
  now?: () => number;
  persistDelayMs?: number;
  broadcastDelayMs?: number;
}) {
  const now = deps.now ?? (() => Date.now());
  const persistDelayMs = deps.persistDelayMs ?? 2_000;
  const broadcastDelayMs = deps.broadcastDelayMs ?? 1_000;
  const store = createTweetStatsStore(undefined, { hotWindowMs: SHARED_HOT_WINDOW_MS });
  let ready: Promise<void> | null = null;
  // 已读帖子 ID（插入顺序即淘汰顺序）
  const read = new Set<string>();
  let persistTimer: ReturnType<typeof setTimeout> | undefined;
  let broadcastTimer: ReturnType<typeof setTimeout> | undefined;

  /** service worker 每次被唤醒都从 storage.session 恢复一次。 */
  function load(): Promise<void> {
    ready ??= Promise.all([deps.storage.get(SHARED_INSIGHT_KEY), deps.storage.get(READ_KEY)])
      .then(([state, readState]) => {
        store.importState(state[SHARED_INSIGHT_KEY]);
        const ids = readState[READ_KEY];
        if (Array.isArray(ids)) {
          for (const id of ids.slice(-MAX_READ)) if (typeof id === 'string') read.add(id);
        }
      })
      .catch(() => undefined);
    return ready;
  }

  function schedulePersist(): void {
    if (persistTimer !== undefined) return;
    persistTimer = setTimeout(() => {
      persistTimer = undefined;
      void deps.storage
        .set({ [SHARED_INSIGHT_KEY]: store.exportState(), [READ_KEY]: [...read] })
        .catch(() => undefined);
    }, persistDelayMs);
  }

  function scheduleBroadcast(): void {
    if (broadcastTimer !== undefined) return;
    broadcastTimer = setTimeout(() => {
      broadcastTimer = undefined;
      deps.broadcast();
    }, broadcastDelayMs);
  }

  /** 合并内容脚本发来的观测；返回实际记进去的推文数。 */
  async function ingest(observations: unknown): Promise<number> {
    await load();
    if (!Array.isArray(observations)) return 0;
    const current = now();
    let recorded = 0;
    // 按时刻排序后合并，流速差分才是从旧到新
    const valid = observations
      .filter(
        (item): item is InsightObservation =>
          Boolean(item) &&
          typeof item === 'object' &&
          typeof (item as InsightObservation).at === 'number' &&
          Number.isFinite((item as InsightObservation).at),
      )
      .sort((a, b) => a.at - b.at);
    for (const observation of valid) {
      const at = Math.min(current, Math.max(current - MAX_OBSERVATION_AGE_MS, observation.at));
      for (const author of Array.isArray(observation.authors) ? observation.authors : []) {
        if (isAuthorStat(author)) store.recordAuthor(author);
      }
      for (const tweet of Array.isArray(observation.tweets) ? observation.tweets : []) {
        if (!isTweetStat(tweet)) continue;
        store.recordTweet(tweet, at);
        recorded += 1;
      }
    }
    if (recorded > 0) {
      schedulePersist();
      scheduleBroadcast();
    }
    return recorded;
  }

  async function hotList(
    sort: HotSort,
  ): Promise<Array<TweetInsight & { tier: number | null; read: boolean }>> {
    await load();
    const list = store.hotList(now(), sort, SHARED_HOT_LIST_LIMIT);
    // 热帖成员（进出缓冲）跟着存，service worker 重启后帖子不会因为门槛波动被踢出
    schedulePersist();
    return list.map((item) => ({
      ...item,
      tier: accountTier(item.followers),
      read: read.has(item.postId),
    }));
  }

  /** 标记已读：返回新标记的条数。 */
  async function markRead(postIds: unknown): Promise<number> {
    await load();
    if (!Array.isArray(postIds)) return 0;
    let added = 0;
    for (const id of postIds.slice(0, 500)) {
      if (typeof id !== 'string' || !POST_ID.test(id) || read.has(id)) continue;
      read.add(id);
      added += 1;
      if (read.size > MAX_READ) {
        const oldest = read.values().next().value;
        if (oldest !== undefined) read.delete(oldest);
      }
    }
    if (added > 0) {
      schedulePersist();
      scheduleBroadcast();
    }
    return added;
  }

  /** 帖子上屏：记第一次出现在屏幕上的时刻（「最近刷到」排序用）。返回记下的条数。 */
  async function markSeen(posts: unknown): Promise<number> {
    await load();
    if (!Array.isArray(posts)) return 0;
    const current = now();
    let recorded = 0;
    for (const post of posts.slice(0, 500)) {
      const raw = post as { postId?: unknown; at?: unknown } | null;
      if (
        !raw ||
        typeof raw.postId !== 'string' ||
        !POST_ID.test(raw.postId) ||
        typeof raw.at !== 'number' ||
        !Number.isFinite(raw.at)
      ) {
        continue;
      }
      store.recordSeen(
        raw.postId,
        Math.min(current, Math.max(current - MAX_OBSERVATION_AGE_MS, raw.at)),
      );
      recorded += 1;
    }
    if (recorded > 0) {
      schedulePersist();
      scheduleBroadcast();
    }
    return recorded;
  }

  /** 已读的帖子 ID（全站热榜在弹窗里按它过滤）。 */
  async function readIds(): Promise<string[]> {
    await load();
    return [...read];
  }

  /** 单条帖子此刻的流速（全站热榜上报只发正在火的帖子）。 */
  async function velocityOf(postId: string): Promise<number | null> {
    await load();
    return store.insight(postId, now())?.velocity ?? null;
  }

  async function brief(): Promise<PageBrief> {
    await load();
    return store.brief(now());
  }

  return { ingest, hotList, brief, velocityOf, markRead, markSeen, readIds };
}

export type SharedInsight = ReturnType<typeof createSharedInsight>;

/**
 * 内容脚本一侧：把观测攒起来，每 flushMs 发一次给后台，避免每个响应都唤醒 service worker。
 */
export function createInsightUplink(deps: {
  send: (observations: InsightObservation[]) => Promise<unknown>;
  flushMs?: number;
}) {
  const flushMs = deps.flushMs ?? 2_000;
  let pending: InsightObservation[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  function flush(): void {
    timer = undefined;
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    // 扩展刚更新、后台未就绪时发送会失败；这批数据丢掉即可，下一批会补上新观测
    void deps.send(batch).catch(() => undefined);
  }

  function push(observation: InsightObservation): void {
    if (observation.tweets.length === 0 && observation.authors.length === 0) return;
    pending.push(observation);
    timer ??= setTimeout(flush, flushMs);
  }

  return { push, flush };
}
