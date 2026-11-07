#!/usr/bin/env node
/**
 * 回填 AI 号广场的回复样本（ai_account_samples）。
 *
 * 给本批上线前已存在、但还没有样本的 ai / suspect 账号补正文：从 ai_account_verdicts.reply_ids
 * 逐条拉 X 公开的 syndication 端点（无需 key），串行 + 每条间隔 ≥300ms，单条失败跳过、不阻塞。
 *
 * - 只写 source='backfill' 的行；已经有样本的账号整体跳过（判定时落库的样本更准）。
 * - 每条 handle 最多回填 20 条，与落库口径一致；正文按码点截到 200、去 t.co 与开头 @、去 NUL。
 * - 该脚本只在维护者本机手动跑一次，不进定时任务。
 *
 * 用法：
 *   node scripts/backfill-ai-samples.mjs --dry-run   # 照常拉取，只打印将写入的条数
 *   node scripts/backfill-ai-samples.mjs
 *   DATABASE_URL=postgres://… node scripts/backfill-ai-samples.mjs
 *
 * 依赖本机 psql（与 seed-ai-square.mjs 一致）；DATABASE_URL 默认本地 docker-compose 的 feedsieve 库。
 */
import { execFileSync } from 'node:child_process';

const DB_URL =
  process.env.DATABASE_URL ??
  'postgres://feedsieve:feedsieve_dev_password@127.0.0.1:54330/feedsieve';
