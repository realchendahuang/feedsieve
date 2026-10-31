/**
 * 众包全站热榜。
 *
 * - POST /v1/observations：扩展后台每 15 分钟左右上报一批「用户正常浏览时 X 已经加载的」正在火的公开帖子指标。
 *   扩展不会为此多请求 X 一次（见 apps/extension/src/lib/insight/hot-uplink.ts）。
 *   响应里的 next_upload_ms 由服务端决定下一次上报间隔：用户多了或库压力大时调长，不用发版。
 * - GET /v1/hot：两个榜，「飙升」（最近的涨速，发布 24 小时内，在榜满 6 小时开始降权、12 小时下榜）
 *   和「24 小时」（24 小时内发布的帖子按浏览数）。榜单算好存进 meta，最多每 5 分钟重算一次，
 *   带 ETag，没变化回 304。
 *
 * 隐私：不收安装 ID，只收每日轮换的随机会话 ID（加盐哈希后存）和 IP 段的加盐哈希（防刷，26 小时后删）；
 * 不收上报者自己的 X 账号。
 * 防刷：会话和 IP 双维度每日限额；上榜要求足够多的不同会话且来自不同网段；
 * 流速取同一时间桶里各会话的中位数；社区黑名单作者和黄推话术不上榜；同一作者每榜最多 2 条。
 */
import { and, desc, eq, gte, inArray, lt, notExists, sql } from 'drizzle-orm';
import {
  ageHours,
  breakoutRatio,
  heatScore,
  velocityLevel,
  velocityPerHour,
  type ViewObservation,
} from '@feedsieve/metrics';
import { detect, HOT_LIST_HEURISTICS } from '@feedsieve/detector';
import { getDb, retryOnConflict } from './db/client';
import { accounts, hotObservations, hotPosts, meta } from './db/schema';
import { hashInstallationId, hashIp } from './lib/hash';
import { compareText, stripNul } from './lib/sql';
import { chargeUsageInOrder } from './lib/usage';
import { utcToday } from './lib/time';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** 一次请求最多这么多条观测（合并成两条集合式 INSERT）。 */
export const MAX_OBSERVATIONS_PER_REQUEST = 100;
/** 每个会话每天最多上报这么多条观测；正常刷一天远到不了。 */
const SESSION_DAILY_LIMIT = 5_000;
/** 每个 IP 每天的上限：国内用户常共用代理出口，放宽到会话的 10 倍。 */
const IP_DAILY_LIMIT = 50_000;
/**
 * 上榜门槛的上限：至少这么多个不同会话看到过（防一个人刷榜）。
 * 实际门槛按最近 2 小时的活跃上报人数自动调（冷启动 1 → 2 → 3），
 * 也可以用环境变量 HOT_MIN_REPORTERS 固定。
 */
export const MIN_REPORTERS = 3;
/** 活跃上报会话少于这么多时门槛为 1，少于 ACTIVE_FOR_THREE 时为 2。 */
const ACTIVE_FOR_TWO = 20;
const ACTIVE_FOR_THREE = 100;

/**
 * 观测最多晚到这么久：客户端约 15 分钟上报一次，网络抖动、service worker 回收会再晚一些。
 * 曾经是 30 分钟、而客户端 30 分钟才报一次，上一轮刚过就刷到的帖子全被丢掉。
 */
export const OBSERVATION_MAX_LAG_MS = 90 * MINUTE_MS;
/**
 * 下一次上报的建议间隔（客户端在 5–60 分钟之间照办）；可用 HOT_UPLOAD_INTERVAL_MIN 调。
 * 上限 60：再长的话，一轮里早些刷到的观测会超过 OBSERVATION_MAX_LAG_MS，「飙升」也会断档。
 */
const DEFAULT_UPLOAD_INTERVAL_MIN = 15;

/**
 * 全站热榜用独立的盐（HOT_SALT）：会话 ID 每天轮换、和安装 ID 无关，不需要跟名单上报共用一把盐；
 * 没配时回落 INSTALLATION_SALT（本地开发、测试）。
 */
export function hotSalt(env: Cloudflare.Env): string {
  return env.HOT_SALT && env.HOT_SALT.length >= 16 ? env.HOT_SALT : env.INSTALLATION_SALT;
}

/** 上榜需要的不同会话数：环境变量优先，否则按活跃上报人数自动定。 */
export function reporterThreshold(env: Cloudflare.Env, activeReporters: number): number {
  const value = Number(env.HOT_MIN_REPORTERS);
  if (env.HOT_MIN_REPORTERS && Number.isInteger(value) && value >= 1 && value <= 20) return value;
  if (activeReporters < ACTIVE_FOR_TWO) return 1;
  if (activeReporters < ACTIVE_FOR_THREE) return 2;
  return MIN_REPORTERS;
}

