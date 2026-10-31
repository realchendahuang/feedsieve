#!/usr/bin/env node
/**
 * 把抓到的真实 X GraphQL 响应裁剪成可提交的测试夹具。
 *
 * 用法：
 *   node scripts/prune-x-fixture.mjs <capture.json> <operation> <out.json> [maxEntries]
 *
 * capture.json 是 `[{ url, body }]` 数组（body 为响应原文）。取第一个 url 含
 * operation 的响应。
 *
 * 裁剪规则（白名单，宁缺毋滥）：
 * - 时间线骨架只保留 SCAFFOLD_KEYS 里的键；其他键一律丢弃。
 * - tweet / user 只保留解析器需要的字段；正文、昵称、简介、handle 全部替换为占位值，
 *   同一个 handle 在整份夹具里映射到同一个占位值，保持引用关系。
 * - 数值（计数、浏览量、时间）保留原值：它们是解析契约的一部分，且不涉及个人信息。
 */
import { readFile, writeFile } from 'node:fs/promises';

const [capturePath, operation, outPath, maxEntriesArg] = process.argv.slice(2);
if (!capturePath || !operation || !outPath) {
  console.error('usage: prune-x-fixture.mjs <capture.json> <operation> <out.json> [maxEntries]');
  process.exit(1);
}
const maxEntries = Number(maxEntriesArg ?? 6);

const SCAFFOLD_KEYS = new Set([
  'data',
  'home',
  'home_timeline_urt',
  'threaded_conversation_with_injections_v2',
  'search_by_raw_query',
  'search_timeline',
  'user',
  'list',
  'tweets_timeline',
  'timeline',
  'instructions',
  'type',
  'entries',
  'entry',
  'entryId',
  'sortIndex',
  'content',
  'entryType',
  '__typename',
  'itemContent',
  'itemType',
  'items',
  'item',
  'cursorType',
  'value',
  'tweet_results',
  'user_results',
  'result',
]);

const handles = new Map();
let textSeq = 0;
function fakeHandle(real) {
  if (typeof real !== 'string') return real;
  if (!handles.has(real)) handles.set(real, `sample_user_${handles.size + 1}`);
  return handles.get(real);
}
function fakeText() {
  textSeq += 1;
  return `样本正文 ${textSeq}`;
}

function pruneUser(user) {
  if (!user || typeof user !== 'object') return user;
  const out = { __typename: user.__typename, rest_id: user.rest_id };
  if (user.core) {
    out.core = {
      created_at: user.core.created_at,
      name:
        user.core.name === undefined ? undefined : `样本昵称 ${fakeHandle(user.core.screen_name)}`,
      screen_name: fakeHandle(user.core.screen_name),
    };
  }
  if (user.legacy) {
    out.legacy = {
      screen_name: fakeHandle(user.legacy.screen_name),
      name: user.legacy.name === undefined ? undefined : '样本昵称',
      description: user.legacy.description === undefined ? undefined : '样本简介',
      following: user.legacy.following,
      blocking: user.legacy.blocking,
      followers_count: user.legacy.followers_count,
      friends_count: user.legacy.friends_count,
      statuses_count: user.legacy.statuses_count,
      created_at: user.legacy.created_at,
      protected: user.legacy.protected,
    };
  }
  for (const key of ['relationship_counts', 'tweet_counts', 'privacy', 'verification']) {
    if (user[key] !== undefined) out[key] = user[key];
  }
  if (user.is_blue_verified !== undefined) out.is_blue_verified = user.is_blue_verified;
  if (user.profile_bio) out.profile_bio = { description: '样本简介' };
  if (user.relationship_perspectives) {
    const { following, blocking } = user.relationship_perspectives;
    out.relationship_perspectives = { following, blocking };
  }
  return out;
}

function pruneTweet(tweet) {
  if (!tweet || typeof tweet !== 'object') return tweet;
  if (tweet.__typename === 'TweetWithVisibilityResults') {
    return { __typename: tweet.__typename, tweet: pruneTweet(tweet.tweet) };
  }
  const legacy = tweet.legacy ?? {};
  const out = {
    __typename: tweet.__typename,
    rest_id: tweet.rest_id,
    core: { user_results: { result: pruneUser(tweet.core?.user_results?.result) } },
    legacy: {
      full_text: legacy.full_text === undefined ? undefined : fakeText(),
      lang: legacy.lang,
      created_at: legacy.created_at,
      favorite_count: legacy.favorite_count,
      retweet_count: legacy.retweet_count,
      reply_count: legacy.reply_count,
      quote_count: legacy.quote_count,
      bookmark_count: legacy.bookmark_count,
      is_quote_status: legacy.is_quote_status,
      in_reply_to_status_id_str: legacy.in_reply_to_status_id_str,
      extended_entities: legacy.extended_entities
        ? { media: (legacy.extended_entities.media ?? []).map((m) => ({ type: m.type })) }
        : undefined,
      retweeted_status_result: legacy.retweeted_status_result
        ? { result: pruneTweet(legacy.retweeted_status_result.result) }
        : undefined,
    },
  };
  if (tweet.views) out.views = { count: tweet.views.count, state: tweet.views.state };
  return out;
}

function prune(node, parentKey) {
  if (Array.isArray(node)) {
    const items = node.map((item) => prune(item, parentKey));
    return parentKey === 'entries' || parentKey === 'items' ? items.slice(0, maxEntries) : items;
  }
  if (!node || typeof node !== 'object') return node;
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (!SCAFFOLD_KEYS.has(key)) continue;
    if (key === 'result' && parentKey === 'tweet_results') out.result = pruneTweet(value);
    else if (key === 'result' && parentKey === 'user_results') out.result = pruneUser(value);
    else if (
      key === 'result' &&
      parentKey === 'user' &&
      value?.__typename === 'User' &&
      !value.timeline
    )
      out.result = pruneUser(value);
    else if (key === 'result' && parentKey === 'user' && value?.timeline)
      out.result = { __typename: value.__typename, timeline: prune(value.timeline, 'timeline') };
    else out[key] = prune(value, key);
  }
  return out;
}

const captures = JSON.parse(await readFile(capturePath, 'utf8'));
const hit = captures.find((c) => typeof c.url === 'string' && c.url.includes(operation));
if (!hit) {
  console.error(`no capture with url containing ${operation}`);
  process.exit(1);
}
const pruned = prune(JSON.parse(hit.body), '');
let json = JSON.stringify(pruned, null, 2);

// rest_id（用户与帖子）同样能定位真实账号：收集所有 rest_id，按出现顺序映射为假 ID，
// 再在全文替换（entryId 如 `tweet-<id>` 里引用的同一 ID 一并替换，保持引用关系）。
const ids = new Map();
for (const match of json.matchAll(/"rest_id": "(\d+)"/g)) {
  if (!ids.has(match[1])) ids.set(match[1], String(1000000000000000000n + BigInt(ids.size + 1)));
}
json = json.replace(/\d{8,20}/g, (digits) => ids.get(digits) ?? digits);

await writeFile(outPath, `${json}\n`);
console.log(
  `wrote ${outPath} (${handles.size} handles, ${ids.size} ids anonymized, ${textSeq} texts replaced)`,
);
