/**
 * 主页洞察的众包帖子库：一个人看过的博主帖子，其他人打开同一个主页时直接拿到。
 *
 * - POST /v1/profile-observations：扩展把「用户正常浏览时 X 已经返回的」博主公开帖子数字报上来。
 *   扩展只报有变化的帖子（增量，见 apps/extension/src/lib/insight/profile-sync.ts），不为此多请求 X。
 * - GET /v1/profiles/:handle?cursor=…：按「最后变化时刻」增量拉取。第一次不带游标拿全量，
 *   之后带上次返回的游标，只拿这期间有变化的帖子。
 *
 * 去重与合并（同一条帖子不管多少人报，只存一行）：
 * - 帖子以 post_id 为主键；作者以第一次收到的为准，之后不改（防止把别人的帖子挂到另一个人名下）。
 * - 计数只增不减（取大）：X 的浏览、点赞基本只涨；乱序到达的旧观测不会把数字改小。
 * - 正文、媒体、类型、语言以第一次收到的为准，之后不改（防止有人把垃圾文案、别的图片挂到真实帖子上）；
 *   置顶一旦报过就保留。
 * - 合并后真有变化才更新 updated_at；作者对不上的上报不合并。
 * - 重复上报同样的数字、被拒收的数字都不产生新的增量。
 * - 拉取只返回 1 分钟以前提交的变化（PROFILE_SETTLE_MS）：并发请求的提交顺序和时间戳不一致时，
 *   游标也不会跳过晚提交的行。
 *
 * 防伪造：
 * - 发帖时间必须和帖子 ID 里的 snowflake 时间一致（误差 5 分钟内），伪造的 ID / 时间整条丢弃；
 * - 发出超过 72 小时、已有 1000 以上浏览的帖子，单次上报的浏览超过已有值 3 倍的不采信（老帖子浏览已经稳定）；
 * - 只收粉丝 ≥ 1000 的博主（docs/07 §3.1，2026-10-30 定）：数据太少做不出基线，也更接近普通人；
 *   本次请求或服务端已有的资料里粉丝数要达到门槛，否则帖子整条丢弃；
 * - 社区黑名单里的账号不收；
 * - 会话、IP 双维度每日限额，另外同一 IP 给同一个博主每天最多 2000 条。
 * 一个人报上来就对所有人可见（不要求多人一致，2026-10-31 定：一个人看过、所有人受益），
 * 靠上面几条挡伪造。
 *
 * 隐私：不收安装 ID、不收上报者自己的 X 账号；每日轮换的随机会话 ID 加盐哈希后只用于限额，不和帖子存在一起；
 * 帖子的 first_seen 取整到天。拉取请求里服务端能看到 IP 和博主 handle（和访问任何网站一样），
 * 但不记录二者的对应关系：限额表只存 IP 的加盐哈希和当天次数，不存 handle。
 *
 * 容量：不设条数上限、不删数据（众包攒下来的历史就是价值），靠表结构省空间，见 db/schema.ts 的 profilePosts
 * 和 docs/07 §3.7：post_id 存 bigint、发帖时间从 ID 算、作者存 4 字节编号、类型 / 媒体 / 置顶压进 flags、
 * 图片地址去前缀；只给 creator_id 建索引，数字更新走 HOT 不碰索引。
 */
import { and, eq, inArray, like, lt, lte, sql, type AnyColumn } from 'drizzle-orm';
import { snowflakeTime } from '@feedsieve/metrics';
import { getDb, retryOnConflict } from './db/client';
import {
  accounts as communityAccounts,
  profileAccounts,
  profilePosts,
  trainingSampleUsage,
} from './db/schema';
import { hotSalt } from './hot';
import { hashInstallationId, hashIp } from './lib/hash';
import { compareText, stripNul } from './lib/sql';
import { chargeUsageInOrder } from './lib/usage';
import { utcToday } from './lib/time';