export function uploadIntervalMs(env: Cloudflare.Env): number {
  const value = Number(env.HOT_UPLOAD_INTERVAL_MIN);
  const minutes =
    env.HOT_UPLOAD_INTERVAL_MIN && Number.isFinite(value) && value >= 5 && value <= 60
      ? value
      : DEFAULT_UPLOAD_INTERVAL_MIN;
  return Math.round(minutes * MINUTE_MS);
}

/** 观测时间桶：10 分钟。 */
const BUCKET_MS = 10 * MINUTE_MS;
/** 流速取最近一个点和至少 30 分钟前的点之间的增量（近期速度，不是 2 小时平均）。 */
const RECENT_GAP_MS = 30 * MINUTE_MS;
/** 精排时取回的观测范围。 */
const SERIES_WINDOW_MS = 3 * HOUR_MS;
/** 「飙升」：最近 90 分钟还有人看到、发布不超过 24 小时。 */
const RISING_SEEN_MS = 90 * MINUTE_MS;
const RISING_MAX_AGE_MS = 24 * HOUR_MS;
/** 在榜时长：满 6 小时开始降权（每 3 小时减半），满 12 小时下「飙升」。 */
const BOARD_FULL_HOURS = 6;
const BOARD_HALF_LIFE_HOURS = 3;
const BOARD_MAX_HOURS = 12;
/** 「24 小时」：最近 3 小时还有人看到、发布不超过 24 小时，按浏览数。 */
const DAY_SEEN_MS = 3 * HOUR_MS;
const DAY_MAX_AGE_MS = 24 * HOUR_MS;
/** 候选池大小（精排前）。 */
const RISING_CANDIDATES = 400;
const DAY_CANDIDATES = 150;
export const HOT_LIST_LIMIT = 100;
export const DAY_LIST_LIMIT = 50;
/** 同一作者每个榜最多占这么多个名次。 */
export const AUTHOR_CAP = 2;
/** 榜单最多这么久重算一次。 */
export const BOARD_TTL_MS = 5 * MINUTE_MS;
/** 重算锁：同一时刻只有一个请求在算，其余先回旧榜。 */
const BOARD_LOCK_MS = 60_000;
/** 名次变化和这么久之前的榜比（每 30 分钟换一次参照）。 */
const RANK_REF_MS = 30 * MINUTE_MS;
/** 观测保留 26 小时（「24 小时」榜够用），帖子保留 48 小时（cron 清理）。 */
const OBSERVATION_RETENTION_MS = 26 * HOUR_MS;
const POST_RETENTION_MS = 48 * HOUR_MS;

const BOARD_KEY = 'hot:board';
const BOARD_LOCK_KEY = 'hot:board-lock';
const RANK_REF_KEY = 'hot:rank-ref';

const POST_ID = /^\d{1,20}$/;
const HANDLE = /^[a-z0-9_]{1,15}$/;
const TWIMG_URL = /^https:\/\/pbs\.twimg\.com\/[\w./-]{1,300}$/;
const COUNT_MAX = 1e12;
const TIMESTAMP_MIN = Date.UTC(2006, 0, 1);

export interface Observation {
  postId: string;
  handle: string;
  displayName?: string;
  avatarUrl?: string;
  verified?: boolean;
  followers?: number;
  createdAt: number;
  snippet?: string;
  mediaUrl?: string;
  lang?: string;
  views: number;
  likes?: number;
  retweets?: number;
  replies?: number;
  quotes?: number;
  bookmarks?: number;
  observedAt: number;
}

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= COUNT_MAX
    ? value
    : undefined;
}

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = stripNul(value).trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

function image(value: unknown): string | undefined {
  return typeof value === 'string' && TWIMG_URL.test(value) ? value : undefined;
}

/** 单条观测的严格校验；不合格整条丢弃。 */
export function parseObservation(raw: unknown, now: number): Observation | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const postId = typeof r.post_id === 'string' && POST_ID.test(r.post_id) ? r.post_id : null;
  const handle =
    typeof r.handle === 'string' && HANDLE.test(r.handle.toLowerCase())
      ? r.handle.toLowerCase()
      : null;
  const views = count(r.views);
  const createdAt =
    typeof r.created_at === 'number' &&
    r.created_at >= TIMESTAMP_MIN &&
    r.created_at <= now + 300_000
      ? Math.floor(r.created_at)
      : null;
  const observedAt =
    typeof r.observed_at === 'number' &&
    r.observed_at >= now - OBSERVATION_MAX_LAG_MS &&
    r.observed_at <= now + 300_000
      ? Math.floor(r.observed_at)
      : null;
  if (!postId || !handle || views === undefined || createdAt === null || observedAt === null) {
    return null;
  }
  if (observedAt < createdAt) return null;
  return {
    postId,
    handle,
    createdAt,
    observedAt,
    views,
    ...pick({
      displayName: text(r.display_name, 64),
      avatarUrl: image(r.avatar_url),
      mediaUrl: image(r.media_url),
      snippet: text(r.snippet, 280),
      lang:
        typeof r.lang === 'string' && /^[a-z]{2,3}(-[a-z]{2,4})?$/.test(r.lang)
          ? r.lang
          : undefined,
      verified: typeof r.verified === 'boolean' ? r.verified : undefined,
      followers: count(r.followers),
      likes: count(r.likes),
      retweets: count(r.retweets),
      replies: count(r.replies),
      quotes: count(r.quotes),
      bookmarks: count(r.bookmarks),
    }),
  };
}

