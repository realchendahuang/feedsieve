/**
 * 全站热榜的上报（后台 service worker）。
 *
 * 不会让用户的 X 账号多冒任何风险：
 * - 上报的数据全部来自用户正常浏览时 X 已经返回给页面的响应，扩展不为此多请求 X 一次；
 * - 上报请求从扩展后台直接发往福滤娃自己的服务器（不经过 x.com 页面），X 看不到这条流量；
 * - 不带用户自己的 X 账号、Cookie、安装 ID，只带每天轮换的随机会话 ID（服务端只用来限速和计数）。
 *
 * 只上报正在火的帖子（流速 ≥ 1000 浏览/小时，和推文上「火了」变红的门槛一致），其余帖子留在本地；
 * 并且只报公开浏览场景（isShareablePath）里看到的、非受保护账号、不是用户自己的、X 没标敏感的帖子；正文截 280 字。
 *
 * 节奏：默认每 15 分钟最多发一次（第一次在开始刷 X 2 分钟后），间隔以服务端响应里的 next_upload_ms 为准
 * （用户多了服务端可以调长，不用发版）。同一条帖子只发最新一次观测；上次发过、浏览数涨不到 5% 且不到
 * 45 分钟的不重发；一轮最多 200 条，先发流速高的。失败按指数退避，限额用完等服务端给的时间。
 * 待发队列存在 storage.session，service worker 被回收也不丢。
 */
import type { SanitizedAuthorStat, SanitizedTweetStat } from '../platform/xhr-bridge-guard';
import { resolveConfig } from '@feedsieve/metrics';
import type { InsightObservation } from './shared-insight';

const MINUTE_MS = 60_000;
/** 默认上报间隔；服务端可以用 next_upload_ms 在 [MIN, MAX] 之间调。 */
export const HOT_UPLOAD_INTERVAL_MS = 15 * MINUTE_MS;
export const HOT_UPLOAD_INTERVAL_MIN_MS = 5 * MINUTE_MS;
export const HOT_UPLOAD_INTERVAL_MAX_MS = 60 * MINUTE_MS;
/** 连续失败时的退避上限。 */
const BACKOFF_MAX_MS = 2 * 60 * MINUTE_MS;
/** 限额用完时最多等这么久（服务端按 UTC 零点算，最长 24 小时）。 */
const RETRY_AFTER_MAX_MS = 24 * 60 * MINUTE_MS;
/** 流速达到这个值（浏览/小时）才上报，和推文上「火了」变红的门槛相同。 */
export const HOT_UPLOAD_MIN_VELOCITY = resolveConfig().velocityHotPerHour;
/** 和服务端 MAX_OBSERVATIONS_PER_REQUEST 一致。 */
const CHUNK = 100;
/** 一轮最多发这么多条（两个请求）。 */
export const HOT_UPLOAD_MAX_PER_ROUND = 200;
/** 观测超过这么久就不发了：服务端只收 90 分钟内的，留 10 分钟余量。 */
export const HOT_OBSERVATION_MAX_AGE_MS = 80 * MINUTE_MS;
/** 上次发过的帖子：浏览数涨不到这个比例、且离上次不到 RESEND_AFTER_MS，就不重发。 */
const RESEND_GROWTH = 1.05;
const RESEND_AFTER_MS = 45 * MINUTE_MS;
/** 「上次发过」记录：最多这么多条，超过 2 小时的清掉。 */
const MAX_SENT = 2_000;
const SENT_TTL_MS = 2 * 60 * MINUTE_MS;
/** 内存里最多攒这么多条待上报，超过就丢最早的（长时间断网时不无限增长）。 */
const MAX_PENDING = 2_000;
const SESSION_KEY = 'hotSessionV1';
/** 待上报队列与上报节奏：存进 storage.session，service worker 被回收（闲置 30 秒）也不丢。 */
const STATE_KEY = 'hotUplinkStateV1';
/** 第一次上报前先攒一会儿，避免刚打开 X 就为几条帖子发一次请求。 */
export const HOT_FIRST_UPLOAD_DELAY_MS = 2 * MINUTE_MS;