/** 一次请求最多这么多条帖子 / 账号。 */
export const MAX_PROFILE_POSTS_PER_REQUEST = 200;
export const MAX_PROFILE_ACCOUNTS_PER_REQUEST = 20;
/** 每个会话、每个 IP 每天最多上报这么多条（帖子 + 账号）。正常看一天主页远到不了。 */
const SESSION_DAILY_LIMIT = 20_000;
const IP_DAILY_LIMIT = 200_000;
/** 一次拉取最多返回这么多条，没拉完时 complete=false，带游标继续拉。 */
export const PROFILE_PAGE_LIMIT = 1_000;
/** 发帖时间和 snowflake 时间的允许误差。 */
const SNOWFLAKE_TOLERANCE_MS = 5 * 60_000;
/** 老帖子浏览突增的判定：发出超过 72 小时、已有 1000 以上浏览，单次涨到 3 倍以上不采信。 */
const STABLE_AGE_MS = 72 * 60 * 60_000;
const STABLE_MIN_VIEWS = 1_000;
/** 点赞等其他计数的同一条规则从这个数开始。 */
const STABLE_MIN_COUNT = 50;
/** 每个 IP 每天给同一个博主最多报这么多条帖子：一个人把一个博主的主页翻到底也就 1000 条。 */
const IP_HANDLE_DAILY_LIMIT = 2_000;
/** 拉取只返回至少这么久以前提交的变化：并发写入的提交顺序和时间戳不一致时，游标也不会跳过它们。 */
export const PROFILE_SETTLE_MS = 60_000;
const STABLE_MAX_JUMP = 3;
/** 粉丝少于这么多的博主不收。 */
export const MIN_PROFILE_FOLLOWERS = 1_000;

const POST_ID = /^\d{1,20}$/;
const HANDLE = /^[a-z0-9_]{1,15}$/;
const TWIMG_URL = /^https:\/\/pbs\.twimg\.com\/[\w./-]{1,300}$/;
const LANG = /^[a-z]{2,3}(-[a-z]{2,4})?$/;
const KINDS = new Set(['original', 'reply', 'quote']);
const MEDIA = new Set(['none', 'photo', 'video', 'gif', 'mixed']);
const COUNT_KEYS = ['views', 'likes', 'retweets', 'replies', 'quotes', 'bookmarks'] as const;
const COUNT_MAX = 1e12;
/** 除浏览以外的计数存 integer。 */
const INT_MAX = 2_147_483_647;
const TWIMG_PREFIX = 'https://pbs.twimg.com/';
const TWITTER_EPOCH = 1288834974657;

/** flags：低 2 位类型，接着 3 位媒体类型，第 6 位置顶；0 表示不知道。 */
const KIND_CODE: Record<string, number> = { original: 1, reply: 2, quote: 3 };
const MEDIA_CODE: Record<string, number> = { none: 1, photo: 2, video: 3, gif: 4, mixed: 5 };
const KIND_MASK = 0b11;
const MEDIA_SHIFT = 2;
const MEDIA_MASK = 0b111 << MEDIA_SHIFT;
const PINNED_BIT = 1 << 5;

export function encodeFlags(post: { kind?: string; media?: string; pinned?: boolean }): number {
  return (
    (KIND_CODE[post.kind ?? ''] ?? 0) |
    ((MEDIA_CODE[post.media ?? ''] ?? 0) << MEDIA_SHIFT) |
    (post.pinned ? PINNED_BIT : 0)
  );
}

export function decodeFlags(flags: number): { kind?: string; media?: string; pinned?: boolean } {
  const kind = Object.keys(KIND_CODE).find((key) => KIND_CODE[key] === (flags & KIND_MASK));
  const media = Object.keys(MEDIA_CODE).find(
    (key) => MEDIA_CODE[key] === (flags & MEDIA_MASK) >> MEDIA_SHIFT,
  );
  return pick({ kind, media, pinned: flags & PINNED_BIT ? true : undefined });
}
const TIMESTAMP_MIN = Date.UTC(2006, 0, 1);

type CountKey = (typeof COUNT_KEYS)[number];
type CountColumn = CountKey;

export interface ProfilePostInput {
  postId: string;
  handle: string;
  createdAt: number;
  kind?: string;
  media?: string;
  pinned?: boolean;
  snippet?: string;
  mediaUrl?: string;
  lang?: string;
  views?: number;
  likes?: number;
  retweets?: number;
  replies?: number;
  quotes?: number;
  bookmarks?: number;
}

export interface ProfileAccountInput {
  handle: string;
  displayName?: string;
  avatarUrl?: string;
  verified?: boolean;
  followers?: number;
  followingCount?: number;
  tweets?: number;
  joinedAt?: number;
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

function handleOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const handle = value.toLowerCase();
  return HANDLE.test(handle) ? handle : null;
}

