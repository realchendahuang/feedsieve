/**
 * 主页洞察的本地帖子库（后台 service worker）。
 *
 * 用户打开某个博主的主页，就给这个博主建一份帖子库；之后在任何页面（主页、首页、搜索、详情）
 * 看到这个博主的帖子，都收进来。数据全部来自用户正常浏览时 X 已经返回给页面的响应，
 * 扩展不为此多请求 X 一次，也不自动滚动页面（docs/07 §2.3）。
 *
 * 存在 storage.local（需要 unlimitedStorage 权限）：主页洞察的价值在于积累，要跨浏览器重启保留。
 * 不设博主数上限、不设每博主帖子数上限、不淘汰任何数据（和服务端众包库一致：攒下来的历史就是价值）。
 * 设置里可以一键清空。
 *
 * 分片存储（避免帖子无限增长时写盘越来越慢）：
 * - `profileV2:<handle>` → 这个博主的元数据（account + 访问时间 + 游标 + 分片列表），小而固定。
 * - `profileV2:<handle>#<n>` → 第 n 个分片，key 是 postId。n 是发帖时间所在的 30 天窗口号
 *   （从 snowflake 算，见 shardOf）：同一时期的帖子落同一片，老帖子的数字更新落回它原来的分片。
 *   每次写盘只重写被改动的那几个分片 + 元数据，不整份重写；帖子再多，单次写入成本也恒定。
 * - 读取（get）把所有分片聚合成一份完整的 CatalogEntry：爆款分析、排序、导出都要全量，这个契约不变。
 * 老格式（profileV1:<handle> 单 blob）在第一次读到时就地拆成 V2，老 key 删掉。
 *
 * 众包（profile-sync.ts）：服务端帖子库的内容用 mergeRemote 合并进来，和本机收到的同样规则
 * （计数只增不减）；每条帖子记下服务端已知的浏览数（syncedViews），只把比它新的报上去。
 */
import type { ProfilePost, ProfilePostKind, ProfilePostMedia } from '@feedsieve/metrics';

export const PROFILE_INDEX_KEY = 'profileIndexV1';
/** V2：元数据在 PROFILE_META_PREFIX+handle，帖子分片在 …+'#'+n。 */
export const PROFILE_META_PREFIX = 'profileV2:';
/** V1 旧格式（单 blob）：读到就地迁移成 V2 后删掉。 */
export const PROFILE_KEY_PREFIX = 'profileV1:';
export const PROFILE_UPDATED_MESSAGE = 'feedsieve:profile-updated';
/** 一个博主的帖子库可能有几百 KB：攒 5 秒再写，滚动时不频繁整份重写。 */
const PERSIST_DELAY_MS = 5_000;
const BROADCAST_DELAY_MS = 1_000;

const HANDLE = /^[a-z0-9_]{1,15}$/;
const POST_ID = /^\d{1,20}$/;
const TWIMG_URL = /^https:\/\/pbs\.twimg\.com\/[\w./-]{1,300}$/;
const KINDS = new Set<ProfilePostKind>(['original', 'reply', 'quote']);
const MEDIA = new Set<ProfilePostMedia>(['none', 'photo', 'video', 'gif', 'mixed']);
const COUNT_KEYS = ['views', 'likes', 'retweets', 'replies', 'quotes', 'bookmarks'] as const;

export interface CatalogPost extends ProfilePost {
  snippet?: string;
  mediaUrl?: string;
  lang?: string;
  /** 第一次收进来的时刻。 */
  firstSeenAt: number;
  /** 数字最后一次更新的时刻。 */
  updatedAt: number;
  /** 服务端帖子库已知的浏览数（拉取到的或自己报上去的）；没同步过为空。 */
  syncedViews?: number;
  /** 没有浏览数的帖子：服务端是否已经有它。 */
  synced?: boolean;
  /**
   * 在公开页面（时间线、主页、搜索、详情）上看到过。只在私信、通知、书签、列表等页面看到的帖子不上报：
   * 那些页面上出现什么，本身就是用户自己的信息（和全站热榜同一个口径，见 shared-insight.ts isShareablePath）。
   */
  seenPublic?: boolean;
}

