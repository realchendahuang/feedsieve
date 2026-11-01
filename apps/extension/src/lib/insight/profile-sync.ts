/**
 * 主页洞察众包（后台 service worker）：一个人看过的博主帖子，其他人打开同一个主页时直接拿到。
 *
 * 拉取（pull）：打开一个博主的主页时，从服务端拿他的帖子库合并进本机。第一次拿全量，之后带游标
 * 只拿这期间有变化的（增量），同一个博主 30 分钟内最多拉一次。
 *
 * 上报（push）：只报服务端还不知道的东西（增量）。每条帖子记着服务端已知的浏览数（syncedViews，
 * 来自拉取或自己上次报的）：
 * - 服务端没有的帖子：报；
 * - 浏览比服务端已知的涨了 5% 且至少 20：报；
 * - 其余不报。所以一个博主被很多人看，服务端也只收到真正的新数字。
 * 攒着批量发，最多 5 分钟一次；第一次在看到数据 1 分钟后。
 *
 * 只报公开数据：受保护账号、粉丝不到 1000 的博主不报；只在私信、通知、书签、列表等页面看到的帖子不报；
 * 「仅本地运行」打开时既不拉也不报。
 * 自己的主页和别人的主页一样上报、拉取（帖子本来就是公开的，本人提供的数据也最完整），但自己的
 * 那批用一个单独的每日会话 ID，不和他看别人的记录落在同一个会话里。
 * 不带安装 ID，只带每日轮换的随机会话 ID（服务端加盐哈希后只用于限额，不和帖子存在一起）。
 * 拉取时服务端能看到 IP 和博主 handle（不记录对应关系），受保护和粉丝不够的博主不去拉。
 */
import type { InsightObservation } from './shared-insight';
import type { CatalogEntry, CatalogPost, RemoteProfile } from './profile-catalog';

export const PROFILE_UPLOAD_INTERVAL_MS = 5 * 60 * 1000;
export const PROFILE_FIRST_UPLOAD_DELAY_MS = 60 * 1000;
export const PROFILE_PULL_INTERVAL_MS = 30 * 60 * 1000;
/** 和服务端 MAX_PROFILE_POSTS_PER_REQUEST 一致。 */
const CHUNK = 200;
/**
 * 一次拉取最多翻这么多页（每页 1000 条）。首次全量同步一个高产博主可能上万条，
 * 分几页拉完；之后是增量（带游标只拉有变化的），每次很少，到不了几页。
 */
const MAX_PAGES = 30;
const MIN_GROWTH = 20;
/** 拉取失败后，同一个博主隔这么久再试（失败时不能每条观测都重拉）。 */
const PULL_RETRY_MS = 60 * 1000;
const MIN_GROWTH_RATIO = 0.05;
/** 粉丝少于这么多的博主不上报（和服务端 MIN_PROFILE_FOLLOWERS 一致，docs/07 §3.1）。 */
export const PROFILE_MIN_FOLLOWERS = 1_000;
const SESSION_KEY = 'profileSessionV1';
/** 待上报的博主与上次上报时间：storage.session，service worker 被回收也不丢。 */
const STATE_KEY = 'profileSyncStateV1';

