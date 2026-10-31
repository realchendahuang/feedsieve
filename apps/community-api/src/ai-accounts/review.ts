/**
 * AI 号复核（维护者后台）：「是真人」票 ≥ 3 或有已验证申诉的判定进队列，复核前暂停公开展示。
 *
 * 处理：
 * - human：改判真人（可公开，90 天内不重判），推翻原结论；
 * - keep：维持原结论，恢复公开展示。
 * 两种处理都记 reviewed_at，并写 admin_audit_log。申诉单（applications）的处理状态仍在
 * 申请页面里另行裁决，这里只决定 AI 结论。
 *
 * 失败统计：ai-outcome:* 计数（judge / 扩展上报），只有数字，按天汇总。
 */
import { and, desc, eq, gte, inArray, like, sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import {
  adminAuditLog,
  aiAccountVerdicts,
  aiAccountVotes,
  applications,
  trainingSampleUsage,
} from '../db/schema';
import { bump } from './check';
import { REVIEW_HUMAN_VOTES } from './lookup';
import { AI_QUESTION_VERSION } from './vendors';

const HANDLE = /^[a-z0-9_]{1,15}$/;
const DAY_S = 86_400;
/** 改判真人后这么久不重判：维护者看过了，不让同一批伪造证据马上又翻回去 */
const HUMAN_REVIEW_TTL_S = 90 * DAY_S;

/** 扩展端上报的失败类型（只计数）。 */
export const CLIENT_OUTCOMES = ['insufficient', 'narrow', 'stopped', 'no_data'] as const;
type ClientOutcome = (typeof CLIENT_OUTCOMES)[number];

export async function recordClientOutcome(env: Cloudflare.Env, raw: unknown): Promise<boolean> {
  const outcome = (raw as { outcome?: unknown } | null)?.outcome;
  if (!CLIENT_OUTCOMES.includes(outcome as ClientOutcome)) return false;
  await bump(env, `ai-outcome:client:${outcome as string}`);
  return true;
}

export interface AiReviewItem {
  handle: string;
  verdict: string | null;
  score: number | null;
  confirmed: boolean;
  judged_at: number | null;
  ai_count: number;
  human_count: number;
  appeals: Array<{ id: number; statement: string; created_at: number }>;
}

export interface AiReviewQueue {
  items: AiReviewItem[];
  /** 最近 7 天的结果计数：键是 ai-outcome:* 去掉前缀 */
  outcomes: Record<string, number>;
}

export async function listAiReviews(env: Cloudflare.Env): Promise<AiReviewQueue> {
  const db = getDb(env);
  const tallies = await db
    .select({
      handle: aiAccountVotes.handle,
      ai: sql<number>`count(*) filter (where ${aiAccountVotes.vote} = 'ai')`,
      human: sql<number>`count(*) filter (where ${aiAccountVotes.vote} = 'human')`,
    })
    .from(aiAccountVotes)
    .groupBy(aiAccountVotes.handle)
    .having(sql`count(*) filter (where ${aiAccountVotes.vote} = 'human') >= ${REVIEW_HUMAN_VOTES}`);
  const appealRows = await db
    .select({
      id: applications.id,
      handle: applications.handle,
      statement: applications.statement,
      createdAt: applications.createdAt,
    })
    .from(applications)
    .where(and(eq(applications.kind, 'appeal'), eq(applications.status, 'verified')))
    .orderBy(desc(applications.createdAt));
  const handles = [
    ...new Set([...tallies.map((t) => t.handle), ...appealRows.map((a) => a.handle.toLowerCase())]),
  ];
  if (!handles.length) return { items: [], outcomes: await recentOutcomes(env) };

  const verdicts = await db
    .select({
      handle: aiAccountVerdicts.handle,
      verdict: aiAccountVerdicts.verdict,
      score: aiAccountVerdicts.score,
      confirmed: aiAccountVerdicts.confirmed,
      judgedAt: aiAccountVerdicts.judgedAt,
      reviewedAt: aiAccountVerdicts.reviewedAt,
    })
    .from(aiAccountVerdicts)
    .where(inArray(aiAccountVerdicts.handle, handles));
  const allTallies = await db
    .select({
      handle: aiAccountVotes.handle,
      ai: sql<number>`count(*) filter (where ${aiAccountVotes.vote} = 'ai')`,
      human: sql<number>`count(*) filter (where ${aiAccountVotes.vote} = 'human')`,
    })
    .from(aiAccountVotes)
    .where(inArray(aiAccountVotes.handle, handles))
    .groupBy(aiAccountVotes.handle);
  const byVerdict = new Map(verdicts.map((v) => [v.handle, v]));
  const byTally = new Map(allTallies.map((t) => [t.handle, t]));
  const items: AiReviewItem[] = [];
  for (const handle of handles) {
    const v = byVerdict.get(handle);
    // 复核过、之后又没有新判定的不再进队列（重新判定会清掉 reviewed_at）
    if (v?.reviewedAt != null) continue;
    const t = byTally.get(handle);
    items.push({
      handle,
      verdict: v?.verdict ?? null,
      score: v?.score ?? null,
      confirmed: v?.confirmed === 1,
      judged_at: v?.judgedAt ?? null,
      ai_count: Number(t?.ai ?? 0),
      human_count: Number(t?.human ?? 0),
      appeals: appealRows
        .filter((a) => a.handle.toLowerCase() === handle)
        .map((a) => ({ id: a.id, statement: a.statement, created_at: a.createdAt })),
    });
  }
  items.sort(
    (a, b) => b.human_count + b.appeals.length * 3 - (a.human_count + a.appeals.length * 3),
  );
  return { items, outcomes: await recentOutcomes(env) };
}

async function recentOutcomes(env: Cloudflare.Env): Promise<Record<string, number>> {
  const since = new Date(Date.now() - 6 * DAY_S * 1000).toISOString().slice(0, 10);
  const rows = await getDb(env)
    .select({
      identity: trainingSampleUsage.identity,
      total: sql<number>`sum(${trainingSampleUsage.count})`,
    })
    .from(trainingSampleUsage)
    .where(
      and(like(trainingSampleUsage.identity, 'ai-outcome:%'), gte(trainingSampleUsage.day, since)),
    )
    .groupBy(trainingSampleUsage.identity);
  return Object.fromEntries(
    rows.map((r) => [r.identity.slice('ai-outcome:'.length), Number(r.total)]),
  );
}

export async function decideAiReview(
  env: Cloudflare.Env,
  rawHandle: string,
  raw: unknown,
  maintainerEmail: string,
  now = Date.now(),
): Promise<{ ok: true } | { ok: false; error: string }> {
  const handle = rawHandle.trim().replace(/^@/, '').toLowerCase();
  if (!HANDLE.test(handle)) return { ok: false, error: 'invalid_handle' };
  const decision = (raw as { decision?: unknown } | null)?.decision;
  if (decision !== 'human' && decision !== 'keep') return { ok: false, error: 'invalid_decision' };
  const nowS = Math.floor(now / 1000);
  const db = getDb(env);
  const [existing] = await db
    .select({ handle: aiAccountVerdicts.handle })
    .from(aiAccountVerdicts)
    .where(eq(aiAccountVerdicts.handle, handle));
  if (decision === 'keep' && !existing) return { ok: false, error: 'no_verdict' };
  if (decision === 'human') {
    await db
      .insert(aiAccountVerdicts)
      .values({
        handle,
        verdict: 'human',
        score: 0,
        replyCount: 0,
        questionVersion: AI_QUESTION_VERSION,
        model: 'review',
        judgedAt: nowS,
        expiresAt: nowS + HUMAN_REVIEW_TTL_S,
        confirmed: 1,
        reviewedAt: nowS,
        reviewedBy: maintainerEmail,
      })
      .onConflictDoUpdate({
        target: aiAccountVerdicts.handle,
        set: {
          verdict: 'human',
          score: 0,
          model: 'review',
          questionVersion: AI_QUESTION_VERSION,
          judgedAt: nowS,
          expiresAt: nowS + HUMAN_REVIEW_TTL_S,
          confirmed: 1,
          reviewedAt: nowS,
          reviewedBy: maintainerEmail,
        },
      });
  } else {
    await db
      .update(aiAccountVerdicts)
      .set({ reviewedAt: nowS, reviewedBy: maintainerEmail })
      .where(eq(aiAccountVerdicts.handle, handle));
  }
  await db.insert(adminAuditLog).values({
    actorEmail: maintainerEmail,
    action: `ai_review_${decision}`,
    targetType: 'ai_account',
    targetId: handle,
    detail: JSON.stringify({ decision }),
    createdAt: nowS,
  });
  return { ok: true };
}
