/**
 * GET /v1/ai-accounts/:handle：只读查一个账号「可以向所有人展示」的 AI 判定和社区票数。
 * GET /v1/ai-accounts/list：所有可公开的 AI / 疑似账号，扩展同步到本机，用来在评论区标记 / 折叠。
 *
 * 不调用任何第三方、不花 token、不计入判定额度，边缘可缓存（所以不按请求人区分）。
 * 可公开 = 已被第二个独立安装印证（confirmed）或社区投票进了名单，且不在复核中。
 * 单人未确认的结论这里只返回 pending=true，不返回分数：提交者本人的结果存在他的扩展里。
 * 复核中 = 「是真人」票 ≥ 3 或有已验证的申诉，且维护者还没复核：暂停公开展示。
 */
import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import { aiAccountVerdicts, aiAccountVotes, applications } from '../db/schema';
import { parseRhythm, type VerdictRhythm } from './check';
import type { AiVerdict } from './evidence';
import { AI_LIST_MIN_VOTES, tallyVotes, type AiVoteTally } from './vote';

const HANDLE = /^[a-z0-9_]{1,15}$/;
/** 「是真人」票达到这个数就暂停公开展示，进维护者复核队列 */
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
  /** 「是真人」票够了或有申诉，等维护者复核：暂停公开 */
  under_review: boolean;
  /** 维护者已复核过当前结论 */
  reviewed: boolean;
  votes: Omit<AiVoteTally, 'handle'>;
}

async function hasOpenAppeal(env: Cloudflare.Env, handle: string): Promise<boolean> {
  const rows = await getDb(env)
    .select({ id: applications.id })
    .from(applications)
    .where(
      and(
        eq(applications.handle, handle),
        eq(applications.kind, 'appeal'),
        eq(applications.status, 'verified'),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function lookupAiAccount(
  env: Cloudflare.Env,
  rawHandle: string,
  now = Date.now(),
): Promise<AiLookupValue | null> {
  const handle = rawHandle.trim().replace(/^@/, '').toLowerCase();
  if (!HANDLE.test(handle)) return null;
  const [[row], tally, appeal] = await Promise.all([
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
    hasOpenAppeal(env, handle),
  ]);
  const nowS = Math.floor(now / 1000);
  const reviewed = row?.reviewedAt != null;
  const underReview = !reviewed && (tally.human_count >= REVIEW_HUMAN_VOTES || appeal);
  const isPublic = !!row && (row.confirmed === 1 || tally.listed || reviewed) && !underReview;
  return {
    handle,
    verdict: isPublic ? row.verdict : null,
    score: isPublic ? row.score : null,
    reply_count: isPublic ? row.replyCount : 0,
    rhythm: isPublic ? parseRhythm(row.rhythm) : null,
    judged_at: row?.judgedAt ?? null,
    expires_at: row?.expiresAt ?? null,
    expired: row ? row.expiresAt <= nowS : false,
    public: isPublic,
    pending: !!row && !isPublic && !underReview,
    under_review: underReview,
    reviewed,
    votes: { ai_count: tally.ai_count, human_count: tally.human_count, listed: tally.listed },
  };
}

/** 名单条目：[handle, AI 味分数（0–1，社区投票入名单而没有判定时为 null）, 是否进了社区名单 0/1] */
export type AiListEntry = [string, number | null, 0 | 1];

/**
 * 可公开的 AI 一侧账号（ai / suspect，未过期）+ 社区投票进名单的账号。复核中的不下发。
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
      (v.reviewed_at is not null or coalesce(t.human, 0) < ${REVIEW_HUMAN_VOTES})
      and not exists (
        select 1 from ${applications} a
        where a.handle = coalesce(v.handle, t.handle) and a.kind = 'appeal' and a.status = 'verified'
          and v.reviewed_at is null
      )
      and (
        (v.verdict in ('ai', 'suspect') and v.expires_at > ${nowS}
          and (v.confirmed = 1 or v.reviewed_at is not null
               or (coalesce(t.ai, 0) >= ${AI_LIST_MIN_VOTES} and coalesce(t.ai, 0) > coalesce(t.human, 0))))
        or (v.handle is null and coalesce(t.ai, 0) >= ${AI_LIST_MIN_VOTES} and coalesce(t.ai, 0) > coalesce(t.human, 0))
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