function pick<T extends Record<string, unknown>>(record: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined) (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

/** 单条帖子的严格校验；不合格整条丢弃。发帖时间以 snowflake 为准。 */
export function parseProfilePost(raw: unknown, now: number): ProfilePostInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const postId = typeof r.post_id === 'string' && POST_ID.test(r.post_id) ? r.post_id : null;
  const handle = handleOf(r.handle);
  if (!postId || !handle) return null;
  const minted = snowflakeTime(postId);
  if (
    minted === null ||
    minted < TIMESTAMP_MIN ||
    minted > now + SNOWFLAKE_TOLERANCE_MS ||
    typeof r.created_at !== 'number' ||
    Math.abs(r.created_at - minted) > SNOWFLAKE_TOLERANCE_MS
  ) {
    return null;
  }
  const counts = Object.fromEntries(
    COUNT_KEYS.map((key) => {
      const value = count(r[key]);
      return [key, key === 'views' || value === undefined ? value : Math.min(value, INT_MAX)];
    }),
  ) as Record<CountKey, number | undefined>;
  // 一条帖子至少要带浏览或点赞，才有洞察价值
  if (counts.views === undefined && counts.likes === undefined) return null;
  return {
    postId,
    handle,
    createdAt: minted,
    ...pick({
      kind: typeof r.kind === 'string' && KINDS.has(r.kind) ? r.kind : undefined,
      media: typeof r.media === 'string' && MEDIA.has(r.media) ? r.media : undefined,
      pinned: typeof r.pinned === 'boolean' ? r.pinned : undefined,
      snippet: text(r.snippet, 280),
      mediaUrl: image(r.media_url),
      lang: typeof r.lang === 'string' && LANG.test(r.lang) ? r.lang : undefined,
      ...counts,
    }),
  };
}

export function parseProfileAccount(raw: unknown, now: number): ProfileAccountInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const handle = handleOf(r.handle);
  if (!handle) return null;
  const joinedAt =
    typeof r.joined_at === 'number' && r.joined_at >= TIMESTAMP_MIN && r.joined_at <= now
      ? Math.floor(r.joined_at)
      : undefined;
  return {
    handle,
    ...pick({
      displayName: text(r.display_name, 64),
      avatarUrl: image(r.avatar_url),
      verified: typeof r.verified === 'boolean' ? r.verified : undefined,
      followers: count(r.followers),
      followingCount: count(r.following_count),
      tweets: count(r.tweets),
      joinedAt,
    }),
  };
}

/** 同一请求里同一帖子出现多次：折叠成一条（计数取大，后到的非空字段覆盖）。 */
function foldPosts(posts: ProfilePostInput[]): ProfilePostInput[] {
  const folded = new Map<string, ProfilePostInput>();
  for (const post of posts) {
    const known = folded.get(post.postId);
    if (!known) {
      folded.set(post.postId, { ...post });
      continue;
    }
    for (const key of COUNT_KEYS) {
      const a = known[key];
      const b = post[key];
      if (b !== undefined) known[key] = a === undefined ? b : Math.max(a, b);
    }
    // 其余字段：后到的非空值覆盖（主键、作者、发帖时间不动）
    for (const key of ['kind', 'media', 'pinned', 'snippet', 'mediaUrl', 'lang'] as const) {
      if (post[key] !== undefined) (known as unknown as Record<string, unknown>)[key] = post[key];
    }
  }
  // 按主键（数值）排序：并发请求以相同顺序锁行，避免死锁
  return [...folded.values()].sort((a, b) => {
    const x = BigInt(a.postId);
    const y = BigInt(b.postId);
    return x < y ? -1 : x > y ? 1 : 0;
  });
}

function foldAccounts(accounts: ProfileAccountInput[]): ProfileAccountInput[] {
  const folded = new Map<string, ProfileAccountInput>();
  for (const account of accounts) {
    const known = folded.get(account.handle);
    folded.set(account.handle, known ? { ...known, ...pick({ ...account }) } : { ...account });
  }
  return [...folded.values()].sort((a, b) => compareText(a.handle, b.handle));
}

type IngestResult =
  | { status: 200; body: { accepted: number; rejected: number } }
  | { status: 400 | 429; body: { error: string } };