const DRY = process.argv.includes('--dry-run');
const SYNDICATION = 'https://cdn.syndication.twimg.com/tweet-result';
const TWITTER_EPOCH = 1288834974657n;
/** 每条 handle 最多回填 20 条（与 MAX_SAMPLES_PER_HANDLE / 判定落库口径一致） */
const MAX_SAMPLES = 20;
/** 串行限速：两条请求之间至少间隔这么多毫秒 */
const MIN_INTERVAL_MS = 300;
const MAX_TEXT = 200;
const POST_ID = /^\d{1,25}$/;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function sqlString(value) {
  if (value == null) return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlNumber(value) {
  return value == null || !Number.isFinite(Number(value)) ? 'NULL' : String(Number(value));
}

/** 按码点截断并去掉 NUL（PG 的 text 不接受 U+0000）。 */
function cutText(value, max) {
  return [...value].slice(0, max).join('').replaceAll('\u0000', '').trim();
}

/** snowflake → Unix 秒；解析不出返回 null。 */
function snowflakeSeconds(id) {
  try {
    const ms = Number((BigInt(id) >> 22n) + TWITTER_EPOCH);
    return ms > Number(TWITTER_EPOCH) ? Math.floor(ms / 1000) : null;
  } catch {
    return null;
  }
}

/** 回复正文去掉开头的 @ 和 t.co 短链（与判定链路口径一致）。 */
function stripReplyNoise(text) {
  return text
    .replace(/^(@\w+\s+)+/, '')
    .replace(/https:\/\/t\.co\/\S+/g, '')
    .trim();
}

/**
 * 读需要回填的账号：ai / suspect、有 reply_ids、且一条样本都没有。
 * reply_ids 是判定时写下的 JSON 数组（形如 ["123","456"]，无换行/制表符），直接按行解析。
 */
function readAccounts() {
  const query = `select v.handle, v.reply_ids
from ai_account_verdicts v
where v.verdict in ('ai', 'suspect')
  and v.reply_ids is not null
  and not exists (select 1 from ai_account_samples s where s.handle = v.handle)
order by v.handle`;
  const output = execFileSync(
    'psql',
    ['-X', '-q', '-t', '-A', '-F', '\t', '-d', DB_URL, '-c', query],
    { encoding: 'utf8' },
  );
  const accounts = [];
  for (const line of output.split('\n')) {
    if (!line.trim()) continue;
    const [handle, ...rest] = line.split('\t');
    let ids;
    try {
      const parsed = JSON.parse(rest.join('\t'));
      ids = Array.isArray(parsed)
        ? [...new Set(parsed.filter((id) => typeof id === 'string' && POST_ID.test(id)))].slice(
            0,
            MAX_SAMPLES,
          )
        : [];
    } catch {
      console.warn(`  ! ${handle} 的 reply_ids 不是合法 JSON，跳过`);
      ids = [];
    }
    if (handle && ids.length) accounts.push({ handle, replyIds: ids });
  }
  return accounts;
}

/** 拉一条推文的 syndication 结果；删除 / 保护 / 不存在的推文返回 null。 */
async function fetchTweet(id) {
  const url = `${SYNDICATION}?id=${encodeURIComponent(id)}&lang=zh&token=a`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  // 不存在的推文返回的是 HTML 兜底页（JSON.parse 失败）或 TweetTombstone
  if (!data || typeof data.text !== 'string') return null;
  return data;
}

/** 把一条 syndication 结果整理成样本字段；正文空了（纯图片 / 纯链接）返回 null。 */
function sampleFromTweet(id, data) {
  const text = cutText(stripReplyNoise(data.text), MAX_TEXT);
  if (!text) return null;
  const createdMs = Date.parse(data.created_at);
  const postedAt = Number.isFinite(createdMs)
    ? Math.floor(createdMs / 1000)
    : snowflakeSeconds(id);
  const parentId =
    typeof data.in_reply_to_status_id_str === 'string' &&
    POST_ID.test(data.in_reply_to_status_id_str)
      ? data.in_reply_to_status_id_str
      : null;
  return { tweetId: id, parentId, text, postedAt, gapSeconds: null };
}

async function main() {
  const accounts = readAccounts();
  console.log(`待回填账号：${accounts.length} 个（已有样本或非 ai / suspect 的已跳过）`);
  if (!accounts.length) return;

  const nowS = Math.floor(Date.now() / 1000);
  const statements = [];
  let requests = 0;
  let failed = 0;
  let total = 0;

  for (const account of accounts) {
    const rows = [];
    for (const id of account.replyIds) {
      // 串行限速：第一条直接拉，之后的每条与上一条至少隔 MIN_INTERVAL_MS
      if (requests > 0) await sleep(MIN_INTERVAL_MS);
      requests += 1;
      const data = await fetchTweet(id).catch(() => null);
      if (!data) {
        failed += 1;
        continue;
      }
      const sample = sampleFromTweet(id, data);
      if (!sample) {
        failed += 1;
        continue;
      }
      rows.push(sample);
    }
    if (!rows.length) {
      console.log(`  - ${account.handle}：没有拉到可用正文，跳过`);
      continue;
    }
    // 间隔是「与上一条回复」的差：按时间升序配对，第一条没有间隔
    const timed = rows
      .filter((row) => row.postedAt != null)
      .sort((a, b) => a.postedAt - b.postedAt);
    for (let i = 1; i < timed.length; i += 1) {
      timed[i].gapSeconds = Math.max(0, timed[i].postedAt - timed[i - 1].postedAt);
    }
    // 多行 INSERT 先按主键排序；同一批里的重复 tweet 在拉取阶段已去重
    rows.sort((a, b) => (a.tweetId < b.tweetId ? -1 : a.tweetId > b.tweetId ? 1 : 0));
    total += rows.length;
    console.log(`  ✓ ${account.handle}：将写入 ${rows.length} 条`);
    if (DRY) continue;
    const values = rows
      .map(
        (row) =>
          `(${[
            sqlString(account.handle),
            sqlString(row.tweetId),
            sqlString(row.parentId),
            sqlString(row.text),
            'NULL',
            sqlNumber(row.postedAt),
            sqlNumber(row.gapSeconds),
            sqlString('backfill'),
            sqlNumber(nowS),
          ].join(', ')})`,
      )
      .join(', ');
    statements.push(
      `INSERT INTO ai_account_samples (handle, tweet_id, parent_id, text, parent_text, posted_at, gap_seconds, source, created_at) VALUES ${values} ON CONFLICT (handle, tweet_id) DO NOTHING;`,
    );
  }

  console.log(`\n共拉取 ${requests} 条推文，不可用 ${failed} 条`);
  if (DRY) {
    console.log(`--dry-run：将写入 ${total} 条样本（不落库）`);
    return;
  }
  if (!statements.length) {
    console.log('没有可写入的样本');
    return;
  }
  const script = ['BEGIN;', ...statements, 'COMMIT;'].join('\n');
  execFileSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', DB_URL, '-f', '-'], {
    input: script,
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  console.log(`已写入 ${total} 条样本（source='backfill'）`);
}

main().catch((error) => {
  console.error('回填失败：', error.message);
  process.exit(1);
});
