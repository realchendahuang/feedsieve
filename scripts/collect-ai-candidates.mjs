#!/usr/bin/env node
/**
 * 从简中热帖评论区收集候选回复者，并拉取他们的回复时间线（写入 /tmp/feedsieve-ai-eval/）。
 *
 * 热帖来源：TikHub 搜索（Top，lang:zh，高回复）+ 全站热榜 /v1/hot。
 * 每个帖子 1 次评论请求，每个候选 1 次回复请求（$0.001/次）。
 *
 *   node scripts/collect-ai-candidates.mjs --posts 40 --accounts 200
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = '/tmp/feedsieve-ai-eval';
mkdirSync(CACHE, { recursive: true });

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? Number(process.argv[index + 1]) : fallback;
};
const MAX_POSTS = arg('posts', 40);
const MAX_ACCOUNTS = arg('accounts', 200);

const devVars = readFileSync(join(ROOT, 'apps/community-api/.dev.vars'), 'utf8');
const KEY = devVars
  .match(/^TIKHUB_API_KEY=(.+)$/m)[1]
  .trim()
  .replace(/^["']|["']$/g, '');

async function tikhub(path, params) {
  const url = new URL(`https://api.tikhub.io/api/v1/twitter/web/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${KEY}` } });
    const json = await res.json().catch(() => ({}));
    if (res.ok && json.data) return json.data;
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  return null;
}

const QUERIES = [
  'lang:zh min_replies:80 -filter:replies',
  'lang:zh min_replies:50 AI -filter:replies',
  'lang:zh min_replies:50 币安 -filter:replies',
  'lang:zh min_replies:50 Claude -filter:replies',
  'lang:zh min_replies:50 蓝V -filter:replies',
  'lang:zh min_replies:40 出海 -filter:replies',
  'lang:zh min_replies:40 副业 -filter:replies',
  'lang:zh min_replies:40 美股 -filter:replies',
];

const postsFile = join(CACHE, '_posts.json');
let posts = existsSync(postsFile) ? JSON.parse(readFileSync(postsFile, 'utf8')) : [];
if (posts.length < MAX_POSTS) {
  const seen = new Set(posts.map((p) => p.id));
  for (const q of QUERIES) {
    const data = await tikhub('fetch_search_timeline', { keyword: q, search_type: 'Top' });
    for (const t of data?.timeline ?? []) {
      if (!t.tweet_id || seen.has(t.tweet_id) || !/[\u4e00-\u9fff]/.test(t.text ?? '')) continue;
      seen.add(t.tweet_id);
      posts.push({
        id: t.tweet_id,
        author: t.screen_name ?? t.author?.screen_name,
        replies: t.replies,
        text: (t.text ?? '').slice(0, 60),
      });
    }
    console.log(`search "${q}" → 累计 ${posts.length} 帖`);
  }
  const hot = await fetch('https://api.feedsieve.win/v1/hot')
    .then((r) => r.json())
    .catch(() => ({ posts: [] }));
  for (const p of hot.posts ?? []) {
    if (p.lang === 'zh' && !seen.has(p.postId))
      posts.push({
        id: p.postId,
        author: p.handle,
        replies: p.replies,
        text: (p.snippet ?? '').slice(0, 60),
      });
  }
  posts.sort((a, b) => (b.replies ?? 0) - (a.replies ?? 0));
  writeFileSync(postsFile, JSON.stringify(posts, null, 2));
}
posts = posts.slice(0, MAX_POSTS);

const candFile = join(CACHE, '_candidates.json');
const candidates = existsSync(candFile) ? JSON.parse(readFileSync(candFile, 'utf8')) : {};
for (const post of posts) {
  if (Object.values(candidates).some((c) => c.posts.includes(post.id))) continue;
  const data = await tikhub('fetch_post_comments', { tweet_id: post.id });
  const list = data?.thread ?? data?.timeline ?? [];
  for (const c of Array.isArray(list) ? list : []) {
    const handle = c.author?.screen_name;
    if (!handle || handle.toLowerCase() === post.author?.toLowerCase()) continue;
    const key = handle.toLowerCase();
    candidates[key] ??= { handle, posts: [], blue: c.author?.blue_verified ?? null };
    if (!candidates[key].posts.includes(post.id)) candidates[key].posts.push(post.id);
  }
  writeFileSync(candFile, JSON.stringify(candidates, null, 2));
  console.log(
    `comments ${post.id} (${post.replies} 回复) → 候选 ${Object.keys(candidates).length}`,
  );
}

// 优先拉出现在多个热帖下的账号（AI 号往往到处刷）；其余随机补足
const labeled = new Set(
  readFileSync(join(ROOT, 'scripts/eval-ai-accounts.labels.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l).handle.toLowerCase()),
);
const pool = Object.values(candidates).filter((c) => !labeled.has(c.handle.toLowerCase()));
const multi = pool
  .filter((c) => c.posts.length >= 2)
  .sort((a, b) => b.posts.length - a.posts.length);
const single = pool.filter((c) => c.posts.length < 2).sort(() => Math.random() - 0.5);
const picked = [...multi, ...single].slice(0, MAX_ACCOUNTS);

let fetched = 0;
const queue = [...picked];
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const c = queue.shift();
      const file = join(CACHE, `${c.handle.toLowerCase()}.json`);
      if (existsSync(file)) continue;
      const data = await tikhub('fetch_user_tweet_replies', { screen_name: c.handle });
      if (data) {
        writeFileSync(file, JSON.stringify(data));
        fetched += 1;
      }
    }
  }),
);
writeFileSync(
  join(CACHE, '_picked.json'),
  JSON.stringify(
    picked.map((c) => ({ handle: c.handle, posts: c.posts.length, blue: c.blue })),
    null,
    2,
  ),
);
console.log(
  `帖子 ${posts.length}，候选 ${pool.length}（多帖出现 ${multi.length}），本次新拉回复 ${fetched}，入选 ${picked.length}`,
);