export async function ingestProfileObservations(
  env: Cloudflare.Env,
  raw: unknown,
  ip: string | undefined,
  now = Date.now(),
): Promise<IngestResult> {
  const body = raw as Record<string, unknown> | null;
  const rawPosts = body && Array.isArray(body.posts) ? body.posts : [];
  const rawAccounts = body && Array.isArray(body.accounts) ? body.accounts : [];
  if (
    !body ||
    typeof body.session_id !== 'string' ||
    !/^[0-9a-f-]{16,64}$/i.test(body.session_id) ||
    (body.posts !== undefined && !Array.isArray(body.posts)) ||
    (body.accounts !== undefined && !Array.isArray(body.accounts)) ||
    rawPosts.length + rawAccounts.length < 1 ||
    rawPosts.length > MAX_PROFILE_POSTS_PER_REQUEST ||
    rawAccounts.length > MAX_PROFILE_ACCOUNTS_PER_REQUEST
  ) {
    return { status: 400, body: { error: 'invalid_profile_observations' } };
  }
  const parsedPosts = rawPosts
    .map((item) => parseProfilePost(item, now))
    .filter((item): item is ProfilePostInput => item !== null);
  const parsedAccounts = rawAccounts
    .map((item) => parseProfileAccount(item, now))
    .filter((item): item is ProfileAccountInput => item !== null);
  const db = getDb(env);
  const allowed = await eligibleHandles(
    db,
    [...new Set([...parsedPosts.map((p) => p.handle), ...parsedAccounts.map((a) => a.handle)])],
    parsedAccounts,
  );
  let posts = foldPosts(parsedPosts.filter((post) => allowed.has(post.handle)));
  const accounts = foldAccounts(parsedAccounts.filter((account) => allowed.has(account.handle)));
  if (posts.length === 0 && accounts.length === 0) {
    return { status: 200, body: { accepted: 0, rejected: rawPosts.length + rawAccounts.length } };
  }

  const salt = hotSalt(env);
  const reporter = await hashInstallationId(salt, `profile:${body.session_id}`);
  const limits: Array<[string, number]> = [[`profile-session:${reporter}`, SESSION_DAILY_LIMIT]];
  if (ip) limits.push([`profile-ip:${await hashIp(salt, ip)}`, IP_DAILY_LIMIT]);
  const day = utcToday();
  if (!(await chargeUsageInOrder(db, day, posts.length + accounts.length, limits))) {
    return { status: 429, body: { error: 'rate_limited' } };
  }
  // 同一个 IP 给同一个博主每天最多报这么多条：一个人刷不爆某个博主的帖子库
  if (ip) {
    const ipHash = await hashIp(salt, ip);
    const perHandle = new Map<string, number>();
    for (const post of posts) perHandle.set(post.handle, (perHandle.get(post.handle) ?? 0) + 1);
    const refused = new Set<string>();
    for (const [handle, units] of [...perHandle].sort((x, y) => compareText(x[0], y[0]))) {
      const identity = `profile-ip-handle:${ipHash}:${handle}`;
      if (!(await chargeUsageInOrder(db, day, units, [[identity, IP_HANDLE_DAILY_LIMIT]]))) {
        refused.add(handle);
      }
    }
    if (refused.size > 0) posts = posts.filter((post) => !refused.has(post.handle));
  }
  const acceptedCount = posts.length + accounts.length;
  const rejected = rawPosts.length + rawAccounts.length - acceptedCount;

  const a = profileAccounts;
  const p = profilePosts;
  // 发帖时间从 snowflake ID 算（表里不存）
  const createdAtSql = sql`((${p.postId} >> 22) + ${TWITTER_EPOCH}::bigint)`;
  const createdBefore = now - STABLE_AGE_MS;
  /**
   * 计数合并：只增不减；发出超过 72 小时、数字已经不小的老帖子，单次涨到 3 倍以上不采信（老帖子的数字已经稳定）。
   */
  const mergeCount = (column: AnyColumn, name: CountColumn, floor: number) => {
    const incoming = sql.raw(`excluded.${name}`);
    return sql`(case
      when ${incoming} is null then ${column}
      when ${column} is null then ${incoming}
      when ${incoming} <= ${column} then ${column}
      when ${createdAtSql} < ${createdBefore}::bigint
        and ${column} >= ${floor}
        and ${incoming} > ${column} * ${STABLE_MAX_JUMP} then ${column}
      else ${incoming} end)`;
  };
  const merged = {
    views: mergeCount(p.views, 'views', STABLE_MIN_VIEWS),
    likes: mergeCount(p.likes, 'likes', STABLE_MIN_COUNT),
    retweets: mergeCount(p.retweets, 'retweets', STABLE_MIN_COUNT),
    replies: mergeCount(p.replies, 'replies', STABLE_MIN_COUNT),
    quotes: mergeCount(p.quotes, 'quotes', STABLE_MIN_COUNT),
    bookmarks: mergeCount(p.bookmarks, 'bookmarks', STABLE_MIN_COUNT),
    // 正文、图片、类型、媒体类型、语言：先到先得，之后不改（防止把垃圾文案、别的图片挂到真实帖子上）；
    // 置顶报过就保留
    flags: sql`(${p.flags}
      | (excluded.flags & ${PINNED_BIT})
      | (case when ${p.flags} & ${KIND_MASK} = 0 then excluded.flags & ${KIND_MASK} else 0 end)
      | (case when ${p.flags} & ${MEDIA_MASK} = 0 then excluded.flags & ${MEDIA_MASK} else 0 end))::smallint`,
    snippet: sql`coalesce(${p.snippet}, excluded.snippet)`,
    media: sql`coalesce(${p.media}, excluded.media)`,
    lang: sql`coalesce(${p.lang}, excluded.lang)`,
  };
  const columns: Record<keyof typeof merged, AnyColumn> = {
    views: p.views,
    likes: p.likes,
    retweets: p.retweets,
    replies: p.replies,
    quotes: p.quotes,
    bookmarks: p.bookmarks,
    flags: p.flags,
    snippet: p.snippet,
    media: p.media,
    lang: p.lang,
  };
  // 合并后真有变化才更新：updated_at 是增量拉取的游标，被拒收的数字不能刷新它。
  // 作者对不上的不合并（不把别人报的数字记到错的作者名下）
  const changed = sql`${p.creatorId} = excluded.creator_id and (${sql.join(
    Object.entries(merged).map(
      ([key, value]) => sql`${value} is distinct from ${columns[key as keyof typeof merged]}`,
    ),
    sql` or `,
  )})`;

  await retryOnConflict(async () => {
    // 先写资料（拿到作者编号），再写帖子
    if (accounts.length > 0) {
      await db
        .insert(a)
        .values(
          accounts.map((account) => ({
            handle: account.handle,
            displayName: account.displayName ?? null,
            avatarUrl: account.avatarUrl ?? null,
            verified: account.verified === undefined ? null : account.verified ? 1 : 0,
            followers: account.followers ?? null,
            followingCount: account.followingCount ?? null,
            tweets: account.tweets ?? null,
            joinedAt: account.joinedAt ?? null,
            updatedAt: now,
          })),
        )
        .onConflictDoUpdate({
          target: a.handle,
          // 资料取最新的非空值；粉丝数会涨也会掉，但一次变化超过一倍（或掉到一半以下）不采信，
          // 防止有人把博主的粉丝数改成 0 让他的帖子被拒收
          set: {
            displayName: sql`coalesce(excluded.display_name, ${a.displayName})`,
            avatarUrl: sql`coalesce(excluded.avatar_url, ${a.avatarUrl})`,
            verified: sql`coalesce(excluded.verified, ${a.verified})`,
            followers: sql`case
              when excluded.followers is null then ${a.followers}
              when ${a.followers} is null then excluded.followers
              when excluded.followers * 2 < ${a.followers}
                or excluded.followers > ${a.followers} * 2 + 1000 then ${a.followers}
              else excluded.followers end`,
            followingCount: sql`coalesce(excluded.following_count, ${a.followingCount})`,
            tweets: sql`coalesce(excluded.tweets, ${a.tweets})`,
            joinedAt: sql`coalesce(excluded.joined_at, ${a.joinedAt})`,
            updatedAt: sql`${now}::bigint`,
          },
        });
    }
    if (posts.length === 0) return;
    const ids = new Map(
      (
        await db
          .select({ handle: a.handle, id: a.id })
          .from(a)
          .where(inArray(a.handle, [...new Set(posts.map((post) => post.handle))]))
      ).map((row) => [row.handle, row.id]),
    );
    const rows = posts.flatMap((post) => {
      const creatorId = ids.get(post.handle);
      if (creatorId === undefined) return [];
      return [
        {
          postId: BigInt(post.postId),
          creatorId,
          flags: encodeFlags(post),
          lang: post.lang ?? null,
          snippet: post.snippet ?? null,
          media: post.mediaUrl?.startsWith(TWIMG_PREFIX)
            ? post.mediaUrl.slice(TWIMG_PREFIX.length)
            : null,
          views: post.views ?? null,
          likes: post.likes ?? null,
          retweets: post.retweets ?? null,
          replies: post.replies ?? null,
          quotes: post.quotes ?? null,
          bookmarks: post.bookmarks ?? null,
          updatedAt: now,
        },
      ];
    });
    if (rows.length === 0) return;
    await db
      .insert(p)
      .values(rows)
      .onConflictDoUpdate({
        target: p.postId,
        set: { ...merged, updatedAt: sql`${now}::bigint` },
        setWhere: changed,
      });
  });
  return { status: 200, body: { accepted: acceptedCount, rejected } };
}

