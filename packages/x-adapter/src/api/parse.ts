/**
 * X GraphQL 响应解析器。
 *
 * 机制来源：PureTwitter 的 XHR 钩子方案（见 docs/legacy/research/PURETWITTER_MECHANISM.md），
 * 以 TypeScript 重写并类型化。网络 JSON 比 DOM 稳定一个数量级，
 * 且能拿到 DOM 拿不到的字段：rest_id（x_user_id）、bio、following。
 *
 * 纯函数：输入 URL + 已 JSON.parse 的响应体，输出结构化数据。
 * 响应形状变化时这里安全失败（返回空结果），绝不 throw。
 */

/**
 * 账号公开统计。X 在 2026-09 起把这些字段从 `legacy` 移到了
 * `relationship_counts` / `tweet_counts` / `core.created_at` / `privacy`，
 * 解析时两种形状都认（2026-10-29 真实抓包确认新形状，见 fixtures/x/graphql）。
 */
export interface ParsedUserStats {
  followers?: number;
  /** 该账号关注了多少人（不是「我是否关注他」，那个是 author.following）。 */
  followingCount?: number;
  tweets?: number;
  /** 注册时间，Unix 毫秒。 */
  createdAt?: number;
  isProtected?: boolean;
  isBlueVerified?: boolean;
}

export interface ParsedTweetAuthor {
  handle: string;
  /** X 内部数字用户 ID。拉黑 API 需要它，DOM 只能拿到 handle。 */
  xUserId?: string;
  displayName?: string;
  bio?: string;
  following?: boolean;
  /** 注意：历史原因这里放的是**推文**语言（legacy.lang），检测管线依赖它。 */
  lang?: string;
  stats?: ParsedUserStats;
  /** 头像地址（`avatar.image_url`，旧响应是 `legacy.profile_image_url_https`）。 */
  avatarUrl?: string;
}

/** 推文互动指标。字段缺失表示响应里没有，不等于 0。 */
export interface ParsedTweetMetrics {
  views?: number;
  likes?: number;
  retweets?: number;
  replies?: number;
  quotes?: number;
  bookmarks?: number;
}

export type ParsedMediaKind = 'none' | 'photo' | 'video' | 'gif' | 'mixed';

export interface ParsedTweet {
  postId?: string;
  author: ParsedTweetAuthor;
  text: string;
  isRetweet: boolean;
  isPromoted: boolean;
  /** 发帖时间，Unix 毫秒。 */
  createdAt?: number;
  metrics: ParsedTweetMetrics;
  media: ParsedMediaKind;
  /** 第一张图片或视频封面的地址；没有媒体时缺省。 */
  mediaUrl?: string;
  isReply: boolean;
  /** 回复的那条帖子的 ID（legacy.in_reply_to_status_id_str）；AI 味检测用来配对原帖。 */
  inReplyToId?: string;
  /** 回复的那个账号（legacy.in_reply_to_screen_name）。 */
  inReplyToHandle?: string;
  isQuote: boolean;
  /** X 标记的可能敏感内容（legacy.possibly_sensitive，多为成人图片/视频）：不进热榜。 */
  possiblySensitive?: boolean;
  /** 来自个人主页的置顶条目（TimelinePinEntry）。 */
  isPinned?: boolean;
}

/** UserByScreenName 等资料端点解析出的账号。 */
export interface ParsedProfileUser {
  handle: string;
  xUserId?: string;
  displayName?: string;
  bio?: string;
  following?: boolean;
  blocking?: boolean;
  avatarUrl?: string;
  stats: ParsedUserStats;
}

export interface ParsedListMember {
  xUserId: string;
  handle: string;
  blocking?: boolean;
}

export interface ParsedFollowingAccount {
  handle: string;
  xUserId?: string;
}

