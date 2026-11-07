#!/usr/bin/env node
/**
 * 本地开发种子：把线上可公示的 AI 号名单灌进本地 PostgreSQL，给 /ai 广场做预览数据。
 *
 * 数据来源：
 * - 判定结论 / 节奏指标 / 票数：feedsieve.win 的公开接口（GET /v1/ai-accounts/list、/v1/ai-accounts/:handle）
 * - 主页画像：线上没有，按分数档位合成（joined_at / followers 等）
 * - 回复样本：线上不返回正文，用「AI 味」模板合成，source='seed' 标明不是真实采集
 *
 * 只写本地库，绝不连线上。用法：
 *   node scripts/seed-ai-square.mjs
 *   node scripts/seed-ai-square.mjs --dry-run
 *   DATABASE_URL=postgres://... node scripts/seed-ai-square.mjs
 */
import { execFileSync } from 'node:child_process';

const DB_URL =
  process.env.DATABASE_URL ?? 'postgres://feedsieve:feedsieve_dev_password@127.0.0.1:54330/feedsieve';
const API = 'https://feedsieve.win';
const DRY = process.argv.includes('--dry-run');
const TWITTER_EPOCH = 1288834974657n;

/** 本地预览用的合成回复：模拟中文 AI 号那种工整、带口头禅、无信息量的回复 */
const TEMPLATES = [
  ['说实话，这个观点很有意思——但落地场景还是要看团队执行力。', '普通人怎么用 AI 做副业？'],
  ['确实，关键不是工具而是工作流。先把日常重复的事交给模型。', 'AI 工具到底能帮我做什么'],
  ['哈哈，这个我也有同感，效率提升其实来自「少做无用功」。', '你们每天用 AI 干什么'],
  ['认同。真正的壁垒是数据质量和反馈闭环，不是提示词。', '提示词工程还有意义吗'],
  ['这波确实值得关注——先想清楚目标，再谈是不是用 AI。', '不会写代码能做产品吗'],
  ['绷不住了，太真实。先把一个场景跑通，比别人早一步就够。', '为什么大部分人做不起来'],
  ['总结得很到位。工具会变，判断力不会。', 'AI 时代什么能力最值钱'],
  ['说到底还是那句话：先跑起来，再优化。', '从零开始做内容账号'],
  ['有一说一，这套流程我也在跑，省下来的时间才是价值。', '如何提高每天产出'],
  ['同意，别为了用而用——需求没到那儿，模型再好也帮不上。', 'AI 会取代设计师吗'],
];

function sqlString(value) {
  if (value == null) return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlNumber(value) {
  return value == null || !Number.isFinite(Number(value)) ? 'NULL' : String(Number(value));
}

/** snowflake：毫秒时间戳左移 22，再把序列号塞进低位 */
function snowflake(ms, seq) {
  return ((BigInt(ms) - TWITTER_EPOCH) << 22n) | BigInt(seq & 0x3fffff);
}

function hashOf(text) {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.codePointAt(0)) % 1_000_003;
  return h;
}

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

