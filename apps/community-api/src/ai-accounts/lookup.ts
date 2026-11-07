/**
 * GET /v1/ai-accounts/:handle：只读查一个账号「可以向所有人展示」的 AI 判定和社区票数。
 * GET /v1/ai-accounts/list：所有可公开的 AI / 疑似账号，扩展同步到本机，用来在评论区标记 / 折叠。
 *
 * 不调用任何第三方、不花 token、不计入判定额度，边缘可缓存（所以不按请求人区分）。
 * 公开规则（投票 + 模型判定，不再有维护者复核）：
 * - AI 票 ≥ 3 且领先 → 公开 AI 结论（有判定分就带分数）；
 * - 真人票 ≥ 3 且领先 → 公开「真人」，从 AI 名单撤下；
 * - 两边都 ≥ 3 且持平 → contested，只显示票数；
 * - 票数都不够时，模型判定被第二个独立安装确认（confirmed）才公开。
 * 单人未确认的结论这里只返回 pending=true，不返回分数：提交者本人的结果存在他的扩展里。
 */
import { eq, sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import { aiAccountVerdicts, aiAccountVotes } from '../db/schema';
import { parseRhythm, type VerdictRhythm } from './check';
import type { AiVerdict } from './evidence';
import { AI_LIST_MIN_VOTES, tallyVotes, type AiVoteTally } from './vote';

const HANDLE = /^[a-z0-9_]{1,15}$/;
/** 旧后台队列的「真人票」阈值；公开结果已不再依赖维护者复核 */
export const REVIEW_HUMAN_VOTES = 3;

export interface AiLookupValue {
  handle: string;
  verdict: AiVerdict | null;
  score: number | null;
  reply_count: number;
  rhythm: VerdictRhythm | null;
  judged_at: number | null;
  expires_at: number | null;
  /** 判定已过期或问题版本已更新：可以重测 */
  expired: boolean;
  /** 可以向所有人展示（verdict / score 只有这时才返回） */
  public: boolean;
  /** 有人测过但还没被第二个人印证：不返回分数 */
  pending: boolean;
  /** 「是真人」票和 AI 票都够且持平：只显示票数 */
  contested: boolean;
  /** 旧字段，保留给旧版扩展；新逻辑恒为 false */
  under_review: boolean;
  /** 维护者是否手动处理过（仅保留信息，不再影响公开状态） */
  reviewed: boolean;
  votes: Omit<AiVoteTally, 'handle'>;
}

export async function lookupAiAccount(
  env: Cloudflare.Env,
  rawHandle: string,
  now = Date.now(),
): Promise<AiLookupValue | null> {
  const handle = rawHandle.trim().replace(/^@/, '').toLowerCase();
  if (!HANDLE.test(handle)) return null;
  const [[row], tally] = await Promise.all([
    getDb(env)
      .select({
        verdict: sql<AiVerdict>`${aiAccountVerdicts.verdict}`,
        score: aiAccountVerdicts.score,
        replyCount: aiAccountVerdicts.replyCount,
        rhythm: aiAccountVerdicts.rhythm,
        judgedAt: aiAccountVerdicts.judgedAt,
        expiresAt: aiAccountVerdicts.expiresAt,
        confirmed: aiAccountVerdicts.confirmed,
        reviewedAt: aiAccountVerdicts.reviewedAt,
      })
      .from(aiAccountVerdicts)
      .where(eq(aiAccountVerdicts.handle, handle)),
    tallyVotes(env, handle),
  ]);
  const nowS = Math.floor(now / 1000);
  const aiWin = tally.ai_count >= AI_LIST_MIN_VOTES && tally.ai_count > tally.human_count;
  const humanWin = tally.human_count >= AI_LIST_MIN_VOTES && tally.human_count > tally.ai_count;
  const contested =
    tally.ai_count >= AI_LIST_MIN_VOTES &&
    tally.human_count >= AI_LIST_MIN_VOTES &&
    tally.ai_count === tally.human_count;
  /**
   * 判定过期即不再是可公开结论（与 /v1/ai-accounts/list、广场 square.ts 同源）：
   * 过期是「有人再遇到就重判」的信号，旧分数不该继续对外展示，否则同一个号
   * 在广场（按过期过滤）和结果页（按旧口径）会给出两个结论。
   */
  const fresh = row != null && row.expiresAt > nowS;
  const jevAi = fresh && (row?.verdict === 'ai' || row?.verdict === 'suspect');
  let verdict: AiVerdict | null = null;
  let score: number | null = null;
  if (!contested && humanWin) {
    verdict = 'human';
  } else if (!contested && aiWin) {
    verdict = jevAi ? row!.verdict : 'ai';
    score = jevAi ? row!.score : null;
  } else if (!contested && fresh && row?.confirmed === 1 && row.verdict !== 'insufficient') {
    verdict = row.verdict;
    score = jevAi ? row.score : null;
  }
  const isPublic = verdict !== null;
  return {
    handle,
    verdict,
    score: isPublic ? score : null,
    reply_count: isPublic && verdict !== 'human' ? (row?.replyCount ?? 0) : 0,
    rhythm: isPublic && verdict !== 'human' && row ? parseRhythm(row.rhythm) : null,
    judged_at: row?.judgedAt ?? null,
    expires_at: row?.expiresAt ?? null,
    expired: row ? row.expiresAt <= nowS : false,
    public: isPublic,
    pending: !!row && !isPublic && !contested,
    contested,
    under_review: false,
    reviewed: row?.reviewedAt != null,
    votes: { ai_count: tally.ai_count, human_count: tally.human_count, listed: tally.listed },
  };
}

/** 名单条目：[handle, AI 味分数（0–1，社区投票入名单而没有判定时为 null）, 是否进了社区名单 0/1] */
export type AiListEntry = [string, number | null, 0 | 1];

/**
 * 可公开的 AI 一侧账号（ai / suspect，未过期）+ 社区投票进名单的账号。社区认为真人/争议的不下发。
 * 按 handle 排序（collate "C"），同一批数据输出稳定，边缘缓存与 ETag 才有意义。
 */
export async function listAiAccounts(
  env: Cloudflare.Env,
  now = Date.now(),
): Promise<AiListEntry[]> {
  const nowS = Math.floor(now / 1000);
  const db = getDb(env);
  const tallies = db
    .select({
      handle: aiAccountVotes.handle,
      ai: sql<number>`count(*) filter (where ${aiAccountVotes.vote} = 'ai')`.as('ai'),
      human: sql<number>`count(*) filter (where ${aiAccountVotes.vote} = 'human')`.as('human'),
    })
    .from(aiAccountVotes)
    .groupBy(aiAccountVotes.handle)
    .as('t');
  const rows = await db.execute<{
    handle: string;
    score: number | null;
    listed: boolean;
  }>(sql`
    select coalesce(v.handle, t.handle) as handle,
           case when v.verdict in ('ai', 'suspect') and v.expires_at > ${nowS} then v.score end as score,
           coalesce(t.ai, 0) >= ${AI_LIST_MIN_VOTES} and coalesce(t.ai, 0) > coalesce(t.human, 0) as listed
    from ${aiAccountVerdicts} v
    full outer join ${tallies} on t.handle = v.handle
    where
      -- 真人票 ≥ 3 且不落后：社区认为真人（或争议），不进 AI 名单
      not (coalesce(t.human, 0) >= ${AI_LIST_MIN_VOTES} and coalesce(t.human, 0) >= coalesce(t.ai, 0))
      and (
        (v.verdict in ('ai', 'suspect') and v.expires_at > ${nowS} and v.confirmed = 1)
        or (coalesce(t.ai, 0) >= ${AI_LIST_MIN_VOTES} and coalesce(t.ai, 0) > coalesce(t.human, 0))
      )
    order by coalesce(v.handle, t.handle) collate "C"
  `);
  const list = (Array.isArray(rows) ? rows : (rows as { rows: typeof rows }).rows) as Array<{
    handle: string;
    score: number | null;
    listed: boolean;
  }>;
  return list.map((r) => [r.handle, r.score == null ? null : Number(r.score), r.listed ? 1 : 0]);
}
