#!/usr/bin/env node
/**
 * AI 号账号级判定评测：TikHub 拉账号最近回复 → 配对原帖 → Jev 一次判定（每个账号只调用一次）。
 *
 * 密钥从 apps/community-api/.dev.vars 读取（TIKHUB_API_KEY、TYPESAFE_API_KEY），不进仓库。
 * TikHub 原始响应缓存在 /tmp/feedsieve-ai-eval/，重复跑不重复计费。
 *
 *   node scripts/eval-ai-accounts.mjs                       # 跑标注集，输出命中/误伤与阈值扫描
 *   node scripts/eval-ai-accounts.mjs --handles a,b,c       # 只判指定账号
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = '/tmp/feedsieve-ai-eval';
const LABELS = join(ROOT, 'scripts/eval-ai-accounts.labels.jsonl');
const MAX_REPLIES = 10;
const MIN_REPLIES = 6;
/** 和服务端一致：最多读 20 条（两批），同一个原帖作者最多 2 条 */
const MAX_UPLOAD = 20;
const MAX_PER_PARENT_AUTHOR = 2;
const RESULTS = join(CACHE, 'results.json');
const JEV_PRICE_PER_M = 0.042;

function devVar(name) {
  const text = readFileSync(join(ROOT, 'apps/community-api/.dev.vars'), 'utf8');
  const value = text
    .match(new RegExp(`^${name}=(.+)$`, 'm'))?.[1]
    ?.trim()
    .replace(/^["']|["']$/g, '');
  if (!value) throw new Error(`${name} missing in apps/community-api/.dev.vars`);
  return value;
}

/** 判定问题的唯一来源：服务端 apps/community-api/src/ai-accounts/question.json。 */
const QUESTION_FILE = JSON.parse(
  readFileSync(join(ROOT, 'apps/community-api/src/ai-accounts/question.json'), 'utf8'),
);
export const AI_ACCOUNT_QUESTION = QUESTION_FILE.questions;

/** 回复间隔（秒，按时间先后，最多 15 个）。 */
export function replyGaps(handle, data) {
  const at = data.timeline
    .filter(
      (t) =>
        t.author?.screen_name?.toLowerCase() === handle.toLowerCase() &&
        t.in_reply_to_status_id_str,
    )
    .map((t) => Date.parse(t.created_at))
    .sort((a, b) => a - b);
  return at
    .slice(1)
    .map((x, i) => Math.round((x - at[i]) / 1000))
    .slice(-15);
}

/** 本地节奏（零成本）：≤90 秒间隔占比、≤6 字短回复占比、长度变异系数。 */
export function rhythm(handle, data) {
  const gaps = replyGaps(handle, data);
  const lens = data.timeline
    .filter(
      (t) =>
        t.author?.screen_name?.toLowerCase() === handle.toLowerCase() &&
        t.in_reply_to_status_id_str,
    )
    .map(
      (t) =>
        [
          ...t.text
            .replace(/^(@\w+\s+)+/, '')
            .replace(/https:\/\/t\.co\/\S+/g, '')
            .trim(),
        ].length,
    );
  const mean = lens.reduce((s, v) => s + v, 0) / Math.max(lens.length, 1);
  const sd = Math.sqrt(lens.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(lens.length, 1));
  return {
    fast: gaps.filter((g) => g <= 90).length / Math.max(gaps.length, 1),
    short: lens.filter((v) => v <= 6).length / Math.max(lens.length, 1),
    cv: mean ? sd / mean : 0,
  };
}

/** 判定（和服务端 evidence.ts 一致）：Jev ≥ 0.55；或 Jev ≥ 0.45 且节奏机械（多数间隔 ≤90 秒、几乎没有短回复、长度均匀）。 */
export const DECISION = {
  strong: 0.55,
  weak: 0.45,
  suspect: 0.4,
  fast: 0.6,
  maxShort: 0.05,
  maxCv: 0.45,
};
export function decide(p, r) {
  if (p >= DECISION.strong) return 'ai';
  if (
    p >= DECISION.weak &&
    r.fast >= DECISION.fast &&
    r.short <= DECISION.maxShort &&
    r.cv <= DECISION.maxCv
  )
    return 'ai';
  return p >= DECISION.suspect ? 'suspect' : 'human';
}

async function fetchReplies(handle, tikhubKey) {
  mkdirSync(CACHE, { recursive: true });
  const file = join(CACHE, `${handle.toLowerCase()}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const url = new URL('https://api.tikhub.io/api/v1/twitter/web/fetch_user_tweet_replies');
  url.searchParams.set('screen_name', handle);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${tikhubKey}` } });
  const json = await res.json();
  if (!res.ok || !json.data) throw new Error(`tikhub ${res.status} ${json.message ?? ''}`);
  writeFileSync(file, JSON.stringify(json.data));
  return json.data;
}

