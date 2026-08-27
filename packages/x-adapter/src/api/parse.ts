/**
 * X GraphQL 响应解析器。
 *
 * 机制来源：PureTwitter 的 XHR 钩子方案（见 docs/research/PURETWITTER_MECHANISM.md），
 * 以 TypeScript 重写并类型化。网络 JSON 比 DOM 稳定一个数量级，
 * 且能拿到 DOM 拿不到的字段：rest_id（x_user_id）、bio、following。
 *
 * 纯函数：输入 URL + 已 JSON.parse 的响应体，输出结构化数据。
 * 响应形状变化时这里安全失败（返回空结果），绝不 throw。
 */

export interface ParsedTweetAuthor {
  handle: string;
  /** X 内部数字用户 ID。拉黑 API 需要它，DOM 只能拿到 handle。 */
  xUserId?: string;
  displayName?: string;
  bio?: string;
  following?: boolean;
  lang?: string;
}

export interface ParsedTweet {
  postId?: string;
  author: ParsedTweetAuthor;
  text: string;
  isRetweet: boolean;
  isPromoted: boolean;
}

export interface ParsedListMember {
  xUserId: string;
  handle: string;
  blocking?: boolean;
}

export interface ParsedApiData {
  tweets: ParsedTweet[];
  promoted: ParsedTweet[];
  listMembers: ParsedListMember[];
  following: string[];
  /** 当前登录账号（来自 settings.json 响应）。 */
  selfHandle?: string;
  /** 命中的端点类别，便于调试与统计。 */
  matchedEndpoints: string[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const EMPTY: ParsedApiData = {
  tweets: [],
  promoted: [],
  listMembers: [],
  following: [],
  matchedEndpoints: [],
};

function emptyWith(matchedEndpoints: string[]): ParsedApiData {
  return { ...EMPTY, matchedEndpoints };
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
    const userLegacy = result?.core?.user_results?.result?.legacy;
    const handle: string | undefined = userLegacy?.screen_name;
    if (!handle) {
      return null;
    }
    return {
      postId: result?.rest_id,
      author: {
        handle,
        xUserId: result?.core?.user_results?.result?.rest_id,
        displayName: userLegacy?.name,
        bio: userLegacy?.description,
        following: userLegacy?.following,
        lang: legacy?.lang,
      },
      text: legacy?.full_text ?? '',
      isRetweet,
      isPromoted,
    };
  } catch {
    return null;
  }
}

/** detail（TweetDetail）与 timeline（HomeTimeline / ListLatestTweetsTimeline）共用遍历。 */
function collectTimelineTweets(entries: Json): ParsedTweet[] {
  const tweets: ParsedTweet[] = [];
  const push = (result: Json, isPromoted: boolean): void => {
    const tweet = parseTweetResult(result, isPromoted);
    if (tweet) {
      tweets.push(tweet);
    }
  };
  for (const entry of entries ?? []) {
    const entryId: string = entry?.entryId ?? '';
    const result = entry?.content?.itemContent?.tweet_results?.result;
    if (entryId.startsWith('conversationthread-')) {
      for (const item of entry?.content?.items ?? []) {
        push(item?.item?.itemContent?.tweet_results?.result, false);
      }
    } else if (result) {
      push(result, entryId.startsWith('promoted-tweet'));
    }
  }
  return tweets;
}

function parseTweetDetail(body: Json): ParsedApiData {
  const instructions =
    body?.data?.threaded_conversation_with_injections_v2?.instructions;
  const entries = instructions?.[0]?.entries;
  const data = emptyWith(['TweetDetail']);
  data.tweets = collectTimelineTweets(entries);
  return data;
}

function parseHomeTimeline(body: Json): ParsedApiData {
  const entries =
    body?.data?.home?.home_timeline_urt?.instructions?.[0]?.entries;
  const all = collectTimelineTweets(entries);
  const data = emptyWith(['HomeTimeline']);
  data.tweets = all.filter((t) => !t.isPromoted);
  data.promoted = all.filter((t) => t.isPromoted);
  return data;
}

function parseListTimeline(body: Json): ParsedApiData {
  const entries =
    body?.data?.list?.tweets_timeline?.timeline?.instructions?.[0]?.entries;
  const all = collectTimelineTweets(entries);
  const data = emptyWith(['ListLatestTweetsTimeline']);
  data.tweets = all.filter((t) => !t.isPromoted);
  data.promoted = all.filter((t) => t.isPromoted);
  return data;
}

function parseSearchTimeline(body: Json): ParsedApiData {
  const instructions =
    body?.data?.search_by_raw_query?.search_timeline?.timeline?.instructions;
  const entries = instructions?.[0]?.entries;
  const all = collectTimelineTweets(entries);
  const data = emptyWith(['SearchTimeline']);
  data.tweets = all.filter((t) => !t.isPromoted);
  data.promoted = all.filter((t) => t.isPromoted);
  return data;
}

function parseListMembers(body: Json): ParsedApiData {
  const data = emptyWith(['ListMembers']);
  for (const instruction of body?.data?.list?.members_timeline?.timeline
    ?.instructions ?? []) {
    if (instruction?.type !== 'TimelineAddEntries') {
      continue;
    }
    for (const entry of instruction?.entries ?? []) {
      if (!String(entry?.entryId ?? '').startsWith('user-')) {
        continue;
      }
      const result = entry?.content?.itemContent?.user_results?.result;
      const xUserId: string | undefined = result?.rest_id;
      const handle: string | undefined = result?.legacy?.screen_name;
      if (xUserId && handle) {
        data.listMembers.push({
          xUserId,
          handle,
          blocking: result?.legacy?.blocking,
        });
      }
    }
  }
  return data;
}

function parseFollowing(body: Json): ParsedApiData {
  const data = emptyWith(['Following']);
  for (const instruction of body?.data?.user?.result?.timeline?.timeline
    ?.instructions ?? []) {
    if (instruction?.type !== 'TimelineAddEntries') {
      continue;
    }
    for (const entry of instruction?.entries ?? []) {
      const handle: string | undefined =
        entry?.content?.itemContent?.user_results?.result?.legacy?.screen_name;
      if (handle) {
        data.following.push(handle);
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
 * 主入口：按 URL 特征分发（与 PureTwitter hijackXHR 相同的端点特征集）。
 * 未识别的 URL 返回 matchedEndpoints: [] 的空结果。
 */
export function parseXApiResponse(url: string, body: Json): ParsedApiData {
  try {
    if (typeof body !== 'object' || body === null) {
      return EMPTY;
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
    return EMPTY;
  }
  return EMPTY;
}
