/**
 * MAIN-world 桥数据消毒（review F1：xhr-bridge 事件伪造防御）。
 *
 * `feedsieve:xhr-items` 派发在两个 world 共享的 document 上，任何在 x.com 页面
 * 执行的脚本都能伪造该事件。本模块把不可信输入收敛成一组严格校验过的基本类型
 * 字段：handle 必须是 1-15 位 [A-Za-z0-9_]（小写化），xUserId 必须是 1-20 位
 * 数字；非法条目整条静默丢弃，绝不进入存储或破坏性动作路径。
 *
 * 残余假设（无法在跨 world 边界根除）：能在 x.com 执行 JS 的攻击者本就能观测
 * 用户会话；消毒只把伪造数据的破坏力限制在「合法形态的数据」之内。因此拉黑等
 * 破坏性动作对缓存 id 另有信任策略（见 content.ts blockOne：detection /
 * community 来源的破坏性动作不信任缓存 id，执行期按 handle 现解析）。
 */

/** 严格 handle 形态：小写无 @，1-15 位字母数字下划线（与 X screen_name 规则一致）。 */
export const STRICT_HANDLE_RE = /^[a-z0-9_]{1,15}$/;

/** X rest_id 形态：纯数字 1-20 位。 */
export const X_USER_ID_RE = /^\d{1,20}$/;

/** 不可信输入 → 严格 handle；非法返回 null（静默丢弃语义）。 */
export function normalizeStrictHandle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/^@+/, '').toLowerCase();
  return STRICT_HANDLE_RE.test(normalized) ? normalized : null;
}

/** 不可信输入 → 严格 rest_id；非法返回 undefined。 */
export function sanitizeXUserId(value: unknown): string | undefined {
  return typeof value === 'string' && X_USER_ID_RE.test(value) ? value : undefined;
}

// ---------- 时间线解析节流（性能，不涉及正确性） ----------

/**
 * X 会自动轮询首页时间线（HomeTimeline / HomeLatestTimeline），被动滚动时
 * 每次响应都在页面主线程整包 JSON.parse + 遍历，是扩展在 x.com 上最大的
 * 常驻开销。对这两个端点做按端点名的最小间隔节流：间隔内的重复响应直接
 * 跳过解析。
 *
 * 只降开销、不保关键数据：跳过的响应多半是同一批推文的重复轮询；即使恰好
 * 夹带新作者，黄框标注走 DOM、拉黑按 handle 现解析（blockOne 信任策略），
 * rest_id 缓存会在下一次未节流的解析里补齐。
 *
 * 明确不节流的端点：Following（分页 650ms 一页，跳页会断 cursor 链）、
 * TweetDetail / ListMembers / AccountSettings（低频单发，节流无收益还可能
 * 丢关键数据）。
 */
const THROTTLED_TIMELINE_ENDPOINTS = ['HomeTimeline', 'HomeLatestTimeline'] as const;

/** 同一端点两次解析的最小间隔（ms）。 */
export const TIMELINE_PARSE_THROTTLE_MS = 1000;

/** 该 URL 是否属于被节流的时间线端点；返回节流键（端点名）或 null（不节流）。 */
export function timelineParseThrottleKey(url: string): string | null {
  for (const key of THROTTLED_TIMELINE_ENDPOINTS) {
    if (url.includes(key)) return key;
  }
  return null;
}

export interface ParseThrottle {
  /** 该响应是否应被解析（节流窗口外 / 非时间线端点恒为 true）。 */
  allow(url: string, at?: number): boolean;
  /** 记录一次实际解析（只有真正解析过才 mark，否则节流永远不解除）。 */
  mark(url: string, at?: number): void;
}

/** 按端点名的解析节流器；now 可注入便于单测。 */
export function createParseThrottle(
  options: { intervalMs?: number; now?: () => number } = {},
): ParseThrottle {
  const intervalMs = options.intervalMs ?? TIMELINE_PARSE_THROTTLE_MS;
  const now = options.now ?? (() => Date.now());
  const lastParseAt = new Map<string, number>();
  return {
    allow(url: string, at: number = now()): boolean {
      const key = timelineParseThrottleKey(url);
      if (!key) return true;
      const last = lastParseAt.get(key);
      return last === undefined || at - last >= intervalMs;
    },
    mark(url: string, at: number = now()): void {
      const key = timelineParseThrottleKey(url);
      if (!key) return;
      lastParseAt.set(key, at);
    },
  };
}

