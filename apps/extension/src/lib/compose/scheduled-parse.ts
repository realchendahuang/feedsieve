/**
 * 解析 X 网页版自己的预排期接口（纯函数，MAIN world 网络桥和测试共用）。
 *
 * - `FetchScheduledTweets`（GET）：打开「草稿 › 预排期」时 X 自己拉的列表，
 *   `data.viewer.scheduled_tweet_list[]`：`rest_id`、`scheduling_info.execute_at`、
 *   `tweet_create_request.status`、`media_entities`（2026-10-31 实测）。
 * - `CreateScheduledTweet` / `EditScheduledTweet` / `DeleteScheduledTweet`（POST）：
 *   用户在 X 里点「预排期」「更新」「删除」时 X 发的请求，从请求体读时间和正文。
 *
 * 扩展不自己调这些接口，只读 X 已经发出、已经收到的数据。
 */

export interface ScheduledPost {
  /** X 的预排期帖子 ID（rest_id） */
  id: string;
  /** 发布时刻，Unix 毫秒 */
  executeAt: number;
  /** 正文前 280 字 */
  text: string;
  /** 图片 / 视频数 */
  media: number;
}

export type ScheduledEvent =
  | { kind: 'list'; posts: ScheduledPost[] }
  | { kind: 'upsert'; post: ScheduledPost }
  | { kind: 'delete'; id: string };

const TEXT_MAX = 280;
const ID_RE = /^\d{1,25}$/;

/** `/i/api/graphql/<queryId>/<Operation>` → Operation */
export function graphqlOperation(url: string): string | null {
  const match = /\/graphql\/[\w-]+\/([A-Za-z]+)(?:[?#]|$)/.exec(url);
  return match ? match[1]! : null;
}

export function isScheduledOperation(operation: string | null): boolean {
  return (
    operation === 'FetchScheduledTweets' ||
    operation === 'CreateScheduledTweet' ||
    operation === 'EditScheduledTweet' ||
    operation === 'DeleteScheduledTweet'
  );
}

/** 秒或毫秒都收：小于 1e12 的当秒。 */
export function toMs(value: unknown): number | null {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return null;
  return Math.round(n < 1e12 ? n * 1000 : n);
}

function obj(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asId(value: unknown): string | null {
  const text = typeof value === 'number' ? String(value) : value;
  return typeof text === 'string' && ID_RE.test(text) ? text : null;
}

function cleanText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.split('\u0000').join('').slice(0, TEXT_MAX);
}

function mediaCount(...sources: unknown[]): number {
  for (const source of sources) if (Array.isArray(source)) return Math.min(source.length, 4);
  return 0;
}

function parseListItem(value: unknown): ScheduledPost | null {
  const item = obj(value);
  if (!item) return null;
  const id = asId(item.rest_id);
  const executeAt = toMs(obj(item.scheduling_info)?.execute_at);
  if (!id || executeAt === null) return null;
  const request = obj(item.tweet_create_request);
  return {
    id,
    executeAt,
    text: cleanText(request?.status),
    media: mediaCount(item.media_entities, request?.media_ids),
  };
}

/** FetchScheduledTweets 响应 → 列表；形状对不上返回 null（不要把缓存清空）。 */
export function parseScheduledList(body: unknown): ScheduledPost[] | null {
  const list = obj(obj(obj(body)?.data)?.viewer)?.scheduled_tweet_list;
  if (!Array.isArray(list)) return null;
  return list
    .map(parseListItem)
    .filter((post): post is ScheduledPost => post !== null)
    .sort((a, b) => a.executeAt - b.executeAt);
}

/** 请求体 → variables（POST JSON 或 GET 查询串都认）。 */
export function requestVariables(url: string, body: unknown): Record<string, unknown> | null {
  let parsed: unknown = body;
  if (typeof body === 'string') {
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = null;
    }
  }
  const fromBody = obj(obj(parsed)?.variables);
  if (fromBody) return fromBody;
  try {
    const raw = new URL(url, 'https://x.com').searchParams.get('variables');
    return raw ? obj(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/** 在响应里找新建出来的 ID（字段名随版本变，按 rest_id / scheduled_tweet_id 找第一个）。 */
function findResponseId(body: unknown, depth = 0): string | null {
  const node = obj(body);
  if (!node || depth > 5) return null;
  for (const key of ['rest_id', 'scheduled_tweet_id', 'id_str']) {
    const id = asId(node[key]);
    if (id) return id;
  }
  for (const value of Object.values(node)) {
    const id = findResponseId(value, depth + 1);
    if (id) return id;
  }
  return null;
}

/**
 * 写操作 → 事件。
 * - Create：时间和正文来自请求体，ID 来自响应
 * - Edit：ID 来自请求体
 * - Delete：只要 ID
 */
export function parseScheduledMutation(
  operation: string,
  variables: Record<string, unknown> | null,
  response: unknown,
): ScheduledEvent | null {
  if (!variables) return null;
  if (obj(response)?.errors && !obj(response)?.data) return null;
  if (operation === 'DeleteScheduledTweet') {
    const id = asId(variables.scheduled_tweet_id);
    return id ? { kind: 'delete', id } : null;
  }
  if (operation !== 'CreateScheduledTweet' && operation !== 'EditScheduledTweet') return null;
  const executeAt = toMs(variables.execute_at);
  const id =
    operation === 'EditScheduledTweet'
      ? asId(variables.scheduled_tweet_id)
      : findResponseId(obj(response)?.data);
  if (!id || executeAt === null) return null;
  const request = obj(variables.post_tweet_request);
  return {
    kind: 'upsert',
    post: {
      id,
      executeAt,
      text: cleanText(request?.status),
      media: mediaCount(request?.media_ids),
    },
  };
}

/** 网络桥收到的原始数据形状校验（内容脚本那边再验一遍，不信任页面传来的东西）。 */
export function asScheduledEvent(value: unknown): ScheduledEvent | null {
  const event = obj(value);
  if (!event) return null;
  if (event.kind === 'delete') {
    const id = asId(event.id);
    return id ? { kind: 'delete', id } : null;
  }
  const check = (post: unknown): ScheduledPost | null => {
    const p = obj(post);
    if (!p) return null;
    const id = asId(p.id);
    const executeAt = toMs(p.executeAt);
    if (!id || executeAt === null) return null;
    const media = Number(p.media);
    return {
      id,
      executeAt,
      text: cleanText(p.text),
      media: Number.isInteger(media) && media >= 0 && media <= 4 ? media : 0,
    };
  };
  if (event.kind === 'upsert') {
    const post = check(event.post);
    return post ? { kind: 'upsert', post } : null;
  }
  if (event.kind === 'list' && Array.isArray(event.posts)) {
    return {
      kind: 'list',
      posts: event.posts
        .slice(0, 500)
        .map(check)
        .filter((p): p is ScheduledPost => p !== null)
        .sort((a, b) => a.executeAt - b.executeAt),
    };
  }
  return null;
}