/**
 * 能收的博主：粉丝数达到门槛（本次请求里的资料优先，其次服务端已有的），且不在社区黑名单里。
 */
async function eligibleHandles(
  db: ReturnType<typeof getDb>,
  handles: string[],
  reported: ProfileAccountInput[],
): Promise<Set<string>> {
  if (handles.length === 0) return new Set();
  const [known, blocked] = await Promise.all([
    db
      .select({ handle: profileAccounts.handle, followers: profileAccounts.followers })
      .from(profileAccounts)
      .where(inArray(profileAccounts.handle, handles)),
    db
      .select({ handle: communityAccounts.handle })
      .from(communityAccounts)
      .where(
        // 和公开名单同一口径（快照发布写入 accounts.listed）
        and(inArray(communityAccounts.handle, handles), eq(communityAccounts.listed, 1)),
      ),
  ]);
  // 服务端已有的粉丝数优先：本次请求里自报的只用于第一次收这个博主
  const followers = new Map<string, number>();
  for (const account of reported) {
    if (account.followers !== undefined) followers.set(account.handle, account.followers);
  }
  for (const row of known) if (row.followers !== null) followers.set(row.handle, row.followers);
  const banned = new Set(blocked.map((row) => row.handle));
  return new Set(
    handles.filter(
      (handle) => !banned.has(handle) && (followers.get(handle) ?? 0) >= MIN_PROFILE_FOLLOWERS,
    ),
  );
}