export interface HotUploadItem {
  post_id: string;
  handle: string;
  display_name?: string;
  avatar_url?: string;
  verified?: boolean;
  followers?: number;
  created_at: number;
  snippet?: string;
  media_url?: string;
  lang?: string;
  views: number;
  likes?: number;
  retweets?: number;
  replies?: number;
  quotes?: number;
  bookmarks?: number;
  observed_at: number;
}

export interface HotUplinkDeps {
  /** 当前是否允许上报（「仅本地运行」关闭且「参与全站热榜」开启）。 */
  isAllowed: () => Promise<boolean>;
  /** 当前登录的 X 账号（小写），用户自己的帖子不上报。 */
  getSelfHandle: () => Promise<string | null>;
  /** 这条帖子此刻的流速（浏览/小时），来自汇总了所有标签页观测的共享 store。 */
  velocityOf: (postId: string) => Promise<number | null>;
  post: (body: { session_id: string; observations: HotUploadItem[] }) => Promise<Response>;
  /** 持久存储（每日会话 ID）。 */
  storage: {
    get(key: string): Promise<Record<string, unknown>>;
    set(items: Record<string, unknown>): Promise<void>;
  };
  /** 会话存储（待上报队列）；缺省时只放内存。 */
  stateStorage?: {
    get(key: string): Promise<Record<string, unknown>>;
    set(items: Record<string, unknown>): Promise<void>;
  };
  now?: () => number;
  randomId?: () => string;
}