export interface SanitizedBridgeData {
  /** handle -> rest_id 入库条目（全部通过严格校验） */
  idEntries: Array<{ handle: string; xUserId: string }>;
  /** 明确 following === true 的账号（本地关注保护） */
  followedEntries: Array<{ handle: string; xUserId?: string }>;
  /** 作者 bio（检测增强；handle 已小写去重） */
  bios: Array<{ handle: string; bio: string }>;
  /** 当前登录账号（严格校验后的小写 handle） */
  selfHandle?: string;
  isFollowingPage: boolean;
  /** 内容脚本启动后桥补发的旧数据（只给 AI 味检测用，流速等统计不重复计） */
  replay?: boolean;
  /** Following 页全量账号（分页同步用） */
  following: Array<{ handle: string; xUserId?: string }>;
  followingCursor?: string;
  sourceUrl?: string;
  /** 推文指标（流速徽标、本页热帖）：只在本地内存使用，不上传。 */
  tweetStats: SanitizedTweetStat[];
  /** 作者公开统计（量级标签）：来自推文作者与资料端点。 */
  authorStats: SanitizedAuthorStat[];
}

export interface SanitizedTweetStat {
  postId: string;
  handle: string;
  displayName?: string;
  /** 正文前 SNIPPET_MAX 字（本页热帖展示用）。 */
  snippet?: string;
  createdAt?: number;
  views?: number;
  likes?: number;
  retweets?: number;
  replies?: number;
  quotes?: number;
  bookmarks?: number;
  /** 作者头像（只接受 pbs.twimg.com 的地址）。 */
  avatarUrl?: string;
  /** 作者是否有蓝标。 */
  verified?: boolean;
  /** 作者是受保护账号（只对关注者可见）：这类帖子绝不进全站热榜。 */
  protected?: boolean;
  /** 第一张图片或视频封面（只接受 pbs.twimg.com）。 */
  mediaUrl?: string;
  /** 帖子语言（X 给的 BCP-47 简写，如 zh / en / ja；纯图片是 zxx / qme）。 */
  lang?: string;
  /** 原创 / 回复 / 引用（主页洞察的基线只算原创和引用）。 */
  kind?: PostKind;
  /** 回复的那条帖子 / 那个账号（AI 味检测配对原帖用，不上传）。 */
  inReplyToId?: string;
  inReplyToHandle?: string;
  /** 主页置顶条目（TimelinePinEntry）。 */
  pinned?: true;
  /** X 标记的可能敏感内容（多为成人图片/视频）：不进热帖、不上报全站热榜。 */
  sensitive?: true;
  media?: PostMedia;
}

export type PostKind = 'original' | 'reply' | 'quote';
export type PostMedia = 'none' | 'photo' | 'video' | 'gif' | 'mixed';
const POST_MEDIA = new Set<PostMedia>(['none', 'photo', 'video', 'gif', 'mixed']);

export interface SanitizedAuthorStat {
  handle: string;
  followers?: number;
  followingCount?: number;
  tweets?: number;
  createdAt?: number;
  /** 以下三项只来自资料端点（UserByScreenName），主页洞察的账号卡用。 */
  displayName?: string;
  avatarUrl?: string;
  verified?: boolean;
}

/** 弹窗热帖要能读完整条帖子：长帖也只截到这么长（3000 条 × 1000 字，内存仍在几 MB 内）。 */
const SNIPPET_MAX = 1000;
const DISPLAY_NAME_MAX = 64;
/** 计数上限：远超任何真实值，挡住伪造事件塞进来的巨大数字。 */
const COUNT_MAX = 1e13;
/** 时间戳合法区间：X 上线（2006）到 2100 年。 */
const TIMESTAMP_MIN = Date.UTC(2006, 0, 1);
const TIMESTAMP_MAX = Date.UTC(2100, 0, 1);

function sanitizeCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= COUNT_MAX
    ? value
    : undefined;
}

function sanitizeTimestamp(value: unknown): number | undefined {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= TIMESTAMP_MIN &&
    value <= TIMESTAMP_MAX
    ? value
    : undefined;
}

/** 图片地址只认 X 自己的图床，防止伪造事件让弹窗去加载任意站点。 */
const TWIMG_URL = /^https:\/\/pbs\.twimg\.com\/[\w./-]{1,300}$/;