export interface ProfilePostOutput {
  post_id: string;
  created_at: number;
  kind?: string;
  media?: string;
  pinned?: boolean;
  snippet?: string;
  media_url?: string;
  lang?: string;
  views?: number;
  likes?: number;
  retweets?: number;
  replies?: number;
  quotes?: number;
  bookmarks?: number;
}

export interface ProfileResponse {
  handle: string;
  account: {
    display_name?: string;
    avatar_url?: string;
    verified?: boolean;
    followers?: number;
    following_count?: number;
    tweets?: number;
    joined_at?: number;
    updated_at: number;
  } | null;
  posts: ProfilePostOutput[];
  /** 下次增量拉取带上它；没有新内容时和传入的一样。 */
  cursor: string;
  /** false：这一页没拉完，带着 cursor 马上再拉一次。 */
  complete: boolean;
  generated_at: number;
}

/** 每个 IP 每天最多拉这么多次（只算没命中边缘缓存的）；正常用户一天打开不了这么多主页。 */
export const PROFILE_READ_IP_DAILY_LIMIT = 3_000;

/** 拉取限额：没有 IP（本地开发）时不限。 */
export async function chargeProfileRead(
  env: Cloudflare.Env,
  ip: string | undefined,
): Promise<boolean> {
  if (!ip) return true;
  const identity = `profile-read-ip:${await hashIp(hotSalt(env), ip)}`;
  return chargeUsageInOrder(getDb(env), utcToday(), 1, [[identity, PROFILE_READ_IP_DAILY_LIMIT]]);
}