function pick<T extends Record<string, unknown>>(record: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined) (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

/** 把 IPv6 展开成 8 组（不补零前缀以外的格式差异：统一小写、去前导零）；不合法返回 null。 */
function expandIpv6(ip: string): string[] | null {
  const halves = ip.toLowerCase().split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  if (!groups.every((group) => /^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.map((group) => String(parseInt(group, 16)));
}

/**
 * IP 段：IPv4 取前 3 段（/24），IPv6 取前 3 组（/48）；IPv4 映射的 IPv6（::ffff:1.2.3.4）按 IPv4 算。
 * 同一家庭宽带、同一台机器换会话还是同一段。
 */
export function ipNet(ip: string): string {
  const trimmed = ip.trim();
  const v4 = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/i.exec(trimmed);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}`;
  const groups = expandIpv6(trimmed);
  return groups ? `v6:${groups.slice(0, 3).join(':')}` : `raw:${trimmed}`;
}

function msUntilUtcMidnight(now: number): number {
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  return next.getTime() - now;
}

type IngestResult =
  | { status: 200; body: { accepted: number; rejected: number; next_upload_ms: number } }
  | { status: 400; body: { error: string } }
  | { status: 429; body: { error: string; retry_after_ms: number } };

export async function ingestObservations(
  env: Cloudflare.Env,
  raw: unknown,
  ip: string | undefined,
  now = Date.now(),
): Promise<IngestResult> {
  const body = raw as Record<string, unknown> | null;
  if (
    !body ||
    typeof body.session_id !== 'string' ||
    !/^[0-9a-f-]{16,64}$/i.test(body.session_id) ||
    !Array.isArray(body.observations) ||
    body.observations.length < 1 ||
    body.observations.length > MAX_OBSERVATIONS_PER_REQUEST
  ) {
    return { status: 400, body: { error: 'invalid_observations_request' } };
  }
  const nextUploadMs = uploadIntervalMs(env);
  const observations = body.observations
    .map((item) => parseObservation(item, now))
    .filter((item): item is Observation => item !== null);
  const rejected = body.observations.length - observations.length;
  if (observations.length === 0) {
    return { status: 200, body: { accepted: 0, rejected, next_upload_ms: nextUploadMs } };
  }

  const salt = hotSalt(env);
  const reporter = await hashInstallationId(salt, `hot:${body.session_id}`);
  // 限额按条数预扣（与 training-samples 同一张计数表，前缀区分），并发请求也不会一起越线。
  // 先会话后 IP，串成一条语句：会话超限则 IP 计数不动，会话通过而 IP 超限时会话已扣（与逐项依次执行一致）。
  const day = utcToday();
  // 网段哈希带上日期：和会话 ID 一样每天换，跨天串不起来
  const net = ip ? (await hashIp(salt, `net:${day}:${ipNet(ip)}`)).slice(0, 16) : null;
  const limits: Array<[string, number]> = [[`hot-session:${reporter}`, SESSION_DAILY_LIMIT]];
  if (ip) limits.push([`hot-ip:${await hashIp(salt, ip)}`, IP_DAILY_LIMIT]);
  const db = getDb(env);
  if (!(await chargeUsageInOrder(db, day, observations.length, limits))) {
    return {
      status: 429,
      body: { error: 'rate_limited', retry_after_ms: msUntilUtcMidnight(now) },
    };
  }

  // 同一请求里同一帖子可能被观测多次：集合式 UPSERT 同一行不能出现两次，
  // 先按顺序折叠成与逐条执行等价的结果（后到的非空字段覆盖，views 取大，last_seen 取大，first_seen 取首条）。
  const posts = new Map<string, Observation & { firstSeen: number; lastSeen: number }>();
  const points = new Map<string, { postId: string; bucket: number; views: number }>();
  for (const o of observations) {
    const known = posts.get(o.postId);
    if (!known) {
      posts.set(o.postId, { ...o, firstSeen: o.observedAt, lastSeen: o.observedAt });
    } else {
      Object.assign(
        known,
        pick({
          displayName: o.displayName,
          avatarUrl: o.avatarUrl,
          verified: o.verified,
          followers: o.followers,
          snippet: o.snippet,
          mediaUrl: o.mediaUrl,
          lang: o.lang,
          likes: o.likes,
          retweets: o.retweets,
          replies: o.replies,
          quotes: o.quotes,
          bookmarks: o.bookmarks,
        }),
        {
          views: Math.max(known.views, o.views),
          firstSeen: Math.min(known.firstSeen, o.observedAt),
          lastSeen: Math.max(known.lastSeen, o.observedAt),
        },
      );
    }
    const bucket = Math.floor(o.observedAt / BUCKET_MS);
    const pointKey = `${o.postId}:${bucket}`;
    const point = points.get(pointKey);
    if (point) point.views = Math.max(point.views, o.views);
    else points.set(pointKey, { postId: o.postId, bucket, views: o.views });
  }

  // 按主键排序：并发请求以相同顺序锁行，避免死锁
  const sortedPosts = [...posts.values()].sort((a, b) => compareText(a.postId, b.postId));
  const sortedPoints = [...points.values()].sort(
    (a, b) => compareText(a.postId, b.postId) || a.bucket - b.bucket,
  );

  await retryOnConflict(() =>
    Promise.all([
      db
        .insert(hotPosts)
        .values(
          sortedPosts.map((o) => ({
            postId: o.postId,
            handle: o.handle,
            displayName: o.displayName ?? null,
            avatarUrl: o.avatarUrl ?? null,
            verified: o.verified === undefined ? null : o.verified ? 1 : 0,
            followers: o.followers ?? null,
            createdAt: o.createdAt,
            snippet: o.snippet ?? null,
            mediaUrl: o.mediaUrl ?? null,
            lang: o.lang ?? null,
            views: o.views,
            likes: o.likes ?? null,
            retweets: o.retweets ?? null,
            replies: o.replies ?? null,
            quotes: o.quotes ?? null,
            bookmarks: o.bookmarks ?? null,
            firstSeen: o.firstSeen,
            lastSeen: o.lastSeen,
          })),
        )
        .onConflictDoUpdate({
          target: hotPosts.postId,
          set: {
            displayName: sql`coalesce(excluded.display_name, ${hotPosts.displayName})`,
            avatarUrl: sql`coalesce(excluded.avatar_url, ${hotPosts.avatarUrl})`,
            verified: sql`coalesce(excluded.verified, ${hotPosts.verified})`,
            followers: sql`coalesce(excluded.followers, ${hotPosts.followers})`,
            snippet: sql`coalesce(excluded.snippet, ${hotPosts.snippet})`,
            mediaUrl: sql`coalesce(excluded.media_url, ${hotPosts.mediaUrl})`,
            lang: sql`coalesce(excluded.lang, ${hotPosts.lang})`,
            views: sql`greatest(${hotPosts.views}, excluded.views)`,
            likes: sql`coalesce(excluded.likes, ${hotPosts.likes})`,
            retweets: sql`coalesce(excluded.retweets, ${hotPosts.retweets})`,
            replies: sql`coalesce(excluded.replies, ${hotPosts.replies})`,
            quotes: sql`coalesce(excluded.quotes, ${hotPosts.quotes})`,
            bookmarks: sql`coalesce(excluded.bookmarks, ${hotPosts.bookmarks})`,
            firstSeen: sql`least(${hotPosts.firstSeen}, excluded.first_seen)`,
            lastSeen: sql`greatest(${hotPosts.lastSeen}, excluded.last_seen)`,
          },
          // 很多人同时刷到同一条：浏览数没涨、离上次更新不到一个桶、资料也不缺，就不写新行版本
          setWhere: sql`excluded.views > ${hotPosts.views}
            or excluded.last_seen >= ${hotPosts.lastSeen} + ${BUCKET_MS}
            or excluded.first_seen < ${hotPosts.firstSeen}
            or (${hotPosts.displayName} is null and excluded.display_name is not null)`,
        }),
      db
        .insert(hotObservations)
        .values(sortedPoints.map((point) => ({ ...point, reporter, net })))
        .onConflictDoUpdate({
          target: [hotObservations.postId, hotObservations.bucket, hotObservations.reporter],
          set: { views: sql`greatest(${hotObservations.views}, excluded.views)` },
          setWhere: sql`excluded.views > ${hotObservations.views}`,
        }),
    ]),
  );
  return {
    status: 200,
    body: { accepted: observations.length, rejected, next_upload_ms: nextUploadMs },
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

export interface HotPost {
  postId: string;
  handle: string;
  displayName?: string;
  avatarUrl?: string;
  verified?: boolean;
  followers?: number;
  createdAt: number;
  snippet?: string;
  mediaUrl?: string;
  lang?: string;
  views: number;
  likes?: number;
  retweets?: number;
  replies?: number;
  quotes?: number;
  bookmarks?: number;
  velocity: number | null;
  breakout: number | null;
  heat: number;
  /** 榜内名次（从 1 开始）。 */
  rank: number;
  /** 第一次进这个榜的时刻（毫秒）。 */
  listedAt: number;
  /** 比约 30 分钟前的榜上升了几名（负数是下降）；null = 新上榜。 */
  rankDelta: number | null;
}

export interface HotBoards {
  generated_at: number;
  /** 旧版扩展读的字段：「飙升」榜。 */
  window_hours: number;
  posts: HotPost[];
  /** 「24 小时」榜。 */
  day: HotPost[];
  /** 本次上榜需要的不同会话数。 */
  min_reporters: number;
}

interface HotPostRow {
  post_id: string;
  handle: string;
  display_name: string | null;
  avatar_url: string | null;
  verified: number | null;
  followers: number | null;
  created_at: number;
  snippet: string | null;
  media_url: string | null;
  lang: string | null;
  likes: number | null;
  retweets: number | null;
  replies: number | null;
  quotes: number | null;
  bookmarks: number | null;
  first_seen: number;
}

type Candidate = Omit<HotPost, 'rank' | 'listedAt' | 'rankDelta'> & { firstSeen: number };

/** 按顺序挑：同一作者最多 AUTHOR_CAP 条。 */
export function capPerAuthor<T extends { handle: string }>(
  list: T[],
  cap: number,
  limit: number,
): T[] {
  const seen = new Map<string, number>();
  const out: T[] = [];
  for (const item of list) {
    const used = seen.get(item.handle) ?? 0;
    if (used >= cap) continue;
    seen.set(item.handle, used + 1);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

/** 在榜降权：满 BOARD_FULL_HOURS 后每 BOARD_HALF_LIFE_HOURS 减半。 */
export function boardDecay(hoursOnBoard: number): number {
  if (hoursOnBoard <= BOARD_FULL_HOURS) return 1;
  return Math.pow(0.5, (hoursOnBoard - BOARD_FULL_HOURS) / BOARD_HALF_LIFE_HOURS);
}

/**
 * 近期流速：最近一个点，和它之前至少 RECENT_GAP_MS 的点里最近的那个；
 * 没有这样的点时退回最早的点（间隔不足 10 分钟时由 velocityPerHour 走模型推算）。
 */
export function recentVelocity(
  createdAt: number,
  points: ViewObservation[],
): { velocity: number | null; latest: ViewObservation } | null {
  const latest = points.at(-1);
  if (!latest) return null;
  let previous: ViewObservation | undefined;
  for (let i = points.length - 2; i >= 0; i -= 1) {
    if (latest.at - points[i]!.at >= RECENT_GAP_MS) {
      previous = points[i];
      break;
    }
  }
  previous ??= points.length > 1 ? points[0] : undefined;
  const velocity = velocityPerHour({
    createdAt,
    views: latest.views,
    now: latest.at,
    ...(previous ? { previous } : {}),
  });
  return { velocity, latest };
}

function isSpam(row: HotPostRow): boolean {
  return (
    detect(
      {
        handle: row.handle,
        ...(row.display_name ? { displayName: row.display_name } : {}),
        ...(row.snippet ? { text: row.snippet } : {}),
      },
      { heuristics: HOT_LIST_HEURISTICS },
    ) !== null
  );
}

/** 从库里算两个榜（不读写 meta）。 */
export async function computeHotBoards(
  env: Cloudflare.Env,
  now = Date.now(),
): Promise<{ threshold: number; rising: Candidate[]; day: Candidate[] }> {
  const db = getDb(env);
  const notBlocklisted = notExists(
    db
      .select({ one: sql`1` })
      .from(accounts)
      .where(
        // 和公开名单同一口径（快照发布写入 accounts.listed）
        and(eq(accounts.handle, hotPosts.handle), eq(accounts.listed, 1)),
      ),
  );
  const columns = {
    post_id: hotPosts.postId,
    handle: hotPosts.handle,
    display_name: hotPosts.displayName,
    avatar_url: hotPosts.avatarUrl,
    verified: hotPosts.verified,
    followers: hotPosts.followers,
    created_at: hotPosts.createdAt,
    snippet: hotPosts.snippet,
    media_url: hotPosts.mediaUrl,
    lang: hotPosts.lang,
    likes: hotPosts.likes,
    retweets: hotPosts.retweets,
    replies: hotPosts.replies,
    quotes: hotPosts.quotes,
    bookmarks: hotPosts.bookmarks,
    first_seen: hotPosts.firstSeen,
  };
  // 活跃上报人数按网段数算（随机换会话 ID 抬不高门槛）；迁移前的旧观测没有网段，按会话算
  const netKey = sql`coalesce(${hotObservations.net}, 'r:' || ${hotObservations.reporter})`;
  const [active] = await db
    .select({ n: sql<number>`count(distinct ${netKey})::int` })
    .from(hotObservations)
    .where(gte(hotObservations.bucket, Math.floor((now - 2 * HOUR_MS) / BUCKET_MS)));
  const threshold = reporterThreshold(env, Number(active?.n ?? 0));
  // 门槛 ≥ 2 时还要求来自至少 2 个网段：一台机器换会话凑不出人数
  const netThreshold = Math.min(threshold, 2);
  // 门槛放进候选查询：不够人数的帖子（包括伪造的天量浏览）占不了候选池
  const seenEnough = (sinceMs: number) => sql`exists (
    select 1 from ${hotObservations}
    where ${hotObservations.postId} = ${hotPosts.postId}
      and ${hotObservations.bucket} >= ${Math.floor(sinceMs / BUCKET_MS)}
    group by ${hotObservations.postId}
    having count(distinct ${hotObservations.reporter}) >= ${threshold}
      and count(distinct ${netKey}) >= ${netThreshold})`;
  // 飙升候选：按「平均每小时浏览」取，新帖不会被大号旧帖挤出候选池
  const lifetimeRate = sql`${hotPosts.views}::float8 / greatest((${now}::float8 - ${hotPosts.createdAt}) / ${HOUR_MS}, 0.25)`;
  const [risingRows, dayRows] = await Promise.all([
    db
      .select(columns)
      .from(hotPosts)
      .where(
        and(
          gte(hotPosts.lastSeen, now - RISING_SEEN_MS),
          gte(hotPosts.createdAt, now - RISING_MAX_AGE_MS),
          gte(hotPosts.firstSeen, now - BOARD_MAX_HOURS * HOUR_MS),
          notBlocklisted,
          seenEnough(now - SERIES_WINDOW_MS),
        ),
      )
      .orderBy(desc(lifetimeRate))
      .limit(RISING_CANDIDATES),
    db
      .select(columns)
      .from(hotPosts)
      .where(
        and(
          gte(hotPosts.lastSeen, now - DAY_SEEN_MS),
          gte(hotPosts.createdAt, now - DAY_MAX_AGE_MS),
          notBlocklisted,
          seenEnough(now - SERIES_WINDOW_MS),
        ),
      )
      .orderBy(desc(hotPosts.views))
      .limit(DAY_CANDIDATES),
  ]);

  const rows = new Map<string, HotPostRow>();
  for (const row of [...risingRows, ...dayRows]) {
    if (!isSpam(row)) rows.set(row.post_id, row as HotPostRow);
  }
  if (rows.size === 0) return { threshold, rising: [], day: [] };

  const series = new Map<string, Map<number, number[]>>();
  const reporters = new Map<string, Set<string>>();
  const nets = new Map<string, Set<string>>();
  // 最近 RISING_SEEN_MS 里的会话：「飙升」的近期数字不能只靠一个人
  const recentReporters = new Map<string, Set<string>>();
  const recentBucket = Math.floor((now - RISING_SEEN_MS) / BUCKET_MS);
  const observationRows = await db
    .select({
      post_id: hotObservations.postId,
      bucket: hotObservations.bucket,
      reporter: hotObservations.reporter,
      views: hotObservations.views,
      net: hotObservations.net,
    })
    .from(hotObservations)
    .where(
      and(
        gte(hotObservations.bucket, Math.floor((now - SERIES_WINDOW_MS) / BUCKET_MS)),
        inArray(hotObservations.postId, [...rows.keys()]),
      ),
    );
  for (const obs of observationRows) {
    const buckets = series.get(obs.post_id) ?? new Map<number, number[]>();
    buckets.set(obs.bucket, [...(buckets.get(obs.bucket) ?? []), obs.views]);
    series.set(obs.post_id, buckets);
    const seen = reporters.get(obs.post_id) ?? new Set<string>();
    seen.add(obs.reporter);
    reporters.set(obs.post_id, seen);
    const seenNets = nets.get(obs.post_id) ?? new Set<string>();
    // 迁移前的旧观测没有网段：按会话算，不冤枉它们
    seenNets.add(obs.net ?? `r:${obs.reporter}`);
    nets.set(obs.post_id, seenNets);
    if (obs.bucket >= recentBucket) {
      const recent = recentReporters.get(obs.post_id) ?? new Set<string>();
      recent.add(obs.reporter);
      recentReporters.set(obs.post_id, recent);
    }
  }
  const recentThreshold = Math.min(threshold, 2);

  const risingIds = new Set(risingRows.map((row) => row.post_id));
  const dayIds = new Set(dayRows.map((row) => row.post_id));
  const rising: Candidate[] = [];
  const day: Candidate[] = [];
  for (const row of rows.values()) {
    if ((reporters.get(row.post_id)?.size ?? 0) < threshold) continue;
    if ((nets.get(row.post_id)?.size ?? 0) < netThreshold) continue;
    const points = [...(series.get(row.post_id) ?? new Map<number, number[]>()).entries()]
      .map(([bucket, values]): ViewObservation => ({
        at: (bucket + 1) * BUCKET_MS,
        views: median(values),
      }))
      .sort((a, b) => a.at - b.at);
    const measured = recentVelocity(row.created_at, points);
    if (!measured) continue;
    const { velocity, latest } = measured;
    // 各桶中位数里最大的那个：最新一桶只有一个落后的会话时，浏览数不会往回掉
    const peakViews = Math.max(...points.map((point) => point.views));
    const followers = row.followers ?? undefined;
    const breakout = breakoutRatio(latest.views, followers);
    const heat = heatScore({
      velocityPerHour: velocity,
      breakout,
      ageHours: ageHours(row.created_at, now),
    });
    if (heat === null) continue;
    const post: Candidate = {
      postId: row.post_id,
      handle: row.handle,
      createdAt: row.created_at,
      views: peakViews,
      velocity,
      breakout,
      heat,
      firstSeen: row.first_seen,
      ...pick({
        displayName: row.display_name ?? undefined,
        avatarUrl: row.avatar_url ?? undefined,
        mediaUrl: row.media_url ?? undefined,
        lang: row.lang ?? undefined,
        snippet: row.snippet ?? undefined,
        verified: row.verified === null ? undefined : row.verified === 1,
        followers,
        likes: row.likes ?? undefined,
        retweets: row.retweets ?? undefined,
        replies: row.replies ?? undefined,
        quotes: row.quotes ?? undefined,
        bookmarks: row.bookmarks ?? undefined,
      }),
    };
    // 「飙升」要流速到「火了」，最近 90 分钟还有人看到，在榜不满 12 小时；按热度 × 在榜降权排
    const hoursOnBoard = (now - row.first_seen) / HOUR_MS;
    if (
      risingIds.has(row.post_id) &&
      velocityLevel(velocity) !== 'none' &&
      latest.at >= now - RISING_SEEN_MS &&
      (recentReporters.get(row.post_id)?.size ?? 0) >= recentThreshold &&
      hoursOnBoard <= BOARD_MAX_HOURS
    ) {
      rising.push({ ...post, heat: heat * boardDecay(hoursOnBoard) });
    }
    if (dayIds.has(row.post_id)) day.push(post);
  }
  rising.sort((a, b) => b.heat - a.heat || compareText(a.postId, b.postId));
  day.sort((a, b) => b.views - a.views || compareText(a.postId, b.postId));
  return {
    threshold,
    rising: capPerAuthor(rising, AUTHOR_CAP, HOT_LIST_LIMIT),
    day: capPerAuthor(day, AUTHOR_CAP, DAY_LIST_LIMIT),
  };
}

/** 去掉只在服务端用的字段。 */
function publicPost(candidate: Candidate): Omit<HotPost, 'rank' | 'listedAt' | 'rankDelta'> {
  const post: Partial<Candidate> = { ...candidate };
  delete post.firstSeen;
  return post as Omit<HotPost, 'rank' | 'listedAt' | 'rankDelta'>;
}

interface RankSnapshot {
  at: number;
  posts: Record<string, number>;
  day: Record<string, number>;
}

/** 两代参照：每 30 分钟把 current 挪成 previous；名次变化和 previous（30–60 分钟前）比。 */
interface RankRef {
  current: RankSnapshot;
  previous?: RankSnapshot;
}

function parseJson<T>(value: string | undefined): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function ranksOf(list: HotPost[]): Record<string, number> {
  return Object.fromEntries(list.map((post) => [post.postId, post.rank]));
}

function listedMap(list: HotPost[] | undefined): Map<string, number> {
  return new Map((list ?? []).map((post) => [post.postId, post.listedAt]));
}

/** 算一版新榜并写进 meta：上榜时刻按榜沿用上一版，名次变化和 30–60 分钟前的参照比。 */
async function rebuildBoards(
  env: Cloudflare.Env,
  previous: HotBoards | null,
  now: number,
): Promise<HotBoards> {
  const db = getDb(env);
  const [computed, refRows] = await Promise.all([
    computeHotBoards(env, now),
    db.select({ value: meta.value }).from(meta).where(eq(meta.key, RANK_REF_KEY)),
  ]);
  const stored = parseJson<RankRef>(refRows[0]?.value);
  const ref = stored && typeof stored.current?.at === 'number' ? stored : null;
  // 和更早的那一代比；还没有更早的（刚上线的前 30 分钟）就和当前这一代比
  const compareWith = ref?.previous ?? ref?.current;
  const finish = (
    list: Candidate[],
    listed: Map<string, number>,
    refRanks: Record<string, number> | undefined,
  ): HotPost[] =>
    list.map((candidate, index) => {
      const rank = index + 1;
      const before = refRanks?.[candidate.postId];
      return {
        ...publicPost(candidate),
        rank,
        listedAt: listed.get(candidate.postId) ?? now,
        rankDelta: before === undefined ? null : before - rank,
      };
    });
  const boards: HotBoards = {
    generated_at: now,
    window_hours: 2,
    posts: finish(computed.rising, listedMap(previous?.posts), compareWith?.posts),
    day: finish(computed.day, listedMap(previous?.day), compareWith?.day),
    min_reporters: computed.threshold,
  };
  const writes: Promise<unknown>[] = [
    db
      .insert(meta)
      .values({ key: BOARD_KEY, value: JSON.stringify(boards) })
      .onConflictDoUpdate({ target: meta.key, set: { value: sql`excluded.value` } }),
  ];
  // 没有参照（第一次）时，第一版全部算「新上榜」，参照从这一版起
  if (!ref || now - ref.current.at >= RANK_REF_MS) {
    const next: RankRef = {
      current: { at: now, posts: ranksOf(boards.posts), day: ranksOf(boards.day) },
      ...(ref ? { previous: ref.current } : {}),
    };
    writes.push(
      db
        .insert(meta)
        .values({ key: RANK_REF_KEY, value: JSON.stringify(next) })
        .onConflictDoUpdate({ target: meta.key, set: { value: sql`excluded.value` } }),
    );
  }
  await Promise.all(writes);
  return boards;
}

/** 抢重算锁：锁空着或已过期才拿得到。锁值是「时刻:令牌」，释放时只删自己的那把。 */
async function takeBoardLock(env: Cloudflare.Env, now: number): Promise<string | null> {
  const token = `${now}:${crypto.randomUUID()}`;
  const rows = await getDb(env)
    .insert(meta)
    .values({ key: BOARD_LOCK_KEY, value: token })
    .onConflictDoUpdate({
      target: meta.key,
      set: { value: sql`excluded.value` },
      setWhere: sql`split_part(${meta.value}, ':', 1)::bigint < ${now - BOARD_LOCK_MS}`,
    })
    .returning({ key: meta.key });
  return rows.length > 0 ? token : null;
}

async function readBoards(env: Cloudflare.Env): Promise<HotBoards | null> {
  const stored = await getDb(env)
    .select({ value: meta.value })
    .from(meta)
    .where(eq(meta.key, BOARD_KEY));
  const boards = parseJson<HotBoards>(stored[0]?.value);
  // 旧格式（没有 day）当作没有，重算一版
  return boards && Array.isArray(boards.posts) && Array.isArray(boards.day) ? boards : null;
}

function isFresh(boards: HotBoards | null, now: number): boards is HotBoards {
  return boards !== null && now - boards.generated_at < BOARD_TTL_MS;
}

/** 不写库，现算一版（没抢到锁、也没有旧版时用）。 */
async function computeOnce(env: Cloudflare.Env, now: number): Promise<HotBoards> {
  const computed = await computeHotBoards(env, now);
  const finish = (list: Candidate[]): HotPost[] =>
    list.map((candidate, index) => ({
      ...publicPost(candidate),
      rank: index + 1,
      listedAt: now,
      rankDelta: null,
    }));
  return {
    generated_at: now,
    window_hours: 2,
    posts: finish(computed.rising),
    day: finish(computed.day),
    min_reporters: computed.threshold,
  };
}

/**
 * 全站热榜：存好的那版不到 5 分钟就直接回；过期了由抢到锁的那个请求重算，
 * 其余请求先回旧版（没有旧版时各自算一次、不写库）。重算失败时有旧版就回旧版。
 */
export async function getHotBoards(env: Cloudflare.Env, now = Date.now()): Promise<HotBoards> {
  const current = await readBoards(env);
  if (isFresh(current, now)) return current;
  const token = await takeBoardLock(env, now);
  if (!token) return current ?? computeOnce(env, now);
  const db = getDb(env);
  try {
    // 抢到锁前别人可能刚算完：再读一次，免得重复算、把刚上榜的时刻冲掉
    const latest = await readBoards(env);
    if (isFresh(latest, now)) return latest;
    return await rebuildBoards(env, latest ?? current, now);
  } catch (error) {
    if (!current) throw error;
    console.error('[community-api] hot board rebuild failed', error);
    return current;
  } finally {
    await db
      .delete(meta)
      .where(and(eq(meta.key, BOARD_LOCK_KEY), eq(meta.value, token)))
      .catch(() => undefined);
  }
}

/** cron：清理过期观测与帖子。 */
export async function cleanupHotData(env: Cloudflare.Env, now = Date.now()): Promise<void> {
  const db = getDb(env);
  await Promise.all([
    db
      .delete(hotObservations)
      .where(lt(hotObservations.bucket, Math.floor((now - OBSERVATION_RETENTION_MS) / BUCKET_MS))),
    db.delete(hotPosts).where(lt(hotPosts.lastSeen, now - POST_RETENTION_MS)),
  ]);
}