function toItem(
  tweet: SanitizedTweetStat,
  followers: number | undefined,
  at: number,
): HotUploadItem | null {
  if (tweet.views === undefined || tweet.createdAt === undefined) return null;
  const item: HotUploadItem = {
    post_id: tweet.postId,
    handle: tweet.handle,
    created_at: tweet.createdAt,
    views: tweet.views,
    // 观测时刻取整到分钟：服务端按 10 分钟分桶，不需要更精确的浏览时刻
    observed_at: Math.floor(at / MINUTE_MS) * MINUTE_MS,
  };
  if (tweet.displayName) item.display_name = tweet.displayName;
  if (tweet.avatarUrl) item.avatar_url = tweet.avatarUrl;
  if (tweet.verified !== undefined) item.verified = tweet.verified;
  if (followers !== undefined) item.followers = followers;
  if (tweet.snippet) item.snippet = tweet.snippet.slice(0, 280);
  if (tweet.mediaUrl) item.media_url = tweet.mediaUrl;
  if (tweet.lang) item.lang = tweet.lang;
  for (const key of ['likes', 'retweets', 'replies', 'quotes', 'bookmarks'] as const) {
    if (tweet[key] !== undefined) item[key] = tweet[key];
  }
  return item;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await response.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function createHotUplink(deps: HotUplinkDeps) {
  const now = deps.now ?? (() => Date.now());
  const randomId = deps.randomId ?? (() => crypto.randomUUID());
  const pending = new Map<string, HotUploadItem>();
  const followers = new Map<string, number>();
  /** 上次发出去的浏览数和时刻。 */
  const sent = new Map<string, { views: number; at: number }>();
  /** 下一次允许上报的时刻。 */
  let nextUploadAt: number | null = null;
  /** 服务端给的间隔。 */
  let intervalMs = HOT_UPLOAD_INTERVAL_MS;
  let failures = 0;
  let uploading: Promise<void> | null = null;
  let loaded: Promise<void> | null = null;

  function loadState(): Promise<void> {
    loaded ??= (deps.stateStorage?.get(STATE_KEY) ?? Promise.resolve<Record<string, unknown>>({}))
      .then((result) => {
        const state = result[STATE_KEY] as
          | {
              nextUploadAt?: unknown;
              lastUploadAt?: unknown;
              intervalMs?: unknown;
              failures?: unknown;
              pending?: unknown;
              followers?: unknown;
              sent?: unknown;
            }
          | undefined;
        if (typeof state?.intervalMs === 'number') {
          intervalMs = clamp(
            state.intervalMs,
            HOT_UPLOAD_INTERVAL_MIN_MS,
            HOT_UPLOAD_INTERVAL_MAX_MS,
          );
        }
        if (typeof state?.nextUploadAt === 'number') nextUploadAt = state.nextUploadAt;
        // 旧版本只存了上次上报时刻
        else if (typeof state?.lastUploadAt === 'number') {
          nextUploadAt = state.lastUploadAt + intervalMs;
        }
        if (typeof state?.failures === 'number') failures = state.failures;
        if (Array.isArray(state?.pending)) {
          for (const item of state.pending as HotUploadItem[]) {
            if (item && typeof item.post_id === 'string') pending.set(item.post_id, item);
          }
        }
        if (Array.isArray(state?.followers)) {
          for (const [handle, count] of state.followers as Array<[string, number]>) {
            if (typeof handle === 'string' && typeof count === 'number')
              followers.set(handle, count);
          }
        }
        if (Array.isArray(state?.sent)) {
          for (const [postId, entry] of state.sent as Array<
            [string, { views: number; at: number }]
          >) {
            if (
              typeof postId === 'string' &&
              typeof entry?.views === 'number' &&
              typeof entry.at === 'number'
            ) {
              sent.set(postId, entry);
            }
          }
        }
      })
      .catch(() => undefined)
      .then(() => {
        // 第一次：从现在起 2 分钟后才上报
        nextUploadAt ??= now() + HOT_FIRST_UPLOAD_DELAY_MS;
      });
    return loaded;
  }

  function saveState(): Promise<void> {
    if (!deps.stateStorage) return Promise.resolve();
    return deps.stateStorage
      .set({
        [STATE_KEY]: {
          nextUploadAt,
          intervalMs,
          failures,
          pending: [...pending.values()],
          followers: [...followers].slice(-MAX_PENDING),
          sent: [...sent],
        },
      })
      .catch(() => undefined);
  }

  /** 每天一个新的随机会话 ID：同一个人跨天无法被串起来。 */
  async function sessionId(): Promise<string> {
    const day = new Date(now()).toISOString().slice(0, 10);
    const stored = (await deps.storage.get(SESSION_KEY))[SESSION_KEY] as
      { day?: string; id?: string } | undefined;
    if (stored?.day === day && typeof stored.id === 'string') return stored.id;
    const id = randomId();
    await deps.storage.set({ [SESSION_KEY]: { day, id } });
    return id;
  }

  async function record(observations: unknown): Promise<void> {
    if (!Array.isArray(observations)) return;
    const self = await deps.getSelfHandle();
    for (const observation of observations as InsightObservation[]) {
      if (!observation || observation.shareable !== true || typeof observation.at !== 'number') {
        continue;
      }
      for (const author of (observation.authors ?? []) as SanitizedAuthorStat[]) {
        if (typeof author?.followers === 'number') followers.set(author.handle, author.followers);
      }
      for (const tweet of (observation.tweets ?? []) as SanitizedTweetStat[]) {
        if (
          !tweet ||
          tweet.protected === true ||
          tweet.sensitive === true ||
          tweet.handle === self
        ) {
          continue;
        }
        const item = toItem(tweet, followers.get(tweet.handle), observation.at);
        if (!item) continue;
        pending.delete(item.post_id);
        pending.set(item.post_id, item);
        if (pending.size > MAX_PENDING) {
          const oldest = pending.keys().next().value;
          if (oldest !== undefined) pending.delete(oldest);
        }
      }
    }
  }

  function pruneSent(at: number): void {
    for (const [postId, entry] of sent) {
      if (at - entry.at > SENT_TTL_MS) sent.delete(postId);
    }
    while (sent.size > MAX_SENT) {
      const oldest = sent.keys().next().value;
      if (oldest === undefined) break;
      sent.delete(oldest);
    }
  }

  /** 上次发过、浏览数没怎么涨、也没隔多久：不重发。 */
  function unchanged(item: HotUploadItem, at: number): boolean {
    const last = sent.get(item.post_id);
    return Boolean(
      last && item.views < last.views * RESEND_GROWTH && at - last.at < RESEND_AFTER_MS,
    );
  }

  /** 发一轮；返回 false 表示服务端拒绝或网络失败（剩下的留到下一轮）。 */
  async function upload(): Promise<boolean> {
    const at = now();
    pruneSent(at);
    // 只报正在火的：不火的、过期的、没变化的直接丢掉，不再等下一轮（下次再被刷到、火起来了还会进来）
    const hot: Array<{ item: HotUploadItem; velocity: number }> = [];
    for (const item of [...pending.values()]) {
      const velocity = await deps.velocityOf(item.post_id);
      if (
        velocity === null ||
        velocity < HOT_UPLOAD_MIN_VELOCITY ||
        at - item.observed_at > HOT_OBSERVATION_MAX_AGE_MS ||
        unchanged(item, at)
      ) {
        pending.delete(item.post_id);
      } else {
        hot.push({ item, velocity });
      }
    }
    if (hot.length === 0) return true;
    const items = hot
      .sort((a, b) => b.velocity - a.velocity)
      .slice(0, HOT_UPLOAD_MAX_PER_ROUND)
      .map(({ item }) => item);
    const id = await sessionId();
    for (let i = 0; i < items.length; i += CHUNK) {
      const chunk = items.slice(i, i + CHUNK);
      const response = await deps.post({ session_id: id, observations: chunk });
      const body = await readJson(response);
      if (!response.ok) {
        // 限额用完：照服务端说的时间再来；其他错误：指数退避。这批留着，过期的下一轮会被丢掉
        const retry = typeof body.retry_after_ms === 'number' ? body.retry_after_ms : null;
        failures += 1;
        nextUploadAt =
          response.status === 429 && retry !== null
            ? at + clamp(retry, intervalMs, RETRY_AFTER_MAX_MS)
            : at + Math.min(intervalMs * 2 ** failures, BACKOFF_MAX_MS);
        return false;
      }
      if (typeof body.next_upload_ms === 'number' && Number.isFinite(body.next_upload_ms)) {
        intervalMs = clamp(
          body.next_upload_ms,
          HOT_UPLOAD_INTERVAL_MIN_MS,
          HOT_UPLOAD_INTERVAL_MAX_MS,
        );
      }
      for (const item of chunk) {
        sent.delete(item.post_id);
        sent.set(item.post_id, { views: item.views, at });
        if (pending.get(item.post_id) === item) pending.delete(item.post_id);
      }
    }
    failures = 0;
    nextUploadAt = at + intervalMs;
    return true;
  }

  /**
   * 收到新观测时顺手检查：到了下一次允许上报的时刻才发。不用定时器
   * （service worker 随时会被回收），用户在刷 X 就会不断有新观测触发它。
   */
  async function maybeUpload(): Promise<void> {
    if (uploading || pending.size === 0 || now() < (nextUploadAt ?? 0)) return;
    // 先占住这一轮：上传过程中又来的观测不会再触发一次
    nextUploadAt = now() + intervalMs;
    uploading = upload()
      .then(() => undefined)
      .catch(() => {
        failures += 1;
        nextUploadAt = now() + Math.min(intervalMs * 2 ** failures, BACKOFF_MAX_MS);
      })
      .finally(() => {
        uploading = null;
      });
    await uploading;
  }

  async function observe(observations: unknown): Promise<void> {
    await loadState();
    // 用户关了「参与全站热榜」：立刻停止攒数据，已攒的清掉
    if (!(await deps.isAllowed())) {
      if (pending.size > 0 || sent.size > 0) {
        pending.clear();
        sent.clear();
        await saveState();
      }
      return;
    }
    await record(observations);
    await maybeUpload();
    await saveState();
  }

  return { observe, pendingCount: () => pending.size };
}

export type HotUplink = ReturnType<typeof createHotUplink>;