const cut = (s, n) =>
  [...s.replace(/https:\/\/t\.co\/\S+/g, '').trim()].slice(0, n).join('').toWellFormed();

/**
 * 取该账号自己的回复并配对原帖（和服务端 / 扩展采集同一口径）：同一原帖只取一条，
 * 同一个原帖作者最多 2 条，最多 20 条（前 10 条是第一批，后 10 条是灰色地带的第二批）。
 */
export function buildReplies(handle, data) {
  const byId = new Map(data.timeline.map((t) => [t.tweet_id, t]));
  const seenParents = new Set();
  const perAuthor = new Map();
  const out = [];
  for (const t of data.timeline) {
    if (t.author?.screen_name?.toLowerCase() !== handle.toLowerCase()) continue;
    const parentId = t.in_reply_to_status_id_str;
    if (!parentId || seenParents.has(parentId)) continue;
    const parent = byId.get(parentId);
    const parentAuthor = (
      t.in_reply_to_screen_name ??
      parent?.author?.screen_name ??
      ''
    ).toLowerCase();
    if (parentAuthor === handle.toLowerCase()) continue;
    if (parentAuthor && (perAuthor.get(parentAuthor) ?? 0) >= MAX_PER_PARENT_AUTHOR) continue;
    const text = t.text.replace(/^(@\w+\s+)+/, '').trim();
    if (!text) continue;
    seenParents.add(parentId);
    if (parentAuthor) perAuthor.set(parentAuthor, (perAuthor.get(parentAuthor) ?? 0) + 1);
    out.push({ parent: parent ? cut(parent.text, 80) : null, text: cut(text, 200) });
    if (out.length >= MAX_UPLOAD) break;
  }
  return out;
}

