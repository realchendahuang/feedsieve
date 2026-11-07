/**
 * AI 号广场（/ai）：把「可以公示的 AI / 疑似 AI 账号」聚合起来给访客看。
 *
 * 可公示口径与 `lookup.ts` 的 listAiAccounts 完全同源 —— 这里抄的是同一段 where：
 *   1. 真人票 ≥ 3 且不落后 → 社区认为真人 / 争议，不进广场；
 *   2. Jev 判 ai / suspect 且未过期且被第二个独立安装印证（confirmed=1）；或
 *   3. 社区「是 AI」票 ≥ 3 且领先。
 * 不再另立阈值：广场只做聚合，把主页画像、互动指标、最近回复样本拼上去。
 *
 * 数据来源：ai_account_verdicts（判定）/ ai_account_votes（票）/ profile_accounts（画像）
 * / ai_account_samples（回复样本，由 judge 落库与回填脚本写入）。
 */
import { sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import { parseRhythm } from './check';
import { AI_LIST_MIN_VOTES } from './vote';

const HANDLE = /^[a-z0-9_]{1,15}$/;
/** 列表卡片带最近 3 条，详情页带 12 条 */
const LIST_SAMPLES = 3;
const DETAIL_SAMPLES = 12;
/** 页面展示的正文长度（库里的样本最多 200 码点，见 evidence.MAX_REPLY_CHARS） */
const VIEW_TEXT_CHARS = 120;

export type SquareKind = 'ai' | 'suspect';

export interface AiSampleView {
  tweetId: string;
  /** 已截断到 120 码点 */
  text: string;
  parentText: string | null;
  /** Unix 秒 */
  postedAt: number | null;
  gapSeconds: number | null;
  url: string;
}

export interface AiSquareEntry {
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
  kind: SquareKind;
  /** 0–1；社区投票入名单但没有 Jev 分时为 null */
  score: number | null;
  listed: boolean;
  votes: { ai_count: number; human_count: number };
  rhythm: {
    fast: number;
    short: number;
    cv: number;
    medianGap: number | null;
    span: number | null;
    authors: number | null;
    rounds: number | null;
  } | null;
  replyCount: number;
  blueVerified: boolean | null;
  /** Unix 秒 */
  judgedAt: number | null;
  /** Unix 秒 */
  expiresAt: number | null;
  /** 没采过主页就是 null —— 页面必须隐藏，不能显示 0 */
  profile: {
    followers: number | null;
    following: number | null;
    tweets: number | null;
    /** 毫秒（沿用 profile_accounts.joined_at 既有约定） */
    joinedAt: number | null;
    verified: boolean | null;
  } | null;
  /** 最近 N 条，按时间倒序；没有就是空数组 */
  samples: AiSampleView[];
}

export interface AiSquareCounts {
  all: number;
  ai: number;
  suspect: number;
  listed: number;
}

export interface AiSquareData {
  /** Unix 秒 */
  generatedAt: number;
  counts: AiSquareCounts;
  entries: AiSquareEntry[];
}

type PublicRow = {
  handle: string;
  verdict: string | null;
  score: number | null;
  display_name: string | null;
  avatar_url: string | null;
  reply_count: number | null;
  rhythm: string | null;
  blue_verified: number | null;
  judged_at: number | null;
  expires_at: number | null;
  ai_count: number | string | null;
  human_count: number | string | null;
  listed: boolean;
  followers: number | string | null;
  following_count: number | string | null;
  tweets: number | string | null;
  joined_at: number | string | null;
  verified: number | null;
};

type SampleRow = {
  handle: string;
  tweet_id: string;
  parent_text: string | null;
  text: string;
  posted_at: number | string | null;
  gap_seconds: number | string | null;
};

/** postgres.js 的 bigint 可能回字符串，统一转成 number；NULL 保持 null */
function num(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** 按码点截断，去掉截断产生的孤立代理项 */
export function cutChars(value: string, max = VIEW_TEXT_CHARS): string {
  const chars = [...value];
  if (chars.length <= max) return value;
  return chars
    .slice(0, max)
    .join('')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD');
}

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const wrapped = result as { rows?: T[] } | null;
  return Array.isArray(wrapped?.rows) ? wrapped.rows : [];
}

/**
 * 取可公示账号的行（不取样本）。handles 给定时只查这些账号（详情页用）。
 * where 与 lookup.listAiAccounts 必须保持一致 —— 改一边就要改另一边。
 */
async function loadPublicRows(
  env: Cloudflare.Env,
  nowS: number,
  handles?: readonly string[],
): Promise<PublicRow[]> {
  const db = getDb(env);
  const handleFilter =
    handles && handles.length
      ? sql` and coalesce(v.handle, t.handle) in (${sql.join(
          handles.map((h) => sql`${h}`),
          sql`, `,
        )})`
      : sql``;
  const result = await db.execute<PublicRow>(sql`
    with t as (
      select handle,
             count(*) filter (where vote = 'ai') as ai,
             count(*) filter (where vote = 'human') as human
      from ai_account_votes
      group by handle
    )
    select coalesce(v.handle, t.handle) as handle,
           case when v.verdict in ('ai', 'suspect') and v.expires_at > ${nowS}
                then v.verdict end as verdict,
           case when v.verdict in ('ai', 'suspect') and v.expires_at > ${nowS}
                then v.score end as score,
           v.display_name,
           v.avatar_url,
           v.reply_count,
           v.rhythm,
           v.blue_verified,
           v.judged_at,
           v.expires_at,
           coalesce(t.ai, 0) as ai_count,
           coalesce(t.human, 0) as human_count,
           coalesce(t.ai, 0) >= ${AI_LIST_MIN_VOTES} and coalesce(t.ai, 0) > coalesce(t.human, 0) as listed,
           p.followers,
           p.following_count,
           p.tweets,
           p.joined_at,
           p.verified
    from ai_account_verdicts v
    full outer join t on t.handle = v.handle
    left join profile_accounts p on p.handle = coalesce(v.handle, t.handle)
    where
      -- 真人票 ≥ 3 且不落后：社区认为真人（或争议），不进 AI 名单
      not (coalesce(t.human, 0) >= ${AI_LIST_MIN_VOTES} and coalesce(t.human, 0) >= coalesce(t.ai, 0))
      and (
        (v.verdict in ('ai', 'suspect') and v.expires_at > ${nowS} and v.confirmed = 1)
        or (coalesce(t.ai, 0) >= ${AI_LIST_MIN_VOTES} and coalesce(t.ai, 0) > coalesce(t.human, 0))
      )${handleFilter}
    order by coalesce(v.handle, t.handle) collate "C"
  `);
  return rowsOf<PublicRow>(result);
}

/**
 * 取样本：用窗口函数一次拿回所有账号各自的最近 perHandle 条（列表 3 / 详情 12）。
 * 账号量级 < 200，单条 SQL 足够。
 */
async function loadSamples(
  env: Cloudflare.Env,
  handles: readonly string[],
  perHandle: number,
): Promise<Map<string, AiSampleView[]>> {
  const out = new Map<string, AiSampleView[]>();
  if (!handles.length) return out;
  const result = await getDb(env).execute<SampleRow & { rn: number | string }>(sql`
    select handle, tweet_id, parent_text, text, posted_at, gap_seconds
    from (
      select handle, tweet_id, parent_text, text, posted_at, gap_seconds,
             row_number() over (
               partition by handle
               order by coalesce(posted_at, created_at) desc, tweet_id desc
             ) as rn
      from ai_account_samples
      where handle in (${sql.join(
        handles.map((h) => sql`${h}`),
        sql`, `,
      )})
    ) s
    where rn <= ${perHandle}
  `);
  for (const row of rowsOf<SampleRow & { rn: number | string }>(result)) {
    const list = out.get(row.handle) ?? [];
    list.push({
      tweetId: String(row.tweet_id),
      text: cutChars(row.text),
      parentText: row.parent_text,
      postedAt: num(row.posted_at),
      gapSeconds: num(row.gap_seconds),
      url: `https://x.com/${encodeURIComponent(row.handle)}/status/${row.tweet_id}`,
    });
    out.set(row.handle, list);
  }
  return out;
}

function toEntry(row: PublicRow, samples: AiSampleView[]): AiSquareEntry {
  const rhythm = parseRhythm(row.rhythm);
  const hasProfile =
    row.followers != null ||
    row.following_count != null ||
    row.tweets != null ||
    row.joined_at != null;
  return {
    handle: row.handle,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    kind: row.verdict === 'suspect' ? 'suspect' : 'ai',
    score: row.score == null ? null : Number(row.score),
    listed: Boolean(row.listed),
    votes: { ai_count: num(row.ai_count) ?? 0, human_count: num(row.human_count) ?? 0 },
    rhythm: rhythm
      ? {
          fast: rhythm.fast,
          short: rhythm.short,
          cv: rhythm.cv,
          medianGap: num(rhythm.median_gap),
          span: num(rhythm.span),
          authors: num(rhythm.authors),
          rounds: num(rhythm.rounds),
        }
      : null,
    replyCount: num(row.reply_count) ?? 0,
    blueVerified: row.blue_verified == null ? null : row.blue_verified === 1,
    judgedAt: num(row.judged_at),
    expiresAt: num(row.expires_at),
    profile: hasProfile
      ? {
          followers: num(row.followers),
          following: num(row.following_count),
          tweets: num(row.tweets),
          joinedAt: num(row.joined_at),
          verified: row.verified == null ? null : row.verified === 1,
        }
      : null,
    samples,
  };
}

/** listed 优先，其次分数，最后按 handle 稳定排序 */
function compareEntries(a: AiSquareEntry, b: AiSquareEntry): number {
  if (a.listed !== b.listed) return a.listed ? -1 : 1;
  if (a.score !== b.score) {
    if (a.score == null) return 1;
    if (b.score == null) return -1;
    return b.score - a.score;
  }
  return a.handle < b.handle ? -1 : a.handle > b.handle ? 1 : 0;
}

/** 广场列表：一次取全部可公示账号（当前量级 < 200，不分页） */
export async function listAiSquare(
  env: Cloudflare.Env,
  now = Date.now(),
): Promise<AiSquareData> {
  const nowS = Math.floor(now / 1000);
  const rows = await loadPublicRows(env, nowS);
  const samples = await loadSamples(
    env,
    rows.map((r) => r.handle),
    LIST_SAMPLES,
  );
  const entries = rows
    .map((row) => toEntry(row, samples.get(row.handle) ?? []))
    .sort(compareEntries);
  const counts: AiSquareCounts = {
    all: entries.length,
    ai: entries.filter((e) => e.kind === 'ai').length,
    suspect: entries.filter((e) => e.kind === 'suspect').length,
    listed: entries.filter((e) => e.listed).length,
  };
  return { generatedAt: nowS, counts, entries };
}

/** 单人详情：广场口径的完整条目（样本取最近 12 条）；不可公示返回 null */
export async function getAiSquareDetail(
  env: Cloudflare.Env,
  rawHandle: string,
  now = Date.now(),
): Promise<AiSquareEntry | null> {
  const handle = rawHandle.trim().replace(/^@/, '').toLowerCase();
  if (!HANDLE.test(handle)) return null;
  const nowS = Math.floor(now / 1000);
  const rows = await loadPublicRows(env, nowS, [handle]);
  const row = rows[0];
  if (!row) return null;
  const samples = await loadSamples(env, [row.handle], DETAIL_SAMPLES);
  return toEntry(row, samples.get(row.handle) ?? []);
}
