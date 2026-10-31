/**
 * POST /v1/ai-accounts/vote：对一个账号投「是 AI / 是真人」票（人工共识）。
 *
 * 判定（judge.ts）只决定投票者本人看到的标签；要进公共 AI 号名单，必须多人独立确认——
 * 这是防刷的关键：单个用户伪造一组「像 AI」的回复证据判出 ai 结论，也进不了公共名单。
 *
 * 共识门槛（读时聚合，不冗余存计数）：
 *   ai 票 ≥ AI_LIST_MIN_VOTES 且 ai 票 > human 票 → listed=true（进公共名单）
 *   human 票追平或反超 → listed=false（撤出 / 拦住）
 *
 * 每个安装对每个账号只保留一张当前票（改票 = 覆盖）。投票不调用任何第三方、不花 Jev 的钱，
 * 所以限额比判定宽松：每安装每天最多投 VOTE_DAILY 票，防脚本刷票。
 */
import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import { aiAccountVotes } from '../db/schema';
import { hashInstallationId } from '../lib/hash';
import { utcToday } from '../lib/time';
import { trainingSampleUsage } from '../db/schema';

const HANDLE = /^[a-z0-9_]{1,15}$/;
/** 进公共名单的最低 ai 独立票数（docs/06 §3.4 / §1 Botblock：≥3 个不同用户）。 */
export const AI_LIST_MIN_VOTES = 3;
/** 每个安装每天最多投这么多票（投票不花第三方钱，限额只为防脚本刷票）。 */
export const VOTE_DAILY = 100;

export interface AiVoteTally {
  handle: string;
  ai_count: number;
  human_count: number;
  /** 是否已达公共名单门槛 */
  listed: boolean;
}

export type AiVoteResult =
  { status: 200; body: AiVoteTally } | { status: 400 | 429; body: { error: string } };

/** 聚合一个账号的当前票数与是否入名单（读时算，judge/snapshot 都能复用）。 */
export async function tallyVotes(env: Cloudflare.Env, handle: string): Promise<AiVoteTally> {
  const [row] = await getDb(env)
    .select({
      ai: sql<number>`count(*) filter (where ${aiAccountVotes.vote} = 'ai')`,
      human: sql<number>`count(*) filter (where ${aiAccountVotes.vote} = 'human')`,
    })
    .from(aiAccountVotes)
    .where(eq(aiAccountVotes.handle, handle));
  const aiCount = Number(row?.ai ?? 0);
  const humanCount = Number(row?.human ?? 0);
  return {
    handle,
    ai_count: aiCount,
    human_count: humanCount,
    listed: aiCount >= AI_LIST_MIN_VOTES && aiCount > humanCount,
  };
}

async function reserveVote(env: Cloudflare.Env, identity: string, limit: number): Promise<boolean> {
  const used = await getDb(env)
    .insert(trainingSampleUsage)
    .values({ identity, day: utcToday(), count: 1 })
    .onConflictDoUpdate({
      target: [trainingSampleUsage.identity, trainingSampleUsage.day],
      set: { count: sql`${trainingSampleUsage.count} + 1` },
      setWhere: sql`${trainingSampleUsage.count} + 1 <= ${limit}`,
    })
    .returning({ identity: trainingSampleUsage.identity });
  return used.length > 0;
}

export async function voteAiAccount(
  env: Cloudflare.Env,
  raw: unknown,
  now = Date.now(),
): Promise<AiVoteResult> {
  const body = raw as Record<string, unknown> | null;
  const installationId = body?.installation_id;
  if (
    typeof installationId !== 'string' ||
    installationId.length < 8 ||
    installationId.length > 128
  ) {
    return { status: 400, body: { error: 'invalid_installation_id' } };
  }
  const handle =
    typeof body?.handle === 'string' ? body.handle.trim().replace(/^@/, '').toLowerCase() : '';
  if (!HANDLE.test(handle)) return { status: 400, body: { error: 'invalid_handle' } };
  const vote = body?.vote;
  if (vote !== 'ai' && vote !== 'human') return { status: 400, body: { error: 'invalid_vote' } };

  const installHash = await hashInstallationId(env.INSTALLATION_SALT, installationId);

  // 改已有票不算新增一次额度（否则改票也被限流）；只有「这个账号我之前没投过」才计一次。
  const existing = await getDb(env)
    .select({ vote: aiAccountVotes.vote })
    .from(aiAccountVotes)
    .where(and(eq(aiAccountVotes.handle, handle), eq(aiAccountVotes.installationId, installHash)));
  if (existing.length === 0) {
    if (!(await reserveVote(env, `ai-vote-install:${installHash}`, VOTE_DAILY))) {
      return { status: 429, body: { error: 'rate_limited' } };
    }
  }

  const nowS = Math.floor(now / 1000);
  await getDb(env)
    .insert(aiAccountVotes)
    .values({ handle, installationId: installHash, vote, createdAt: nowS, updatedAt: nowS })
    .onConflictDoUpdate({
      target: [aiAccountVotes.handle, aiAccountVotes.installationId],
      set: { vote: sql`excluded.vote`, updatedAt: sql`excluded.updated_at` },
    });

  return { status: 200, body: await tallyVotes(env, handle) };
}