export interface ProfileUploadPost {
  post_id: string;
  handle: string;
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

export interface ProfileUploadAccount {
  handle: string;
  display_name?: string;
  avatar_url?: string;
  verified?: boolean;
  followers?: number;
  following_count?: number;
  tweets?: number;
  joined_at?: number;
}

export interface ProfileSyncCatalog {
  has(handle: string): Promise<boolean>;
  get(handle: string): Promise<CatalogEntry | null>;
  mergeRemote(handle: string, remote: RemoteProfile, cursor: string): Promise<void>;
  markSynced(
    handle: string,
    posts: ReadonlyArray<{ postId: string; views?: number }>,
    followers?: number,
  ): Promise<void>;
}

interface KeyValueStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface ProfileSyncDeps {
  catalog: ProfileSyncCatalog;
  /** 「仅本地运行」关闭时才允许。 */
  isAllowed: () => Promise<boolean>;
  getSelfHandle: () => Promise<string | null>;
  post: (body: {
    session_id: string;
    posts: ProfileUploadPost[];
    accounts: ProfileUploadAccount[];
  }) => Promise<Response>;
  fetchProfile: (handle: string, cursor: string | undefined) => Promise<Response>;
  storage: KeyValueStorage;
  stateStorage?: KeyValueStorage;
  now?: () => number;
  randomId?: () => string;
}

/** 这条帖子要不要报：服务端没有，或者浏览明显比服务端已知的新。 */
export function needsUpload(post: CatalogPost): boolean {
  if (post.createdAt === undefined || post.seenPublic !== true) return false;
  if (post.views === undefined) return post.likes !== undefined && post.synced !== true;
  if (post.syncedViews === undefined) return true;
  const growth = post.views - post.syncedViews;
  return growth >= MIN_GROWTH && growth >= post.syncedViews * MIN_GROWTH_RATIO;
}

function toUploadPost(handle: string, post: CatalogPost): ProfileUploadPost {
  const item: ProfileUploadPost = { post_id: post.postId, handle, created_at: post.createdAt! };
  if (post.kind) item.kind = post.kind;
  if (post.media) item.media = post.media;
  if (post.pinned) item.pinned = true;
  if (post.snippet) item.snippet = post.snippet.slice(0, 280);
  if (post.mediaUrl) item.media_url = post.mediaUrl;
  if (post.lang) item.lang = post.lang;
  for (const key of ['views', 'likes', 'retweets', 'replies', 'quotes', 'bookmarks'] as const) {
    if (post[key] !== undefined) item[key] = post[key];
  }
  return item;
}

function toUploadAccount(entry: CatalogEntry): ProfileUploadAccount | null {
  const a = entry.account;
  if (a.followers === undefined || a.followers === a.syncedFollowers) return null;
  const item: ProfileUploadAccount = { handle: a.handle, followers: a.followers };
  if (a.displayName) item.display_name = a.displayName;
  if (a.avatarUrl) item.avatar_url = a.avatarUrl;
  if (a.verified !== undefined) item.verified = a.verified;
  if (a.followingCount !== undefined) item.following_count = a.followingCount;
  if (a.tweets !== undefined) item.tweets = a.tweets;
  if (a.createdAt !== undefined) item.joined_at = a.createdAt;
  return item;
}

/** 原地洗牌：服务端看不出这一批里先看了谁、后看了谁。 */
function shuffle<T>(list: T[]): void {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j]!, list[i]!];
  }
}