export interface CatalogAccount {
  handle: string;
  displayName?: string;
  avatarUrl?: string;
  verified?: boolean;
  followers?: number;
  followingCount?: number;
  tweets?: number;
  /** 注册时间。 */
  createdAt?: number;
  updatedAt?: number;
  /** 受保护的账号：帖子不上传。 */
  protected?: boolean;
  /** 服务端已知的粉丝数。 */
  syncedFollowers?: number;
}

/** 磁盘上的元数据（不含帖子）：帖子分开存在分片里。 */
interface CatalogMeta {
  account: CatalogAccount;
  /** 第一次打开这个主页的时刻（覆盖度「从哪天开始」）。 */
  firstVisitAt: number;
  /** 建档时刻；之后的「最近打开」记在索引里。 */
  lastVisitAt: number;
  /** 服务端增量拉取的游标与上次拉取时刻。 */
  remoteCursor?: string;
  remotePulledAt?: number;
  /** 存在的分片号（时间桶，见 shardOf），升序；迭代/删除只看这些，不猜范围。 */
  shards: number[];
}

/** get() 返回的聚合视图：和老版本 CatalogEntry 字段一致，posts 是全部分片合起来的。 */
export interface CatalogEntry {
  account: CatalogAccount;
  posts: Record<string, CatalogPost>;
  firstVisitAt: number;
  lastVisitAt: number;
  remoteCursor?: string;
  remotePulledAt?: number;
}

export interface CatalogStorage {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 1e13
    ? value
    : undefined;
}

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

function image(value: unknown): string | undefined {
  return typeof value === 'string' && TWIMG_URL.test(value) ? value : undefined;
}

/** 一个分片覆盖的时间跨度（毫秒）。按发帖时间分桶：同一时期的帖子落同一片，更新落回原片。 */
const SHARD_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const TWITTER_EPOCH = 1288834974657;

/**
 * 帖子落在哪个分片：按发帖时间（从 snowflake 算）÷ 30 天。
 * 分片号是「从 Twitter 纪元起第几个 30 天窗口」，是个几百以内的小整数，可直接迭代。
 * 更新同一条帖子时时间不变，落回同一片。snowflake 解析不出来（理论上不会）就归到第 0 片。
 */
function shardOf(postId: string): number {
  let ms: number;
  try {
    ms = Number((BigInt(postId) >> 22n) + BigInt(TWITTER_EPOCH));
  } catch {
    return 0;
  }
  const bucket = Math.floor((ms - TWITTER_EPOCH) / SHARD_WINDOW_MS);
  return bucket >= 0 && Number.isFinite(bucket) ? bucket : 0;
}

/** 内容脚本已经消毒过；跨消息边界再按形状挑一遍，只留认识的字段。 */
function readTweet(raw: unknown): {
  handle: string;
  post: Omit<CatalogPost, 'firstSeenAt' | 'updatedAt'>;
  protected: boolean;
} | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.postId !== 'string' || !POST_ID.test(r.postId)) return null;
  if (typeof r.handle !== 'string' || !HANDLE.test(r.handle)) return null;
  const post: Omit<CatalogPost, 'firstSeenAt' | 'updatedAt'> = { postId: r.postId };
  const createdAt = count(r.createdAt);
  if (createdAt !== undefined) post.createdAt = createdAt;
  for (const key of COUNT_KEYS) {
    const value = count(r[key]);
    if (value !== undefined) post[key] = value;
  }
  if (KINDS.has(r.kind as ProfilePostKind)) post.kind = r.kind as ProfilePostKind;
  if (MEDIA.has(r.media as ProfilePostMedia)) post.media = r.media as ProfilePostMedia;
  if (r.pinned === true) post.pinned = true;
  const snippet = text(r.snippet, 1_000);
  if (snippet) post.snippet = snippet;
  const mediaUrl = image(r.mediaUrl);
  if (mediaUrl) post.mediaUrl = mediaUrl;
  if (typeof r.lang === 'string' && /^[a-z]{2,3}(-[a-z]{2,4})?$/.test(r.lang)) post.lang = r.lang;
  return { handle: r.handle, post, protected: r.protected === true };
}