export interface ParsedApiData {
  tweets: ParsedTweet[];
  promoted: ParsedTweet[];
  listMembers: ParsedListMember[];
  following: ParsedFollowingAccount[];
  /** Following 分页的底部 cursor；无 cursor 表示已到末页。 */
  followingCursor?: string;
  /** MAIN-world bridge 回填的原始请求 URL，用于用户显式启动全量同步后继续分页。 */
  sourceUrl?: string;
  /** 当前登录账号（来自 settings.json 响应）。 */
  selfHandle?: string;
  /** 资料端点（UserByScreenName）返回的账号。 */
  users: ParsedProfileUser[];
  /** 命中的端点类别，便于调试与统计。 */
  matchedEndpoints: string[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

/** 每次返回新数组：解析函数会 push 进这些数组，共享常量会把结果串到下一次调用。 */
function emptyData(): ParsedApiData {
  return {
    tweets: [],
    promoted: [],
    listMembers: [],
    following: [],
    users: [],
    matchedEndpoints: [],
  };
}

interface ParsedUserResult {
  handle: string;
  xUserId?: string;
  displayName?: string;
  bio?: string;
  following?: boolean;
  blocking?: boolean;
  avatarUrl?: string;
  stats: ParsedUserStats;
}

function toCount(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return undefined;
}

/** X 的时间格式 `Thu Oct 29 15:34:15 +0000 2026` → Unix 毫秒。 */
function toTimestamp(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

function parseUserStats(result: Json): ParsedUserStats {
  const legacy = result?.legacy;
  const followers = toCount(result?.relationship_counts?.followers ?? legacy?.followers_count);
  const followingCount = toCount(result?.relationship_counts?.following ?? legacy?.friends_count);
  const tweets = toCount(result?.tweet_counts?.tweets ?? legacy?.statuses_count);
  const createdAt = toTimestamp(result?.core?.created_at ?? legacy?.created_at);
  const isProtected = result?.privacy?.protected ?? legacy?.protected;
  const isBlueVerified = result?.is_blue_verified;
  return {
    ...(followers !== undefined ? { followers } : {}),
    ...(followingCount !== undefined ? { followingCount } : {}),
    ...(tweets !== undefined ? { tweets } : {}),
    ...(createdAt !== undefined ? { createdAt } : {}),
    ...(typeof isProtected === 'boolean' ? { isProtected } : {}),
    ...(typeof isBlueVerified === 'boolean' ? { isBlueVerified } : {}),
  };
}

function parseMediaKind(legacy: Json): ParsedMediaKind {
  const media: Json[] = legacy?.extended_entities?.media ?? [];
  const kinds = new Set<ParsedMediaKind>();
  for (const item of media) {
    if (item?.type === 'photo') kinds.add('photo');
    else if (item?.type === 'video') kinds.add('video');
    else if (item?.type === 'animated_gif') kinds.add('gif');
  }
  if (kinds.size === 0) return 'none';
  if (kinds.size > 1) return 'mixed';
  return [...kinds][0] as ParsedMediaKind;
}

/** 第一个媒体的图片地址：照片是原图，视频 / GIF 是封面。 */
function firstMediaUrl(legacy: Json): string | undefined {
  const url = legacy?.extended_entities?.media?.[0]?.media_url_https;
  return typeof url === 'string' && url ? url : undefined;
}

/** 长帖全文：`note_tweet.note_tweet_results.result.text`；不是长帖时返回 undefined。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function noteTweetText(result: any): string | undefined {
  const text = result?.note_tweet?.note_tweet_results?.result?.text;
  return typeof text === 'string' && text.trim() ? text : undefined;
}

function parseTweetMetrics(result: Json): ParsedTweetMetrics {
  const legacy = result?.legacy;
  const entries: [keyof ParsedTweetMetrics, unknown][] = [
    ['views', result?.views?.count],
    ['likes', legacy?.favorite_count],
    ['retweets', legacy?.retweet_count],
    ['replies', legacy?.reply_count],
    ['quotes', legacy?.quote_count],
    ['bookmarks', legacy?.bookmark_count],
  ];
  const metrics: ParsedTweetMetrics = {};
  for (const [key, raw] of entries) {
    const value = toCount(raw);
    if (value !== undefined) metrics[key] = value;
  }
  return metrics;
}

/**
 * X 在 2026-09 将 User 的 legacy 字段拆到了 core / profile_bio /
 * relationship_perspectives；一段迁移期内两种响应会并存。
 */
function parseUserResult(result: Json): ParsedUserResult | null {
  const legacy = result?.legacy;
  const core = result?.core;
  const relationship = result?.relationship_perspectives;
  const handle: string | undefined = legacy?.screen_name ?? core?.screen_name;
  if (!handle) return null;
  const xUserId = result?.rest_id;
  const displayName = legacy?.name ?? core?.name;
  const bio = legacy?.description ?? result?.profile_bio?.description;
  const following = legacy?.following ?? relationship?.following;
  const blocking = legacy?.blocking ?? relationship?.blocking;
  const avatarUrl = result?.avatar?.image_url ?? legacy?.profile_image_url_https;
  return {
    handle,
    ...(xUserId ? { xUserId: String(xUserId) } : {}),
    ...(displayName ? { displayName } : {}),
    ...(typeof bio === 'string' ? { bio } : {}),
    ...(typeof following === 'boolean' ? { following } : {}),
    ...(typeof blocking === 'boolean' ? { blocking } : {}),
    ...(typeof avatarUrl === 'string' && avatarUrl ? { avatarUrl } : {}),
    stats: parseUserStats(result),
  };
}

function emptyWith(matchedEndpoints: string[]): ParsedApiData {
  return { ...emptyData(), matchedEndpoints };
}

/** 单条 tweet result -> ParsedTweet。转推解包到内层（作者/文本取原推）。 */
function parseTweetResult(result: Json, isPromoted = false): ParsedTweet | null {
  try {
    if (result?.__typename === 'TweetWithVisibilityResults') {
      result = result.tweet;
    }
    let isRetweet = false;
    if (result?.legacy?.retweeted_status_result?.result) {
      isRetweet = true;
      result = result.legacy.retweeted_status_result.result;
      if (result?.__typename === 'TweetWithVisibilityResults') {
        result = result.tweet;
      }
    }
    const legacy = result?.legacy;
    const user = parseUserResult(result?.core?.user_results?.result);
    if (!user) {
      return null;
    }
    const createdAt = toTimestamp(legacy?.created_at);
    return {
      postId: result?.rest_id,
      author: {
        handle: user.handle,
        ...(user.xUserId ? { xUserId: user.xUserId } : {}),
        ...(user.displayName ? { displayName: user.displayName } : {}),
        ...(typeof user.bio === 'string' ? { bio: user.bio } : {}),
        ...(typeof user.following === 'boolean' ? { following: user.following } : {}),
        lang: legacy?.lang,
        stats: user.stats,
        ...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}),
      },
      // 长帖（Premium 的 note tweet）：full_text 只有前 280 字加一个 t.co 链接，全文在 note_tweet 里
      text: noteTweetText(result) ?? legacy?.full_text ?? '',
      isRetweet,
      isPromoted,
      ...(createdAt !== undefined ? { createdAt } : {}),
      metrics: parseTweetMetrics(result),
      media: parseMediaKind(legacy),
      ...(firstMediaUrl(legacy) ? { mediaUrl: firstMediaUrl(legacy) } : {}),
      isReply: typeof legacy?.in_reply_to_status_id_str === 'string',
      ...(typeof legacy?.in_reply_to_status_id_str === 'string'
        ? { inReplyToId: legacy.in_reply_to_status_id_str as string }
        : {}),
      ...(typeof legacy?.in_reply_to_screen_name === 'string'
        ? { inReplyToHandle: legacy.in_reply_to_screen_name as string }
        : {}),
      isQuote: legacy?.is_quote_status === true,
      ...(legacy?.possibly_sensitive === true ? { possiblySensitive: true } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * 时间线的条目分散在多条 instruction 里：TweetDetail / UserOriginalsTimeline 的
 * 第一条是 TimelineClearCache，条目在后面的 TimelineAddEntries；个人主页置顶在
 * TimelinePinEntry.entry。只读 instructions[0] 会漏掉全部条目（2026-10-29 抓包确认）。
 */
function instructionEntries(instructions: Json): { entry: Json; pinned: boolean }[] {
  const out: { entry: Json; pinned: boolean }[] = [];
  for (const instruction of Array.isArray(instructions) ? instructions : []) {
    for (const entry of instruction?.entries ?? []) {
      out.push({ entry, pinned: false });
    }
    if (instruction?.type === 'TimelinePinEntry' && instruction.entry) {
      out.push({ entry: instruction.entry, pinned: true });
    }
  }
  return out;
}

/** 所有带推文的时间线（详情、首页、列表、搜索、个人主页）共用遍历。 */
function collectTimelineTweets(instructions: Json): ParsedTweet[] {
  const tweets: ParsedTweet[] = [];
  const push = (result: Json, isPromoted: boolean, isPinned: boolean): void => {
    const tweet = parseTweetResult(result, isPromoted);
    if (tweet) {
      tweets.push(isPinned ? { ...tweet, isPinned: true } : tweet);
    }
  };
  for (const { entry, pinned } of instructionEntries(instructions)) {
    const entryId: string = entry?.entryId ?? '';
    const result = entry?.content?.itemContent?.tweet_results?.result;
    const items = entry?.content?.items;
    if (Array.isArray(items)) {
      // conversationthread-（详情页回复）、home-conversation-（首页对话）等模块条目；
      // who-to-follow 之类的用户模块没有 tweet_results，会在 parseTweetResult 里被跳过。
      for (const item of items) {
        push(item?.item?.itemContent?.tweet_results?.result, false, false);
      }
    } else if (result) {
      push(result, entryId.startsWith('promoted-tweet'), pinned);
    }
  }
  return tweets;
}

function parseTweetDetail(body: Json): ParsedApiData {
  const instructions = body?.data?.threaded_conversation_with_injections_v2?.instructions;
  const data = emptyWith(['TweetDetail']);
  data.tweets = collectTimelineTweets(instructions);
  return data;
}

function parseHomeTimeline(body: Json): ParsedApiData {
  const all = collectTimelineTweets(body?.data?.home?.home_timeline_urt?.instructions);
  const data = emptyWith(['HomeTimeline']);
  data.tweets = all.filter((t) => !t.isPromoted);
  data.promoted = all.filter((t) => t.isPromoted);
  return data;
}

function parseListTimeline(body: Json): ParsedApiData {
  const all = collectTimelineTweets(body?.data?.list?.tweets_timeline?.timeline?.instructions);
  const data = emptyWith(['ListLatestTweetsTimeline']);
  data.tweets = all.filter((t) => !t.isPromoted);
  data.promoted = all.filter((t) => t.isPromoted);
  return data;
}

function parseSearchTimeline(body: Json): ParsedApiData {
  const instructions = body?.data?.search_by_raw_query?.search_timeline?.timeline?.instructions;
  const all = collectTimelineTweets(instructions);
  const data = emptyWith(['SearchTimeline']);
  data.tweets = all.filter((t) => !t.isPromoted);
  data.promoted = all.filter((t) => t.isPromoted);
  return data;
}

/**
 * 个人主页时间线，各 Tab 的响应形状相同（data.user.result.timeline.timeline）。
 * 2026-10-31 在真实主页上抓包确认的端点名：
 * 帖子 UserOriginalsTimeline、回复 UserRepliesTimeline、转帖 UserRepostsTimeline、
 * 视频 UserVideoTimeline、文章 UserArticlesTweets、亮点 UserHighlightsTweets、
 * 订阅 UserSuperFollowTweets。旧名 UserTweets / UserTweetsAndReplies / UserMedia 一并兼容。
 * 转帖 Tab 里是别人的帖子，解析时按原帖作者归属，不会算进主页主人的帖子。
 */
const USER_TIMELINE_OPERATIONS = [
  'UserOriginalsTimeline',
  'UserRepliesTimeline',
  'UserRepostsTimeline',
  'UserVideoTimeline',
  'UserArticlesTweets',
  'UserHighlightsTweets',
  'UserSuperFollowTweets',
  'UserTweetsAndReplies',
  'UserTweets',
  'UserMedia',
] as const;

function parseUserTimeline(body: Json): ParsedApiData {
  const result = body?.data?.user?.result;
  const instructions =
    result?.timeline?.timeline?.instructions ?? result?.timeline_v2?.timeline?.instructions;
  const all = collectTimelineTweets(instructions);
  const data = emptyWith(['UserTimeline']);
  data.tweets = all.filter((t) => !t.isPromoted);
  data.promoted = all.filter((t) => t.isPromoted);
  return data;
}

function parseUserByScreenName(body: Json): ParsedApiData {
  const data = emptyWith(['UserByScreenName']);
  const user = parseUserResult(body?.data?.user?.result);
  if (user) {
    data.users.push({
      handle: user.handle,
      ...(user.xUserId ? { xUserId: user.xUserId } : {}),
      ...(user.displayName ? { displayName: user.displayName } : {}),
      ...(typeof user.bio === 'string' ? { bio: user.bio } : {}),
      ...(typeof user.following === 'boolean' ? { following: user.following } : {}),
      ...(typeof user.blocking === 'boolean' ? { blocking: user.blocking } : {}),
      ...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}),
      stats: user.stats,
    });
  }
  return data;
}

function parseListMembers(body: Json): ParsedApiData {
  const data = emptyWith(['ListMembers']);
  for (const instruction of body?.data?.list?.members_timeline?.timeline?.instructions ?? []) {
    if (instruction?.type !== 'TimelineAddEntries') {
      continue;
    }
    for (const entry of instruction?.entries ?? []) {
      if (!String(entry?.entryId ?? '').startsWith('user-')) {
        continue;
      }
      const user = parseUserResult(entry?.content?.itemContent?.user_results?.result);
      if (user?.xUserId) {
        data.listMembers.push({
          xUserId: user.xUserId,
          handle: user.handle,
          ...(typeof user.blocking === 'boolean' ? { blocking: user.blocking } : {}),
        });
      }
    }
  }
  return data;
}

function parseFollowing(body: Json): ParsedApiData {
  const data = emptyWith(['Following']);
  for (const instruction of body?.data?.user?.result?.timeline?.timeline?.instructions ?? []) {
    if (instruction?.type !== 'TimelineAddEntries') {
      continue;
    }
    for (const entry of instruction?.entries ?? []) {
      const user = parseUserResult(entry?.content?.itemContent?.user_results?.result);
      if (user) {
        data.following.push({
          handle: user.handle,
          ...(user.xUserId ? { xUserId: user.xUserId } : {}),
        });
        continue;
      }
      const cursorType = String(entry?.content?.cursorType ?? '').toLowerCase();
      const entryId = String(entry?.entryId ?? '').toLowerCase();
      const cursor = entry?.content?.value;
      if (
        typeof cursor === 'string' &&
        cursor &&
        (cursorType === 'bottom' || entryId.startsWith('cursor-bottom'))
      ) {
        data.followingCursor = cursor;
      }
    }
  }
  return data;
}

function parseAccountSettings(body: Json): ParsedApiData {
  const handle: string | undefined = body?.screen_name;
  if (!handle) {
    return emptyWith(['AccountSettings']);
  }
  return { ...emptyWith(['AccountSettings']), selfHandle: handle };
}

/**
 * 网络桥的 URL 预过滤：与 parseXApiResponse 的分发特征保持一致。
 * 未命中的响应（私信/通知轮询等大体积 JSON）不值得 clone 后整包 JSON.parse。
 */
const ENDPOINT_URL_KEYS = [
  'TweetDetail',
  'HomeTimeline',
  'HomeLatestTimeline',
  'ListLatestTweetsTimeline',
  'SearchTimeline',
  ...USER_TIMELINE_OPERATIONS.map((op) => `/${op}`),
  '/UserByScreenName',
  '/ListMembers',
  '/Following',
  '/account/settings.json',
] as const;

export function mayMatchEndpoint(url: string): boolean {
  return ENDPOINT_URL_KEYS.some((key) => url.includes(key));
}

/**
 * 主入口：按 URL 特征分发（与 PureTwitter hijackXHR 相同的端点特征集）。
 * 未识别的 URL 返回 matchedEndpoints: [] 的空结果。
 */
export function parseXApiResponse(url: string, body: Json): ParsedApiData {
  try {
    if (typeof body !== 'object' || body === null) {
      return emptyData();
    }
    if (url.includes('TweetDetail')) {
      return parseTweetDetail(body);
    }
    if (url.includes('HomeTimeline') || url.includes('HomeLatestTimeline')) {
      return parseHomeTimeline(body);
    }
    if (url.includes('ListLatestTweetsTimeline')) {
      return parseListTimeline(body);
    }
    if (url.includes('SearchTimeline')) {
      return parseSearchTimeline(body);
    }
    if (USER_TIMELINE_OPERATIONS.some((op) => url.includes(`/${op}`))) {
      return parseUserTimeline(body);
    }
    if (url.includes('/UserByScreenName')) {
      return parseUserByScreenName(body);
    }
    if (url.includes('/ListMembers')) {
      return parseListMembers(body);
    }
    if (url.includes('/Following')) {
      return parseFollowing(body);
    }
    if (url.includes('/account/settings.json')) {
      return parseAccountSettings(body);
    }
  } catch {
    return emptyData();
  }
  return emptyData();
}