export function createProfileSync(deps: ProfileSyncDeps) {
  const now = deps.now ?? (() => Date.now());
  const randomId = deps.randomId ?? (() => crypto.randomUUID());
  const pending = new Set<string>();
  const pulling = new Map<string, Promise<void>>();
  const pullFailedAt = new Map<string, number>();
  let lastUploadAt: number | null = null;
  let uploading: Promise<void> | null = null;
  let loaded: Promise<void> | null = null;

  function loadState(): Promise<void> {
    loaded ??= (deps.stateStorage?.get(STATE_KEY) ?? Promise.resolve<Record<string, unknown>>({}))
      .then((result) => {
        const state = result[STATE_KEY] as
          { lastUploadAt?: unknown; pending?: unknown } | undefined;
        if (typeof state?.lastUploadAt === 'number') lastUploadAt = state.lastUploadAt;
        if (Array.isArray(state?.pending)) {
          for (const handle of state.pending) if (typeof handle === 'string') pending.add(handle);
        }
      })
      .catch(() => undefined)
      .then(() => {
        lastUploadAt ??= now() - PROFILE_UPLOAD_INTERVAL_MS + PROFILE_FIRST_UPLOAD_DELAY_MS;
      });
    return loaded;
  }

  function saveState(): Promise<void> {
    if (!deps.stateStorage) return Promise.resolve();
    return deps.stateStorage
      .set({ [STATE_KEY]: { lastUploadAt, pending: [...pending] } })
      .catch(() => undefined);
  }

  /**
   * 每天一个新的随机会话 ID，和全站热榜的不是同一个。
   * 自己的主页用 `self` 这个独立的 ID：即使同一天既看自己又看别人，服务端也串不起来。
   */
  async function sessionId(scope: 'default' | 'self' = 'default'): Promise<string> {
    const day = new Date(now()).toISOString().slice(0, 10);
    const stored = (await deps.storage.get(SESSION_KEY))[SESSION_KEY] as
      { day?: string; id?: string; selfId?: string } | undefined;
    if (stored?.day === day) {
      if (scope === 'self' && typeof stored.selfId === 'string') return stored.selfId;
      if (scope === 'default' && typeof stored.id === 'string') return stored.id;
    }
    const sameDay = stored?.day === day;
    const next = {
      day,
      id: sameDay && typeof stored?.id === 'string' ? stored.id : randomId(),
      selfId: sameDay && typeof stored?.selfId === 'string' ? stored.selfId : randomId(),
    };
    await deps.storage.set({ [SESSION_KEY]: next });
    return scope === 'self' ? next.selfId : next.id;
  }

  /** 从服务端拉一个博主的帖子库（增量），合并进本机。同一个博主 10 分钟内最多一次。 */
  function pull(handle: string, options: { force?: boolean } = {}): Promise<void> {
    const running = pulling.get(handle);
    if (running) return running;
    const task = (async () => {
      if (!(await deps.isAllowed()) || !(await deps.catalog.has(handle))) return;
      const entry = await deps.catalog.get(handle);
      // 受保护、已知粉丝不到门槛的：服务端没有，也不必让服务端看到这次请求
      if (
        !entry ||
        entry.account.protected ||
        (entry.account.followers !== undefined && entry.account.followers < PROFILE_MIN_FOLLOWERS)
      ) {
        return;
      }
      if (
        !options.force &&
        entry.remotePulledAt !== undefined &&
        now() - entry.remotePulledAt < PROFILE_PULL_INTERVAL_MS
      ) {
        return;
      }
      const failedAt = pullFailedAt.get(handle);
      if (failedAt !== undefined && now() - failedAt < PULL_RETRY_MS) return;
      let cursor = entry.remoteCursor;
      for (let page = 0; page < MAX_PAGES; page++) {
        const response = await deps.fetchProfile(handle, cursor).catch(() => null);
        if (!response?.ok) {
          pullFailedAt.set(handle, now());
          return;
        }
        pullFailedAt.delete(handle);
        const body = (await response.json()) as RemoteProfile;
        const next = typeof body.cursor === 'string' ? body.cursor : cursor;
        if (!next) return;
        await deps.catalog.mergeRemote(handle, body, next);
        cursor = next;
        if (body.complete !== false) return;
      }
    })()
      .catch(() => undefined)
      .finally(() => pulling.delete(handle));
    pulling.set(handle, task);
    return task;
  }

  async function upload(): Promise<void> {
    if (!(await deps.isAllowed())) {
      pending.clear();
      return;
    }
    // 不知道自己是谁时不报：分不出哪些是用户自己的帖子（宁可不报）
    const self = await deps.getSelfHandle();
    if (!self) return;
    const posts: Array<{ handle: string; post: ProfileUploadPost }> = [];
    const accounts: ProfileUploadAccount[] = [];
    const round = [...pending];
    try {
      await sendRound(round, self, posts, accounts);
    } catch (error) {
      // 读库失败、网络中断：这一轮涉及的博主全部放回，下个周期再试
      for (const handle of round) pending.add(handle);
      throw error;
    }
  }

  async function sendRound(
    round: string[],
    self: string,
    posts: Array<{ handle: string; post: ProfileUploadPost }>,
    accounts: ProfileUploadAccount[],
  ): Promise<void> {
    for (const handle of round) {
      const entry = await deps.catalog.get(handle);
      if (
        !entry ||
        entry.account.protected ||
        (entry.account.followers ?? 0) < PROFILE_MIN_FOLLOWERS
      ) {
        pending.delete(handle);
        continue;
      }
      const account = toUploadAccount(entry);
      if (account) accounts.push(account);
      for (const post of Object.values(entry.posts)) {
        if (needsUpload(post)) posts.push({ handle, post: toUploadPost(handle, post) });
      }
      pending.delete(handle);
    }
    if (posts.length === 0 && accounts.length === 0) return;
    // 自己的主页走独立会话：数据是公开的，但不必让服务端把它和同一个人看别人的记录串起来
    const selfPosts = posts.filter((item) => item.handle === self);
    const selfAccounts = accounts.filter((item) => item.handle === self);
    const otherPosts = posts.filter((item) => item.handle !== self);
    const otherAccounts = accounts.filter((item) => item.handle !== self);
    // 打乱顺序：服务端看不出这一批里先看了谁、后看了谁
    shuffle(otherPosts);
    shuffle(selfPosts);
    if (otherPosts.length > 0 || otherAccounts.length > 0) {
      if (!(await sendBatch(otherPosts, otherAccounts, await sessionId()))) {
        // 自己的那批还没发：放回队列，下个周期再试
        for (const item of selfPosts) pending.add(item.handle);
        for (const account of selfAccounts) pending.add(account.handle);
        return;
      }
    }
    if (selfPosts.length > 0 || selfAccounts.length > 0) {
      await sendBatch(selfPosts, selfAccounts, await sessionId('self'));
    }
  }

  /** 发一批（每批最多 CHUNK 条帖子、20 个账号）。返回 false 表示限额用完或服务端出错，下个周期再试。 */
  async function sendBatch(
    posts: Array<{ handle: string; post: ProfileUploadPost }>,
    accounts: ProfileUploadAccount[],
    id: string,
  ): Promise<boolean> {
    // 账号资料跟帖子一起走（服务端每次最多 20 个账号）
    let accountQueue = accounts;
    for (let i = 0; i < posts.length || accountQueue.length > 0; i += CHUNK) {
      const chunk = posts.slice(i, i + CHUNK);
      const accountChunk = accountQueue.slice(0, 20);
      accountQueue = accountQueue.slice(20);
      const response = await deps.post({
        session_id: id,
        posts: chunk.map((item) => item.post),
        accounts: accountChunk,
      });
      if (!response.ok) {
        // 请求本身不合格（400 / 413）：重试也一样，丢掉
        if (response.status === 400 || response.status === 413) continue;
        // 限额用完或服务器出错：没报成功的博主留着，下个周期再试
        for (const item of posts.slice(i)) pending.add(item.handle);
        for (const account of [...accountChunk, ...accountQueue]) pending.add(account.handle);
        return false;
      }
      // 服务端收下请求就算同步过，包括它按规则拒收的条目（粉丝不够、伪造等）：
      // 拒收的重报一次还是拒收，按 accepted 重试会变成无限重报
      const byHandle = new Map<string, Array<{ postId: string; views?: number }>>();
      for (const { handle, post } of chunk) {
        const list = byHandle.get(handle) ?? [];
        list.push({
          postId: post.post_id,
          ...(post.views !== undefined ? { views: post.views } : {}),
        });
        byHandle.set(handle, list);
      }
      for (const account of accountChunk)
        if (!byHandle.has(account.handle)) byHandle.set(account.handle, []);
      for (const [handle, list] of byHandle) {
        const followers = accountChunk.find((a) => a.handle === handle)?.followers;
        await deps.catalog.markSynced(handle, list, followers);
      }
    }
    return true;
  }

  async function maybeUpload(): Promise<void> {
    if (
      uploading ||
      pending.size === 0 ||
      now() - (lastUploadAt ?? 0) < PROFILE_UPLOAD_INTERVAL_MS
    ) {
      return;
    }
    lastUploadAt = now();
    uploading = upload()
      .catch(() => undefined)
      .finally(() => {
        uploading = null;
      });
    await uploading;
  }

  /**
   * 收到内容脚本的观测（已经合并进本机帖子库之后调用）：记下涉及的博主，到点批量上报；
   * 观测来自某个博主的主页时，顺手拉一次服务端的帖子库。
   */
  async function observe(observations: unknown): Promise<void> {
    if (!Array.isArray(observations)) return;
    await loadState();
    const handles = new Set<string>();
    for (const observation of observations as InsightObservation[]) {
      if (!observation || typeof observation !== 'object') continue;
      if (typeof observation.profile === 'string') {
        handles.add(observation.profile);
        void pull(observation.profile);
      }
      for (const tweet of observation.tweets ?? []) if (tweet?.handle) handles.add(tweet.handle);
      for (const author of observation.authors ?? [])
        if (author?.handle) handles.add(author.handle);
    }
    for (const handle of handles) if (await deps.catalog.has(handle)) pending.add(handle);
    await maybeUpload();
    await saveState();
  }

  return { observe, pull, pendingCount: () => pending.size };
}

export type ProfileSync = ReturnType<typeof createProfileSync>;