function readAuthor(raw: unknown): CatalogAccount | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.handle !== 'string' || !HANDLE.test(r.handle)) return null;
  const account: CatalogAccount = { handle: r.handle };
  for (const key of ['followers', 'followingCount', 'tweets', 'createdAt'] as const) {
    const value = count(r[key]);
    if (value !== undefined) account[key] = value;
  }
  const displayName = text(r.displayName, 64);
  if (displayName) account.displayName = displayName;
  const avatarUrl = image(r.avatarUrl);
  if (avatarUrl) account.avatarUrl = avatarUrl;
  if (typeof r.verified === 'boolean') account.verified = r.verified;
  return account;
}

/** 服务端帖子库的响应（GET /v1/profiles/:handle），字段 snake_case。 */
export interface RemoteProfile {
  account?: unknown;
  posts?: unknown;
  cursor?: unknown;
  complete?: unknown;
}

/** 服务端的数据跨网络边界进来：和内容脚本的观测一样按形状挑一遍。 */
function readRemotePost(
  handle: string,
  raw: unknown,
): Omit<CatalogPost, 'firstSeenAt' | 'updatedAt'> | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const parsed = readTweet({
    postId: r.post_id,
    handle,
    createdAt: r.created_at,
    kind: r.kind,
    media: r.media,
    pinned: r.pinned,
    snippet: r.snippet,
    mediaUrl: r.media_url,
    lang: r.lang,
    views: r.views,
    likes: r.likes,
    retweets: r.retweets,
    replies: r.replies,
    quotes: r.quotes,
    bookmarks: r.bookmarks,
  });
  return parsed?.post ?? null;
}

function readRemoteAccount(handle: string, raw: unknown): CatalogAccount | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const account = readAuthor({
    handle,
    displayName: r.display_name,
    avatarUrl: r.avatar_url,
    verified: r.verified,
    followers: r.followers,
    followingCount: r.following_count,
    tweets: r.tweets,
    createdAt: r.joined_at,
  });
  if (!account) return null;
  const updatedAt = count(r.updated_at);
  if (updatedAt !== undefined) account.updatedAt = updatedAt;
  return account;
}

/** 内存里的一个博主：元数据 + 已载入的分片。按需从磁盘载入分片。 */
interface LoadedProfile {
  meta: CatalogMeta;
  /** 分片号 → 这个分片的帖子（postId → post）。只装已经载入或改动过的分片。 */
  shards: Map<number, Record<string, CatalogPost>>;
  /** 已经从磁盘载入过的分片号（空片也算载入，避免重复读盘）。 */
  loaded: Set<number>;
  /** 这一轮要写盘的分片号（含元数据则 metaDirty）。 */
  dirtyShards: Set<number>;
  metaDirty: boolean;
}

function metaKey(handle: string): string {
  return PROFILE_META_PREFIX + handle;
}

function shardKey(handle: string, shard: number): string {
  return `${PROFILE_META_PREFIX}${handle}#${shard}`;
}