function sanitizeLang(value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-z]{2,3}(-[a-z]{2,4})?$/i.test(value)
    ? value.toLowerCase()
    : undefined;
}

function sanitizeImageUrl(value: unknown): string | undefined {
  return typeof value === 'string' && TWIMG_URL.test(value) ? value : undefined;
}

function sanitizeText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

/** 只保留合法字段的浅层对象；全部字段都非法时返回空对象。 */
function pickDefined<T extends Record<string, unknown>>(record: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined) (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

function sanitizeAuthorStat(
  handle: string,
  raw: unknown,
  profile: Record<string, unknown> | null = null,
): SanitizedAuthorStat | null {
  if (!raw || typeof raw !== 'object') return null;
  const stats = raw as Record<string, unknown>;
  const picked = pickDefined({
    followers: sanitizeCount(stats.followers),
    followingCount: sanitizeCount(stats.followingCount),
    tweets: sanitizeCount(stats.tweets),
    createdAt: sanitizeTimestamp(stats.createdAt),
    ...(profile
      ? {
          displayName: sanitizeText(profile.displayName, DISPLAY_NAME_MAX),
          avatarUrl: sanitizeImageUrl(profile.avatarUrl),
          verified:
            typeof stats.isBlueVerified === 'boolean'
              ? (stats.isBlueVerified as boolean)
              : undefined,
        }
      : {}),
  });
  return Object.keys(picked).length > 0 ? { handle, ...picked } : null;
}

function sanitizeTweetStat(
  handle: string,
  tweet: Record<string, unknown>,
): SanitizedTweetStat | null {
  const postId = sanitizeXUserId(tweet.postId);
  if (!postId) return null;
  const metrics =
    tweet.metrics && typeof tweet.metrics === 'object'
      ? (tweet.metrics as Record<string, unknown>)
      : {};
  const author =
    tweet.author && typeof tweet.author === 'object'
      ? (tweet.author as Record<string, unknown>)
      : {};
  return {
    postId,
    handle,
    ...pickDefined({
      displayName: sanitizeText(author.displayName, DISPLAY_NAME_MAX),
      snippet: sanitizeText(tweet.text, SNIPPET_MAX),
      createdAt: sanitizeTimestamp(tweet.createdAt),
      views: sanitizeCount(metrics.views),
      likes: sanitizeCount(metrics.likes),
      retweets: sanitizeCount(metrics.retweets),
      replies: sanitizeCount(metrics.replies),
      quotes: sanitizeCount(metrics.quotes),
      bookmarks: sanitizeCount(metrics.bookmarks),
      avatarUrl: sanitizeImageUrl(author.avatarUrl),
      verified:
        author.stats && typeof author.stats === 'object'
          ? typeof (author.stats as Record<string, unknown>).isBlueVerified === 'boolean'
            ? ((author.stats as Record<string, unknown>).isBlueVerified as boolean)
            : undefined
          : undefined,
      mediaUrl: sanitizeImageUrl(tweet.mediaUrl),
      // 解析器历史原因把推文语言放在 author.lang（见 x-adapter ParsedTweetAuthor）
      lang: sanitizeLang(author.lang),
      protected:
        author.stats && typeof author.stats === 'object'
          ? typeof (author.stats as Record<string, unknown>).isProtected === 'boolean'
            ? ((author.stats as Record<string, unknown>).isProtected as boolean)
            : undefined
          : undefined,
      kind:
        tweet.isReply === true
          ? ('reply' as const)
          : tweet.isQuote === true
            ? ('quote' as const)
            : tweet.isReply === false && tweet.isQuote === false
              ? ('original' as const)
              : undefined,
      pinned: tweet.isPinned === true ? (true as const) : undefined,
      sensitive: tweet.possiblySensitive === true ? (true as const) : undefined,
      inReplyToId: sanitizeXUserId(tweet.inReplyToId),
      inReplyToHandle: normalizeStrictHandle(tweet.inReplyToHandle) ?? undefined,
      media: POST_MEDIA.has(tweet.media as PostMedia) ? (tweet.media as PostMedia) : undefined,
    }),
  };
}

/**
 * 把桥事件 detail（JSON 解析后的 unknown）收敛成可安全消费的子集。
 * 返回 null 表示整体形态非法（不是对象 / matchedEndpoints 不是字符串数组）。
 */
export function sanitizeBridgePayload(raw: unknown): SanitizedBridgeData | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  if (!Array.isArray(data.matchedEndpoints)) return null;
  const matchedEndpoints = data.matchedEndpoints.filter(
    (endpoint): endpoint is string => typeof endpoint === 'string',
  );

  const idEntries: SanitizedBridgeData['idEntries'] = [];
  const followedEntries: SanitizedBridgeData['followedEntries'] = [];
  const bios: SanitizedBridgeData['bios'] = [];
  const seenBios = new Set<string>();
  const tweetStats: SanitizedTweetStat[] = [];
  const authorStats: SanitizedAuthorStat[] = [];

  // timeline 响应：作者字段逐个校验，任一字段非法只丢该账号，不影响其余数据
  const tweets = Array.isArray(data.tweets) ? data.tweets : [];
  for (const tweet of tweets) {
    const author =
      tweet && typeof tweet === 'object' ? (tweet as { author?: unknown }).author : undefined;
    if (!author || typeof author !== 'object') continue;
    const raw = author as {
      handle?: unknown;
      xUserId?: unknown;
      bio?: unknown;
      following?: unknown;
    };
    const handle = normalizeStrictHandle(raw.handle);
    if (!handle) continue;
    const xUserId = sanitizeXUserId(raw.xUserId);
    if (xUserId) {
      idEntries.push({ handle, xUserId });
    }
    if (raw.following === true) {
      followedEntries.push({ handle, ...(xUserId ? { xUserId } : {}) });
    }
    if (typeof raw.bio === 'string' && raw.bio && !seenBios.has(handle)) {
      seenBios.add(handle);
      bios.push({ handle, bio: raw.bio });
    }
    const tweetStat = sanitizeTweetStat(handle, tweet as Record<string, unknown>);
    if (tweetStat) tweetStats.push(tweetStat);
    const authorStat = sanitizeAuthorStat(handle, (author as { stats?: unknown }).stats);
    if (authorStat) authorStats.push(authorStat);
  }

  // 资料端点（UserByScreenName）：只取公开统计
  const users = Array.isArray(data.users) ? data.users : [];
  for (const user of users) {
    const raw = user && typeof user === 'object' ? (user as Record<string, unknown>) : {};
    const handle = normalizeStrictHandle(raw.handle);
    if (!handle) continue;
    const authorStat = sanitizeAuthorStat(handle, raw.stats, raw);
    if (authorStat) authorStats.push(authorStat);
  }

  // list 成员：rest_id 必需（idEntries 的存量来源之一），非法成员整条丢弃
  const listMembers = Array.isArray(data.listMembers) ? data.listMembers : [];
  for (const member of listMembers) {
    const raw = member && typeof member === 'object' ? (member as Record<string, unknown>) : {};
    const handle = normalizeStrictHandle(raw.handle);
    const xUserId = sanitizeXUserId(raw.xUserId);
    if (handle && xUserId) {
      idEntries.push({ handle, xUserId });
    }
  }

  // following 数组：Following 页与 timeline 内嵌关系共用；id 可选
  const following: SanitizedBridgeData['following'] = [];
  const rawFollowing = Array.isArray(data.following) ? data.following : [];
  for (const account of rawFollowing) {
    const raw = account && typeof account === 'object' ? (account as Record<string, unknown>) : {};
    const handle = normalizeStrictHandle(raw.handle);
    if (!handle) continue;
    const xUserId = sanitizeXUserId(raw.xUserId);
    following.push({ handle, ...(xUserId ? { xUserId } : {}) });
    followedEntries.push({ handle, ...(xUserId ? { xUserId } : {}) });
    if (xUserId) {
      idEntries.push({ handle, xUserId });
    }
  }

  const selfHandle = normalizeStrictHandle(data.selfHandle) ?? undefined;
  const followingCursor =
    typeof data.followingCursor === 'string' && data.followingCursor.length > 0
      ? data.followingCursor
      : undefined;
  const sourceUrl =
    typeof data.sourceUrl === 'string' && data.sourceUrl.length > 0 ? data.sourceUrl : undefined;

  return {
    ...(data.replay === true ? { replay: true } : {}),
    idEntries,
    followedEntries,
    bios,
    ...(selfHandle ? { selfHandle } : {}),
    isFollowingPage: matchedEndpoints.includes('Following'),
    following,
    ...(followingCursor ? { followingCursor } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
    tweetStats,
    authorStats,
  };
}