/** 游标：`<updated_at 毫秒>_<post_id>`；同一时刻更新的多行靠 post_id 排出先后，翻页不漏不重。 */
export function parseCursor(value: string | undefined): { at: number; postId: string } | null {
  if (!value) return { at: 0, postId: '' };
  const match = /^(\d{1,15})_(\d{0,20})$/.exec(value);
  if (!match) return null;
  return { at: Number(match[1]), postId: match[2]! };
}

export async function getProfile(
  env: Cloudflare.Env,
  rawHandle: string,
  rawCursor: string | undefined,
  now = Date.now(),
): Promise<ProfileResponse | null> {
  const handle = handleOf(rawHandle);
  const cursor = parseCursor(rawCursor);
  if (!handle || !cursor) return null;
  const db = getDb(env);
  const empty = {
    handle,
    account: null,
    posts: [],
    cursor: `${cursor.at}_${cursor.postId}`,
    complete: true,
    generated_at: now,
  };
  const [banned] = await db
    .select({ handle: communityAccounts.handle })
    .from(communityAccounts)
    .where(and(eq(communityAccounts.handle, handle), eq(communityAccounts.listed, 1)))
    .limit(1);
  // 社区黑名单里的账号：不给
  if (banned) return empty;
  const [account] = await db
    .select()
    .from(profileAccounts)
    .where(eq(profileAccounts.handle, handle))
    .limit(1);
  if (!account) return empty;
  const p = profilePosts;
  const rows = await db
    .select({
      // 驱动把 int8 统一读成 JS number（client.ts），帖子 ID 超过 2^53 会丢精度：按文本读
      postId: sql<string>`${p.postId}::text`,
      flags: p.flags,
      lang: p.lang,
      snippet: p.snippet,
      media: p.media,
      views: p.views,
      likes: p.likes,
      retweets: p.retweets,
      replies: p.replies,
      quotes: p.quotes,
      bookmarks: p.bookmarks,
      updatedAt: p.updatedAt,
    })
    .from(profilePosts)
    .where(
      and(
        eq(profilePosts.creatorId, account.id),
        lte(profilePosts.updatedAt, now - PROFILE_SETTLE_MS),
        sql`(${profilePosts.updatedAt}, ${profilePosts.postId}) > (${cursor.at}::bigint, ${cursor.postId || '0'}::bigint)`,
      ),
    )
    .orderBy(profilePosts.updatedAt, profilePosts.postId)
    .limit(PROFILE_PAGE_LIMIT);
  const last = rows.at(-1);
  return {
    handle,
    account: {
      updated_at: account.updatedAt,
      ...pick({
        display_name: account.displayName ?? undefined,
        avatar_url: account.avatarUrl ?? undefined,
        verified: account.verified === null ? undefined : account.verified === 1,
        followers: account.followers ?? undefined,
        following_count: account.followingCount ?? undefined,
        tweets: account.tweets ?? undefined,
        joined_at: account.joinedAt ?? undefined,
      }),
    },
    posts: rows.map((row) => {
      const postId = row.postId;
      return {
        post_id: postId,
        created_at: snowflakeTime(postId) ?? 0,
        ...decodeFlags(row.flags),
        ...pick({
          snippet: row.snippet ?? undefined,
          media_url: row.media ? TWIMG_PREFIX + row.media : undefined,
          lang: row.lang ?? undefined,
          views: row.views ?? undefined,
          likes: row.likes ?? undefined,
          retweets: row.retweets ?? undefined,
          replies: row.replies ?? undefined,
          quotes: row.quotes ?? undefined,
          bookmarks: row.bookmarks ?? undefined,
        }),
      };
    }),
    cursor: last ? `${last.updatedAt}_${last.postId}` : `${cursor.at}_${cursor.postId}`,
    complete: rows.length < PROFILE_PAGE_LIMIT,
    generated_at: now,
  };
}

/**
 * cron：主页相关的限额计数只有当天的有用（同一 IP × 博主一天一行，量最大），过了当天就删；
 * 其余计数表项仍按 7 天清理（scheduled.ts）。不删任何帖子数据。
 */
export async function cleanupProfileCounters(env: Cloudflare.Env): Promise<void> {
  await getDb(env)
    .delete(trainingSampleUsage)
    .where(
      and(like(trainingSampleUsage.identity, 'profile-%'), lt(trainingSampleUsage.day, utcToday())),
    );
}
