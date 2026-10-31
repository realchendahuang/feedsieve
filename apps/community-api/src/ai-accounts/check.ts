/**
 * POST /v1/ai-accounts/check：判断一个 X 账号是不是 AI 代写回复的账号。
 *
 * 判一次、全体共享：结果按账号缓存（ai / suspect 7 天给翻身机会，human / insufficient 30 天），
 * 命中缓存不调用任何第三方。未命中时 TikHub 拉 1 页回复 + Jev 判 1 次。
 * 扩展只上报 handle，不上报正文；服务端不保存回复正文。
 */
import { eq, sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import { aiAccountVerdicts, meta, trainingSampleUsage } from '../db/schema';
import { hashInstallationId, hashIp } from '../lib/hash';
import { utcToday } from '../lib/time';
import {
  buildReplies,
  decide,
  MIN_REPLIES,
  replyGaps,
  rhythm,
  type AiVerdict,
  type Rhythm,
} from './evidence';
import {
  AI_QUESTION_VERSION,
  fetchUserReplies,
  judgeAccount,
  vendorOpen,
  VendorError,
} from './vendors';

const HANDLE = /^[a-z0-9_]{1,15}$/;
const DAY_S = 86_400;
// 被判 AI / 疑似的只缓存 7 天：给「改过自新」的翻身机会——改掉 AI 代写、过 7 天有人再查就重判。
// 真人 / 证据不足缓存 30 天：真人没必要频繁重判，省 token，真人转 AI 概率也低。
const TTL_S: Record<AiVerdict, number> = {
  ai: 7 * DAY_S,
  suspect: 7 * DAY_S,
  human: 30 * DAY_S,
  insufficient: 30 * DAY_S,
};
/** 每个安装每天最多触发这么多次新判定（命中缓存不计）。 */
export const INSTALL_DAILY_CHECKS = 20;
/** 每个 IP 每天：国内常共用代理出口，放宽到安装的 10 倍。 */
export const IP_DAILY_CHECKS = 200;
/**
 * 全站每天新判定「兜底闸」（AI_CHECK_DAILY_BUDGET 可调）。
 * 不是业务限额——单用户限额（每安装 20 次/天）才是真正拦人的闸；判一次全体共享、缓存命中免费，
 * 用户越多判得越全是好事，所以总量不设人为天花板。这里默认放到一个只在「key 余额快烧穿」
 * 时才会触及的高位，纯粹防止余额耗尽后还无限打失败请求白费流量。换了更靠谱的供应商后可继续调高。
 */
export const DEFAULT_DAILY_BUDGET = 200_000;
/** 同一账号判定中的并发锁：其他请求直接返回 pending。 */
const LOCK_TTL_MS = 2 * 60 * 1000;

export interface VerdictRow {
  handle: string;
  verdict: AiVerdict;
  score: number | null;
  blue_verified: number | null;
  reply_count: number;
  question_version: number;
  judged_at: number;
  expires_at: number;
  confirmed: number;
  submitter: string | null;
  reply_ids: string | null;
  rhythm: string | null;
}

/** 判定节奏统计：rhythm JSON 列（无需迁移，后加的字段都可选）。 */
export type VerdictRhythm = Rhythm & {
  median_gap?: number | null;
  span?: number | null;
  authors?: number | null;
  rounds?: number;
};

export interface AiCheckValue {
  handle: string;
  verdict: AiVerdict;
  score: number | null;
  blue_verified: boolean | null;
  reply_count: number;
  judged_at: number;
  expires_at: number;
  /** 已被第二个独立安装印证（或服务端自己拉的证据），可以向所有人展示 */
  confirmed: boolean;
  rhythm: VerdictRhythm | null;
  /** true = 来自缓存；stale = 已过期但新判定暂时不可用，先返回旧结果 */
  cached: boolean;
  stale?: boolean;
}

export type AiCheckResult =
  | { status: 200; body: AiCheckValue }
  | { status: 202; body: { handle: string; verdict: 'pending' } }
  | { status: 400 | 429 | 502 | 503; body: { error: string } };

export function toValue(row: VerdictRow, cached: boolean, stale = false): AiCheckValue {
  return {
    handle: row.handle,
    verdict: row.verdict,
    score: row.score,
    blue_verified: row.blue_verified == null ? null : row.blue_verified === 1,
    reply_count: row.reply_count,
    judged_at: row.judged_at,
    expires_at: row.expires_at,
    confirmed: row.confirmed === 1,
    rhythm: parseRhythm(row.rhythm),
    cached,
    ...(stale ? { stale: true } : {}),
  };
}

export function parseRhythm(raw: string | null): VerdictRhythm | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as VerdictRhythm;
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

/** 查一条判定的完整行（judge / check / lookup 共用）。 */
export async function readVerdict(
  env: Cloudflare.Env,
  handle: string,
): Promise<VerdictRow | undefined> {
  const [row] = await getDb(env)
    .select({
      handle: aiAccountVerdicts.handle,
      verdict: sql<AiVerdict>`${aiAccountVerdicts.verdict}`,
      score: aiAccountVerdicts.score,
      blue_verified: aiAccountVerdicts.blueVerified,
      reply_count: aiAccountVerdicts.replyCount,
      question_version: aiAccountVerdicts.questionVersion,
      judged_at: aiAccountVerdicts.judgedAt,
      expires_at: aiAccountVerdicts.expiresAt,
      confirmed: aiAccountVerdicts.confirmed,
      submitter: aiAccountVerdicts.submitter,
      reply_ids: aiAccountVerdicts.replyIds,
      rhythm: aiAccountVerdicts.rhythm,
    })
    .from(aiAccountVerdicts)
    .where(eq(aiAccountVerdicts.handle, handle));
  return row;
}

/** 无上限计数（失败统计用）：与限额同一张计数表，前缀 ai-outcome: */
export async function bump(env: Cloudflare.Env, identity: string): Promise<void> {
  await getDb(env)
    .insert(trainingSampleUsage)
    .values({ identity, day: utcToday(), count: 1 })
    .onConflictDoUpdate({
      target: [trainingSampleUsage.identity, trainingSampleUsage.day],
      set: { count: sql`${trainingSampleUsage.count} + 1` },
    });
}

export function dailyBudget(env: Cloudflare.Env): number {
  const value = Number(env.AI_CHECK_DAILY_BUDGET);
  return Number.isInteger(value) && value >= 0 && value <= 10_000_000
    ? value
    : DEFAULT_DAILY_BUDGET;
}

/** 条件 UPSERT 预扣 1 次额度；超限返回 false（与 hot.ts 同一张计数表，前缀区分）。 */
export async function reserve(
  env: Cloudflare.Env,
  identity: string,
  limit: number,
): Promise<boolean> {
  if (limit < 1) return false;
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

export async function acquireLock(
  env: Cloudflare.Env,
  handle: string,
  now: number,
): Promise<boolean> {
  const result = await getDb(env)
    .insert(meta)
    .values({ key: `ai_check_lock:${handle}`, value: String(now + LOCK_TTL_MS) })
    .onConflictDoUpdate({
      target: meta.key,
      set: { value: sql`excluded.value` },
      setWhere: sql`${meta.value}::bigint <= ${now}`,
    })
    .returning({ key: meta.key });
  return result.length > 0;
}

export async function releaseLock(env: Cloudflare.Env, handle: string): Promise<void> {
  await getDb(env)
    .delete(meta)
    .where(eq(meta.key, `ai_check_lock:${handle}`));
}

export async function writeVerdict(
  env: Cloudflare.Env,
  row: {
    handle: string;
    xUserId: string | null;
    verdict: AiVerdict;
    score: number | null;
    blue: boolean | null;
    replyIds: string[];
    /** 节奏统计；证据直传路径额外带回复间隔中位数（JSON 列，无需迁移） */
    rhythm: VerdictRhythm | null;
    model: string | null;
    judgedAt: number;
    /** 提交证据的安装哈希；服务端自己拉的证据为 null */
    submitter: string | null;
    confirmed: boolean;
    displayName?: string | null;
    avatarUrl?: string | null;
  },
): Promise<VerdictRow> {
  const expiresAt = row.judgedAt + TTL_S[row.verdict];
  const blueVerified = row.blue == null ? null : row.blue ? 1 : 0;
  await getDb(env)
    .insert(aiAccountVerdicts)
    .values({
      handle: row.handle,
      xUserId: row.xUserId,
      verdict: row.verdict,
      score: row.score,
      blueVerified,
      replyCount: row.replyIds.length,
      replyIds: JSON.stringify(row.replyIds),
      rhythm: row.rhythm ? JSON.stringify(row.rhythm) : null,
      model: row.model,
      questionVersion: AI_QUESTION_VERSION,
      judgedAt: row.judgedAt,
      expiresAt,
      submitter: row.submitter,
      confirmed: row.confirmed ? 1 : 0,
      displayName: row.displayName ?? null,
      avatarUrl: row.avatarUrl ?? null,
    })
    .onConflictDoUpdate({
      target: aiAccountVerdicts.handle,
      set: {
        xUserId: sql`coalesce(excluded.x_user_id, ${aiAccountVerdicts.xUserId})`,
        verdict: sql`excluded.verdict`,
        score: sql`excluded.score`,
        blueVerified: sql`coalesce(excluded.blue_verified, ${aiAccountVerdicts.blueVerified})`,
        replyCount: sql`excluded.reply_count`,
        replyIds: sql`excluded.reply_ids`,
        rhythm: sql`excluded.rhythm`,
        model: sql`excluded.model`,
        questionVersion: sql`excluded.question_version`,
        judgedAt: sql`excluded.judged_at`,
        expiresAt: sql`excluded.expires_at`,
        submitter: sql`excluded.submitter`,
        confirmed: sql`excluded.confirmed`,
        displayName: sql`coalesce(excluded.display_name, ${aiAccountVerdicts.displayName})`,
        avatarUrl: sql`coalesce(excluded.avatar_url, ${aiAccountVerdicts.avatarUrl})`,
        // 重新判过就是新结论：清掉上一次的复核标记
        reviewedAt: sql`null`,
        reviewedBy: sql`null`,
      },
    });
  return {
    handle: row.handle,
    verdict: row.verdict,
    score: row.score,
    blue_verified: blueVerified,
    reply_count: row.replyIds.length,
    question_version: AI_QUESTION_VERSION,
    judged_at: row.judgedAt,
    expires_at: expiresAt,
    confirmed: row.confirmed ? 1 : 0,
    submitter: row.submitter,
    reply_ids: JSON.stringify(row.replyIds),
    rhythm: row.rhythm ? JSON.stringify(row.rhythm) : null,
  };
}

export async function checkAiAccount(
  env: Cloudflare.Env,
  raw: unknown,
  ip: string | undefined,
  now = Date.now(),
): Promise<AiCheckResult> {
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

  const nowS = Math.floor(now / 1000);
  const existing = await readVerdict(env, handle);
  // 旧版问题判出的结论继续有效到过期（换问题不让缓存作废、重新花钱）
  if (existing && existing.expires_at > nowS) {
    return { status: 200, body: toValue(existing, true) };
  }
  // 需要新判定但暂时做不了时，有旧结果就先给旧结果
  const fallback = (error: { status: 429 | 502 | 503; code: string }): AiCheckResult =>
    existing
      ? { status: 200, body: toValue(existing, true, true) }
      : { status: error.status, body: { error: error.code } };

  if (!env.TIKHUB_API_KEY || !env.TYPESAFE_API_KEY) {
    return fallback({ status: 503, code: 'ai_check_unavailable' });
  }
  if (!(await vendorOpen(env, 'tikhub', now)) || !(await vendorOpen(env, 'typesafe', now))) {
    return fallback({ status: 503, code: 'ai_check_paused' });
  }

  const installHash = await hashInstallationId(env.INSTALLATION_SALT, installationId);
  if (!(await reserve(env, `ai-check-install:${installHash}`, INSTALL_DAILY_CHECKS))) {
    return fallback({ status: 429, code: 'rate_limited' });
  }
  if (
    ip &&
    !(await reserve(env, `ai-check-ip:${await hashIp(env.INSTALLATION_SALT, ip)}`, IP_DAILY_CHECKS))
  ) {
    return fallback({ status: 429, code: 'rate_limited' });
  }
  if (!(await reserve(env, 'ai-check-global', dailyBudget(env)))) {
    return fallback({ status: 429, code: 'daily_budget_exhausted' });
  }

  if (!(await acquireLock(env, handle, now))) {
    return { status: 202, body: { handle, verdict: 'pending' } };
  }
  try {
    const data = await fetchUserReplies(env, handle);
    const blue = data.user?.blue_verified ?? null;
    const xUserId = data.user?.rest_id ?? null;
    const replies = data.user?.protected ? [] : buildReplies(handle, data);
    if (replies.length < MIN_REPLIES) {
      const row = await writeVerdict(env, {
        handle,
        xUserId,
        verdict: 'insufficient',
        score: null,
        blue,
        replyIds: replies.map((r) => r.id),
        rhythm: null,
        model: null,
        judgedAt: nowS,
        submitter: null,
        confirmed: true,
      });
      return { status: 200, body: toValue(row, false) };
    }
    const accountRhythm = rhythm(handle, data);
    const judged = await judgeAccount(env, replies, replyGaps(handle, data));
    const row = await writeVerdict(env, {
      handle,
      xUserId,
      verdict: decide(judged.score, accountRhythm),
      score: Math.round(judged.score * 100) / 100,
      blue,
      replyIds: replies.map((r) => r.id),
      rhythm: accountRhythm,
      model: judged.model,
      judgedAt: nowS,
      // 服务端自己拉的证据不可伪造：直接可公开
      submitter: null,
      confirmed: true,
    });
    return { status: 200, body: toValue(row, false) };
  } catch (error) {
    if (error instanceof VendorError) return fallback({ status: 502, code: 'upstream_failed' });
    throw error;
  } finally {
    await releaseLock(env, handle);
  }
}