async function judge(replies, gaps, typesafeKey) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch('https://api.typesafe.ai/v1/systemone', {
      method: 'POST',
      headers: { Authorization: `Bearer ${typesafeKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'jev-latest',
        state: { replies, reply_gaps_seconds: gaps },
        questions: AI_ACCOUNT_QUESTION,
      }),
    });
    const json = await res.json();
    if (res.ok && json.answers) {
      return {
        p: json.answers.ai_account.noul,
        tokens: json.usage?.input_tokens ?? 0,
        model: json.model,
      };
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      continue;
    }
    throw new Error(`jev ${res.status} ${JSON.stringify(json).slice(0, 200)}`);
  }
}

async function main() {
  const tikhubKey = devVar('TIKHUB_API_KEY');
  const typesafeKey = devVar('TYPESAFE_API_KEY');
  const arg = process.argv.indexOf('--handles');
  const items =
    arg > 0
      ? process.argv[arg + 1].split(',').map((handle) => ({ handle, label: null }))
      : readFileSync(LABELS, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line));

  const rows = [];
  let tokens = 0;
  for (const item of items) {
    try {
      const data = await fetchReplies(item.handle, tikhubKey);
      const all = buildReplies(item.handle, data);
      const replies = all.slice(0, MAX_REPLIES);
      if (replies.length < MIN_REPLIES) {
        console.log(`${item.handle.padEnd(18)} 证据不足（${replies.length} 条）`);
        continue;
      }
      const result = await judge(replies, replyGaps(item.handle, data), typesafeKey);
      tokens += result.tokens;
      // 灰色地带（疑似线到强线之间）且第二批够数：再判一次取平均，和服务端 judge.ts 一致
      const second = all.slice(MAX_REPLIES);
      let p2 = null;
      if (
        result.p >= DECISION.suspect &&
        result.p < DECISION.strong &&
        second.length >= MIN_REPLIES
      ) {
        const again = await judge(second, [], typesafeKey);
        tokens += again.tokens;
        p2 = again.p;
      }
      const r = rhythm(item.handle, data);
      const p = p2 === null ? result.p : (result.p + p2) / 2;
      const verdict = decide(p, r);
      rows.push({ ...item, p1: result.p, p2, p, rhythm: r, verdict });
      if (arg > 0 || (item.label === 'ai') !== (verdict === 'ai')) {
        console.log(
          `${item.handle.padEnd(18)} ${String(item.label ?? '-').padEnd(5)} p=${result.p.toFixed(2)} → ${verdict}`,
        );
      }
    } catch (error) {
      console.log(`${item.handle.padEnd(18)} 失败：${error.message}`);
    }
  }

  const ai = rows.filter((r) => r.label === 'ai');
  const human = rows.filter((r) => r.label === 'human');
  if (ai.length && human.length) {
    const hit = ai.filter((r) => r.verdict === 'ai').length;
    const fp = human.filter((r) => r.verdict === 'ai').length;
    const suspect = human.filter((r) => r.verdict === 'suspect').length;
    console.log(
      `\n判定规则：AI 号命中 ${hit}/${ai.length}，真人误判为 AI 号 ${fp}/${human.length}，真人落入疑似 ${suspect}/${human.length}`,
    );
  }
  console.log(`\nJev 输入 ${tokens} tokens ≈ $${((tokens * JEV_PRICE_PER_M) / 1e6).toFixed(4)}`);
  if (arg < 0) {
    writeFileSync(RESULTS, JSON.stringify(rows, null, 2));
    console.log(
      `结果写入 ${RESULTS}（node scripts/eval-ai-accounts.mjs --sweep 离线扫阈值，不再计费）`,
    );
  }
}

/** 离线扫阈值：在已保存的分数上试各组 strong / weak / suspect，按「误判真人为 AI ≤ 上限」挑命中最高的。 */
export function sweep(rows, maxFpRate = 0.03) {
  const ai = rows.filter((r) => r.label === 'ai');
  const human = rows.filter((r) => r.label === 'human');
  const results = [];
  for (let strong = 0.5; strong <= 0.9001; strong += 0.05) {
    for (let weak = 0.4; weak <= strong + 1e-9; weak += 0.05) {
      for (let suspect = 0.3; suspect <= weak + 1e-9; suspect += 0.05) {
        const verdictOf = (row) => {
          if (row.p >= strong) return 'ai';
          const m =
            row.rhythm.fast >= DECISION.fast &&
            row.rhythm.short <= DECISION.maxShort &&
            row.rhythm.cv <= DECISION.maxCv;
          if (row.p >= weak && m) return 'ai';
          return row.p >= suspect ? 'suspect' : 'human';
        };
        const hit = ai.filter((r) => verdictOf(r) === 'ai').length;
        const fp = human.filter((r) => verdictOf(r) === 'ai').length;
        const humanSuspect = human.filter((r) => verdictOf(r) === 'suspect').length;
        const aiMissed = ai.filter((r) => verdictOf(r) === 'human').length;
        results.push({
          strong: +strong.toFixed(2),
          weak: +weak.toFixed(2),
          suspect: +suspect.toFixed(2),
          recall: hit / Math.max(ai.length, 1),
          fpRate: fp / Math.max(human.length, 1),
          humanSuspect: humanSuspect / Math.max(human.length, 1),
          aiMissed: aiMissed / Math.max(ai.length, 1),
        });
      }
    }
  }
  return results
    .filter((r) => r.fpRate <= maxFpRate)
    .sort(
      (a, b) =>
        b.recall - a.recall ||
        a.humanSuspect - b.humanSuspect ||
        a.aiMissed - b.aiMissed ||
        b.strong - a.strong,
    );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes('--sweep')) {
    const rows = JSON.parse(readFileSync(RESULTS, 'utf8'));
    const ai = rows.filter((r) => r.label === 'ai').length;
    const human = rows.filter((r) => r.label === 'human').length;
    console.log(`样本：AI 号 ${ai}，真人 ${human}`);
    for (const r of sweep(rows).slice(0, 10)) console.log(JSON.stringify(r));
  } else {
    await main();
  }
}