async function main() {
  const list = await fetchJson(`${API}/v1/ai-accounts/list`);
  const handles = (list.entries ?? []).map((row) => row[0]);
  console.log(`线上可公示账号：${handles.length} 个`);

  const nowMs = Date.now();
  const nowS = Math.floor(nowMs / 1000);
  const statements = [];

  for (const [index, handle] of handles.entries()) {
    const value = await fetchJson(`${API}/v1/ai-accounts/${encodeURIComponent(handle)}`);
    if (value.public !== true) {
      console.log(`  跳过 ${handle}：不可公示`);
      continue;
    }
    const verdict = value.verdict === 'suspect' ? 'suspect' : 'ai';
    const rhythm = value.rhythm
      ? {
          fast: value.rhythm.fast,
          short: value.rhythm.short,
          cv: value.rhythm.cv,
          ...(value.rhythm.median_gap != null ? { median_gap: value.rhythm.median_gap } : {}),
          ...(value.rhythm.span != null ? { span: value.rhythm.span } : {}),
          ...(value.rhythm.authors != null ? { authors: value.rhythm.authors } : {}),
          ...(value.rhythm.rounds != null ? { rounds: value.rhythm.rounds } : {}),
        }
      : null;
    const judgedAt = value.judged_at ?? nowS;
    const expiresAt = value.expires_at ?? nowS + 7 * 86400;

    statements.push(
      `INSERT INTO ai_account_verdicts (handle, verdict, score, blue_verified, reply_count, rhythm, model, question_version, judged_at, expires_at, submitter, confirmed, display_name, avatar_url) VALUES (` +
        [
          sqlString(handle),
          sqlString(verdict),
          sqlNumber(value.score),
          'NULL',
          sqlNumber(value.reply_count ?? 0),
          rhythm ? sqlString(JSON.stringify(rhythm)) : 'NULL',
          sqlString('seed'),
          '5',
          sqlNumber(judgedAt),
          sqlNumber(expiresAt),
          'NULL',
          '1',
          sqlString(handle),
          'NULL',
        ].join(', ') +
        `) ON CONFLICT (handle) DO UPDATE SET verdict = excluded.verdict, score = excluded.score, reply_count = excluded.reply_count, rhythm = excluded.rhythm, judged_at = excluded.judged_at, expires_at = excluded.expires_at, confirmed = 1;`,
    );

    // 票数：每个 ai 票一条安装记录（human 票同理），让 tallyVotes / 广场 where 走真实路径
    const aiCount = value.votes?.ai_count ?? 0;
    const humanCount = value.votes?.human_count ?? 0;
    statements.push(`DELETE FROM ai_account_votes WHERE handle = ${sqlString(handle)};`);
    for (let i = 0; i < aiCount; i += 1) {
      statements.push(
        `INSERT INTO ai_account_votes (handle, installation_id, vote, created_at, updated_at) VALUES (${sqlString(
          handle,
        )}, ${sqlString(`seed-${handle}-ai-${i}`)}, 'ai', ${sqlNumber(nowS)}, ${sqlNumber(nowS)}) ON CONFLICT DO NOTHING;`,
      );
    }
    for (let i = 0; i < humanCount; i += 1) {
      statements.push(
        `INSERT INTO ai_account_votes (handle, installation_id, vote, created_at, updated_at) VALUES (${sqlString(
          handle,
        )}, ${sqlString(`seed-${handle}-human-${i}`)}, 'human', ${sqlNumber(nowS)}, ${sqlNumber(nowS)}) ON CONFLICT DO NOTHING;`,
      );
    }

    // 主页画像：按分数档位合成（只影响本地观感，真实数据要等主页采集）
    const score = value.score ?? 0.5;
    const followers = Math.round(800 + score * score * 120000 + (hashOf(handle) % 9000));
    const tweets = Math.round(1200 + score * 40000);
    const joinedAt = nowMs - (180 + (hashOf(handle) % 1400)) * 86400 * 1000;
    statements.push(
      `INSERT INTO profile_accounts (handle, display_name, avatar_url, verified, followers, following_count, tweets, joined_at, updated_at) VALUES (` +
        [
          sqlString(handle),
          sqlString(handle),
          'NULL',
          '0',
          sqlNumber(followers),
          sqlNumber(Math.round(200 + score * 3000)),
          sqlNumber(tweets),
          sqlNumber(joinedAt),
          sqlNumber(nowMs),
        ].join(', ') +
        `) ON CONFLICT (handle) DO UPDATE SET followers = excluded.followers, following_count = excluded.following_count, tweets = excluded.tweets, joined_at = excluded.joined_at, updated_at = excluded.updated_at;`,
    );

    // 回复样本：合成 3–5 条，时间倒序；间隔沿用判定的 median_gap，让「节奏」看得懂
    const sampleCount = 3 + (hashOf(handle) % 3);
    const medianGap = value.rhythm?.median_gap ?? 60 + (hashOf(handle) % 600);
    statements.push(`DELETE FROM ai_account_samples WHERE handle = ${sqlString(handle)};`);
    for (let i = 0; i < sampleCount; i += 1) {
      const [text, parent] = TEMPLATES[(hashOf(handle) + i) % TEMPLATES.length];
      const postedMs = nowMs - (i * (medianGap + 60) + 300) * 1000;
      const tweetId = snowflake(postedMs, i + index * 7).toString();
      statements.push(
        `INSERT INTO ai_account_samples (handle, tweet_id, parent_id, text, parent_text, posted_at, gap_seconds, source, created_at) VALUES (` +
          [
            sqlString(handle),
            sqlString(tweetId),
            'NULL',
            sqlString(text),
            sqlString(parent),
            sqlNumber(Math.floor(postedMs / 1000)),
            sqlNumber(medianGap),
            sqlString('seed'),
            sqlNumber(Math.floor(postedMs / 1000)),
          ].join(', ') +
          `) ON CONFLICT (handle, tweet_id) DO NOTHING;`,
      );
    }
    console.log(`  ✓ ${handle}（${verdict} ${value.score ?? '无分'}，${aiCount} 票，${sampleCount} 条样本）`);
  }

  const script = ['BEGIN;', ...statements, 'COMMIT;'].join('\n');
  if (DRY) {
    console.log(`\n--dry-run：将执行 ${statements.length} 条语句（不落库）`);
    return;
  }
  execFileSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', DB_URL, '-f', '-'], {
    input: script,
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  console.log(`\n已写入本地库：${statements.length} 条语句`);
}

main().catch((error) => {
  console.error('种子失败：', error.message);
  process.exit(1);
});