export function createProfileCatalog(deps: {
  storage: CatalogStorage;
  broadcast?: (handles: string[]) => void;
  now?: () => number;
  persistDelayMs?: number;
  broadcastDelayMs?: number;
}) {
  const now = deps.now ?? (() => Date.now());
  const persistDelayMs = deps.persistDelayMs ?? PERSIST_DELAY_MS;
  const broadcastDelayMs = deps.broadcastDelayMs ?? BROADCAST_DELAY_MS;
  // handle → 最近一次打开主页的时刻
  let index: Map<string, number> | null = null;
  let indexLoad: Promise<Map<string, number>> | null = null;
  const profiles = new Map<string, LoadedProfile>();
  const profileLoads = new Map<string, Promise<LoadedProfile | null>>();
  /** 迁移过的 V1 老 key：下次写盘时删掉。 */
  const legacyToRemove = new Set<string>();
  const changed = new Set<string>();
  let indexDirty = false;
  let persistTimer: ReturnType<typeof setTimeout> | undefined;
  let broadcastTimer: ReturnType<typeof setTimeout> | undefined;

  function loadIndex(): Promise<Map<string, number>> {
    if (index) return Promise.resolve(index);
    indexLoad ??= deps.storage
      .get(PROFILE_INDEX_KEY)
      .catch(() => ({}) as Record<string, unknown>)
      .then((stored) => {
        const raw = stored[PROFILE_INDEX_KEY];
        const map = new Map<string, number>();
        if (Array.isArray(raw)) {
          for (const item of raw) {
            if (
              Array.isArray(item) &&
              typeof item[0] === 'string' &&
              HANDLE.test(item[0]) &&
              typeof item[1] === 'number'
            ) {
              map.set(item[0], item[1]);
            }
          }
        }
        index = map;
        return map;
      });
    return indexLoad;
  }

  /** 老格式（profileV1:<handle> 单 blob）：拆成 V2 元数据 + 分片，整个 profile 标脏，删老 key。 */
  function migrateV1(handle: string, raw: unknown): LoadedProfile | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as {
      account?: unknown;
      posts?: unknown;
      firstVisitAt?: unknown;
      lastVisitAt?: unknown;
      remoteCursor?: unknown;
      remotePulledAt?: unknown;
    };
    if (!r.account || typeof r.account !== 'object' || typeof r.posts !== 'object' || !r.posts) {
      return null;
    }
    const at = now();
    const meta: CatalogMeta = {
      account: r.account as CatalogAccount,
      firstVisitAt: typeof r.firstVisitAt === 'number' ? r.firstVisitAt : at,
      lastVisitAt: typeof r.lastVisitAt === 'number' ? r.lastVisitAt : at,
      shards: [],
    };
    if (typeof r.remoteCursor === 'string') meta.remoteCursor = r.remoteCursor;
    if (typeof r.remotePulledAt === 'number') meta.remotePulledAt = r.remotePulledAt;
    const profile: LoadedProfile = {
      meta,
      shards: new Map(),
      loaded: new Set(),
      dirtyShards: new Set(),
      metaDirty: true,
    };
    for (const post of Object.values(r.posts as Record<string, CatalogPost>)) {
      if (!post || typeof post.postId !== 'string' || !POST_ID.test(post.postId)) continue;
      putPost(profile, post);
    }
    return profile;
  }

  function loadProfile(handle: string): Promise<LoadedProfile | null> {
    const cached = profiles.get(handle);
    if (cached) return Promise.resolve(cached);
    let pending = profileLoads.get(handle);
    if (!pending) {
      // 读失败要抛出去，不能当成「没有帖子库」：visit 会拿一份空库把已有的数据覆盖掉
      pending = deps.storage
        .get([metaKey(handle), PROFILE_KEY_PREFIX + handle])
        .then((stored) => {
          const existing = profiles.get(handle);
          if (existing) return existing;
          const metaRaw = stored[metaKey(handle)] as CatalogMeta | undefined;
          if (metaRaw && typeof metaRaw === 'object' && metaRaw.account) {
            const shards = Array.isArray(metaRaw.shards)
              ? metaRaw.shards.filter((n): n is number => typeof n === 'number' && n >= 0)
              : [];
            const profile: LoadedProfile = {
              meta: { ...metaRaw, shards },
              shards: new Map(),
              loaded: new Set(),
              dirtyShards: new Set(),
              metaDirty: false,
            };
            profiles.set(handle, profile);
            return profile;
          }
          // 没有 V2 元数据：看有没有 V1 老 blob 要迁移
          const migrated = migrateV1(handle, stored[PROFILE_KEY_PREFIX + handle]);
          if (migrated) {
            profiles.set(handle, migrated);
            schedule();
            // 迁移写盘后再删老 key（persist 里处理）：这里只标记
            legacyToRemove.add(handle);
            return migrated;
          }
          return null;
        })
        .finally(() => profileLoads.delete(handle));
      profileLoads.set(handle, pending);
    }
    return pending;
  }

  /** 确保某个分片已从磁盘载入到内存（空片也记为已载入）。 */
  async function ensureShard(handle: string, profile: LoadedProfile, shard: number): Promise<void> {
    if (profile.loaded.has(shard)) return;
    const stored = await deps.storage
      .get(shardKey(handle, shard))
      .catch(() => ({}) as Record<string, unknown>);
    const raw = stored[shardKey(handle, shard)];
    const posts: Record<string, CatalogPost> = {};
    if (raw && typeof raw === 'object') {
      for (const [id, post] of Object.entries(raw as Record<string, CatalogPost>)) {
        if (POST_ID.test(id) && post && typeof post === 'object') posts[id] = post;
      }
    }
    if (!profile.shards.has(shard)) profile.shards.set(shard, posts);
    profile.loaded.add(shard);
  }

  /** 把一条帖子放进内存里对应的分片（分片不在内存里就新建一个空的）；维护 meta.shards 列表。 */
  function putPost(profile: LoadedProfile, post: CatalogPost): void {
    const shard = shardOf(post.postId);
    let bucket = profile.shards.get(shard);
    if (!bucket) {
      bucket = {};
      profile.shards.set(shard, bucket);
      profile.loaded.add(shard);
    }
    bucket[post.postId] = post;
    profile.dirtyShards.add(shard);
    if (!profile.meta.shards.includes(shard)) {
      profile.meta.shards.push(shard);
      profile.meta.shards.sort((a, b) => a - b);
      profile.metaDirty = true;
    }
  }

  function schedule(): void {
    persistTimer ??= setTimeout(() => {
      persistTimer = undefined;
      void persist();
    }, persistDelayMs);
    broadcastTimer ??= setTimeout(() => {
      broadcastTimer = undefined;
      const handles = [...changed];
      changed.clear();
      if (handles.length > 0) deps.broadcast?.(handles);
    }, broadcastDelayMs);
  }

  async function persist(): Promise<void> {
    const items: Record<string, unknown> = {};
    const removals: string[] = [];
    for (const [handle, profile] of profiles) {
      if (profile.metaDirty) {
        items[metaKey(handle)] = profile.meta;
        profile.metaDirty = false;
      }
      for (const shard of profile.dirtyShards) {
        const bucket = profile.shards.get(shard) ?? {};
        items[shardKey(handle, shard)] = bucket;
      }
      profile.dirtyShards.clear();
    }
    for (const handle of legacyToRemove) removals.push(PROFILE_KEY_PREFIX + handle);
    legacyToRemove.clear();
    if (indexDirty && index) items[PROFILE_INDEX_KEY] = [...index];
    indexDirty = false;
    if (Object.keys(items).length > 0) await deps.storage.set(items).catch(() => undefined);
    if (removals.length > 0) await deps.storage.remove(removals).catch(() => undefined);
  }

  /** 打开了某个博主的主页：没有帖子库就建一份。不淘汰任何博主。 */
  async function visit(handle: string): Promise<void> {
    const map = await loadIndex();
    const at = now();
    if (!map.has(handle) || (await loadProfile(handle)) === null) {
      profiles.set(handle, {
        meta: { account: { handle }, firstVisitAt: at, lastVisitAt: at, shards: [] },
        shards: new Map(),
        loaded: new Set(),
        dirtyShards: new Set(),
        metaDirty: true,
      });
      changed.add(handle);
    }
    map.set(handle, at);
    indexDirty = true;
  }

  /**
   * 合并内容脚本发来的观测（和热帖同一批数据）。`profile` 是观测时所在主页的主人：
   * 给他建帖子库。其余帖子只收已经有帖子库的博主的。
   */
  async function ingest(observations: unknown): Promise<void> {
    if (!Array.isArray(observations)) return;
    const map = await loadIndex();
    for (const observation of observations) {
      if (!observation || typeof observation !== 'object') continue;
      const o = observation as {
        at?: unknown;
        profile?: unknown;
        tweets?: unknown;
        authors?: unknown;
        shareable?: unknown;
      };
      const at = typeof o.at === 'number' && Number.isFinite(o.at) ? Math.min(o.at, now()) : now();
      if (typeof o.profile === 'string' && HANDLE.test(o.profile)) await visit(o.profile);
      for (const raw of Array.isArray(o.authors) ? o.authors : []) {
        const account = readAuthor(raw);
        if (!account || !map.has(account.handle)) continue;
        const profile = await loadProfile(account.handle);
        if (!profile) continue;
        profile.meta.account = { ...profile.meta.account, ...account, updatedAt: at };
        profile.metaDirty = true;
        changed.add(account.handle);
      }
      for (const raw of Array.isArray(o.tweets) ? o.tweets : []) {
        const parsed = readTweet(raw);
        if (!parsed || !map.has(parsed.handle)) continue;
        const profile = await loadProfile(parsed.handle);
        if (!profile) continue;
        if (parsed.protected && !profile.meta.account.protected) {
          profile.meta.account.protected = true;
          profile.metaDirty = true;
        }
        const shard = shardOf(parsed.post.postId);
        await ensureShard(parsed.handle, profile, shard);
        const previous = profile.shards.get(shard)?.[parsed.post.postId];
        const merged: CatalogPost = {
          ...previous,
          ...parsed.post,
          firstSeenAt: previous?.firstSeenAt ?? at,
          updatedAt: at,
        };
        // 计数只增不减：乱序到达的旧观测不把数字改小
        for (const key of COUNT_KEYS) {
          const before = previous?.[key];
          const after = parsed.post[key];
          if (before !== undefined && (after === undefined || after < before)) merged[key] = before;
        }
        // 置顶只在主页时间线里出现；在别处看到同一条帖子不清掉置顶标记
        if (previous?.pinned && !parsed.post.pinned) merged.pinned = true;
        if (o.shareable === true) merged.seenPublic = true;
        putPost(profile, merged);
        changed.add(parsed.handle);
      }
    }
    if (hasDirty() || indexDirty) schedule();
  }

  function hasDirty(): boolean {
    for (const profile of profiles.values()) {
      if (profile.metaDirty || profile.dirtyShards.size > 0) return true;
    }
    return false;
  }

  /** 把一个博主的所有分片聚合成完整的 CatalogEntry（读契约：get 一次拿到全部帖子）。 */
  async function aggregate(handle: string, profile: LoadedProfile): Promise<CatalogEntry> {
    for (const shard of profile.meta.shards) {
      await ensureShard(handle, profile, shard);
    }
    const posts: Record<string, CatalogPost> = {};
    for (const bucket of profile.shards.values()) Object.assign(posts, bucket);
    const entry: CatalogEntry = {
      account: profile.meta.account,
      posts,
      firstVisitAt: profile.meta.firstVisitAt,
      lastVisitAt: profile.meta.lastVisitAt,
    };
    if (profile.meta.remoteCursor !== undefined) entry.remoteCursor = profile.meta.remoteCursor;
    if (profile.meta.remotePulledAt !== undefined)
      entry.remotePulledAt = profile.meta.remotePulledAt;
    return entry;
  }

  async function get(handle: string): Promise<CatalogEntry | null> {
    if (!HANDLE.test(handle)) return null;
    const map = await loadIndex();
    if (!map.has(handle)) return null;
    const profile = await loadProfile(handle);
    return profile ? aggregate(handle, profile) : null;
  }

  /** 设置里的「清空主页数据」。 */
  async function clear(): Promise<void> {
    const map = await loadIndex();
    const keys = [PROFILE_INDEX_KEY];
    // 没载入内存的博主也要删它的分片：先把元数据读出来拿分片列表
    const metaKeys = [...map.keys()].map(metaKey);
    const metas =
      metaKeys.length > 0
        ? await deps.storage.get(metaKeys).catch(() => ({}) as Record<string, unknown>)
        : ({} as Record<string, unknown>);
    for (const handle of map.keys()) {
      keys.push(metaKey(handle), PROFILE_KEY_PREFIX + handle);
      const loaded = profiles.get(handle)?.meta.shards;
      const stored = (metas[metaKey(handle)] as CatalogMeta | undefined)?.shards;
      const shards = new Set<number>([
        ...(loaded ?? []),
        ...(Array.isArray(stored) ? stored : []),
      ]);
      for (const shard of shards) keys.push(shardKey(handle, shard));
    }
    map.clear();
    profiles.clear();
    legacyToRemove.clear();
    indexDirty = false;
    await deps.storage.remove(keys).catch(() => undefined);
  }

  async function size(): Promise<number> {
    return (await loadIndex()).size;
  }

  /** 测试用：立即写盘。 */
  async function flush(): Promise<void> {
    if (persistTimer !== undefined) clearTimeout(persistTimer);
    persistTimer = undefined;
    await persist();
  }

  async function has(handle: string): Promise<boolean> {
    return (await loadIndex()).has(handle);
  }

  /**
   * 合并服务端帖子库（GET /v1/profiles/:handle 的响应）。只合并已经建档的博主。
   * 计数只增不减；每条帖子记下服务端已知的浏览数，之后只上报比它新的。
   */
  async function mergeRemote(handle: string, remote: RemoteProfile, cursor: string): Promise<void> {
    if (!HANDLE.test(handle) || !(await loadIndex()).has(handle)) return;
    const profile = await loadProfile(handle);
    if (!profile) return;
    const at = now();
    const account = readRemoteAccount(handle, remote.account);
    if (account) {
      const localFresh = (profile.meta.account.updatedAt ?? 0) >= (account.updatedAt ?? 0);
      // 本机刚看到的资料比服务端新：只补空字段；否则用服务端的
      profile.meta.account = localFresh
        ? { ...account, ...profile.meta.account }
        : { ...profile.meta.account, ...account };
      if (account.followers !== undefined) profile.meta.account.syncedFollowers = account.followers;
      profile.metaDirty = true;
    }
    for (const raw of Array.isArray(remote.posts) ? remote.posts : []) {
      const parsed = readRemotePost(handle, raw);
      if (!parsed) continue;
      const shard = shardOf(parsed.postId);
      await ensureShard(handle, profile, shard);
      const previous = profile.shards.get(shard)?.[parsed.postId];
      const merged: CatalogPost = {
        ...parsed,
        ...previous,
        firstSeenAt: previous?.firstSeenAt ?? at,
        updatedAt: previous?.updatedAt ?? at,
      };
      for (const key of COUNT_KEYS) {
        const local = previous?.[key];
        const server = parsed[key];
        if (server !== undefined && (local === undefined || server > local)) {
          merged[key] = server;
          merged.updatedAt = at;
        }
      }
      for (const key of ['kind', 'media', 'snippet', 'mediaUrl', 'lang'] as const) {
        if (merged[key] === undefined && parsed[key] !== undefined) {
          (merged as unknown as Record<string, unknown>)[key] = parsed[key];
        }
      }
      if (parsed.pinned) merged.pinned = true;
      if (parsed.views !== undefined) {
        merged.syncedViews = Math.max(previous?.syncedViews ?? 0, parsed.views);
      }
      merged.synced = true;
      merged.seenPublic = true;
      putPost(profile, merged);
    }
    profile.meta.remoteCursor = cursor;
    profile.meta.remotePulledAt = at;
    profile.metaDirty = true;
    changed.add(handle);
    schedule();
  }

  /** 上报成功：记下服务端现在已知的数字。 */
  async function markSynced(
    handle: string,
    posts: ReadonlyArray<{ postId: string; views?: number }>,
    followers?: number,
  ): Promise<void> {
    const profile = (await loadIndex()).has(handle) ? await loadProfile(handle) : null;
    if (!profile) return;
    for (const { postId, views } of posts) {
      if (!POST_ID.test(postId)) continue;
      const shard = shardOf(postId);
      await ensureShard(handle, profile, shard);
      const post = profile.shards.get(shard)?.[postId];
      if (!post) continue;
      post.synced = true;
      if (views !== undefined) post.syncedViews = Math.max(post.syncedViews ?? 0, views);
      profile.dirtyShards.add(shard);
    }
    if (followers !== undefined) {
      profile.meta.account.syncedFollowers = followers;
      profile.metaDirty = true;
    }
    schedule();
  }

  return { ingest, visit, get, has, clear, size, flush, mergeRemote, markSynced };
}

export type ProfileCatalog = ReturnType<typeof createProfileCatalog>;
