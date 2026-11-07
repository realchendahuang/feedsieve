/**
 * POST /v1/ai-accounts/check：判断一个 X 账号是不是 AI 代写回复的账号。
 *
 * 判一次、全体共享：结果按账号缓存（ai / suspect 7 天给翻身机会，human / insufficient 30 天），
 * 命中缓存不调用任何第三方。未命中时 TikHub 拉 1 页回复 + 判定模型判 1 次。
 * 扩展只上报 handle 与截断后的回复证据；服务端不保存 handle 之外的请求身份。被判为 AI /
 * 疑似 AI 的账号，会把参与判定的回复样本落库（最多 20 条，判为真人时清除），供官网 AI 号广场
 * 公示；证据不足时不落库。
 */
import { and, desc, eq, notInArray, sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import { aiAccountSamples, aiAccountVerdicts, meta, trainingSampleUsage } from '../db/schema';
import { hashInstallationId, hashIp } from '../lib/hash';
import { stripNul } from '../lib/sql';
import { utcToday } from '../lib/time';
import {
  buildReplies,
  decide,
  MAX_PARENT_CHARS,
  MAX_REPLY_CHARS,
  MIN_REPLIES,
  replyGaps,
  rhythm,
  type AiVerdict,
  type ReplyEvidence,
  type Rhythm,
} from './evidence';
import {
  AI_QUESTION_VERSION,
  fetchUserReplies,
  judgeAccount,
  vendorOpen,
  VendorError,
} from './vendors';
import { judgeAvailability } from './providers';

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
  comment: string | null;
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
  /** 判定模型给的一句话锐评（旧判定 / Clef 回落没有） */
  comment: string | null;
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
    comment: row.comment,
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
      comment: aiAccountVerdicts.comment,
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
    /** 判定模型给的一句话锐评 */
    comment?: string | null;
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
      comment: row.comment ?? null,
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
        comment: sql`coalesce(excluded.comment, ${aiAccountVerdicts.comment})`,
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
    comment: row.comment ?? null,
  };
}

// ---------------------------------------------------------------------------
// AI 号广场的回复样本（页面展示「它最近回复了什么」）
// ---------------------------------------------------------------------------

/** 每个 handle 最多保留的样本条数（详情页最多展示 12 条，留余量给后续调整） */
export const MAX_SAMPLES_PER_HANDLE = 20;
const TWITTER_EPOCH = 1288834974657n;

/**
 * 一条待落库的回复样本。judge / check 两条判定路径各自从本次参与判定的回复整理出来，
 * 写库前再统一截断、去 NUL、去重、排序。
 */
export interface AiSampleRow {
  tweetId: string;
  parentId: string | null;
  text: string;
  parentText: string | null;
  /** Unix 秒 */
  postedAt: number | null;
  gapSeconds: number | null;
}

/** 按码点截断并去掉 NUL（PG 的 text 不接受 U+0000），与写库口径一致。 */
function sampleText(value: string, max: number): string {
  return stripNul([...value].slice(0, max).join('')).trim();
}

/** snowflake → Unix 秒；ID 解析不出发布时间返回 null。 */
function snowflakeSeconds(id: string): number | null {
  try {
    const ms = Number((BigInt(id) >> 22n) + TWITTER_EPOCH);
    return ms > Number(TWITTER_EPOCH) ? Math.floor(ms / 1000) : null;
  } catch {
    return null;
  }
}

/**
 * 把判定用的回复整理成样本行（judge / check 共用）。
 * - posted_at 从 snowflake 算（与判定时的节奏统计同源），算不出为 NULL；
 * - gap_seconds 是「与上一条回复的间隔」：gaps 是判定时按时间升序算好的间隔数组
 *   （judge 传 gapsFromIds 的结果；check 传空数组，由 snowflake 现算），按时间排序后逐条配对；
 * - 正文 / 原帖按 evidence 的同一口径截断（≤200 / ≤80 码点）并去 NUL，空正文的行丢弃。
 */
export function sampleRowsFromReplies(
  replies: readonly ReplyEvidence[],
  gaps: readonly number[],
): AiSampleRow[] {
  const postedAt = new Map(replies.map((reply) => [reply.id, snowflakeSeconds(reply.id)]));
  const timed = replies
    .filter((reply) => postedAt.get(reply.id) != null)
    .sort((a, b) => (postedAt.get(a.id) as number) - (postedAt.get(b.id) as number));
  // 间隔是相邻两条的差：按时间升序，第 i 条（i≥1）对应 gaps[i-1]
  const gapOf = new Map<string, number>();
  for (let i = 1; i < timed.length; i += 1) {
    const current = timed[i]!;
    const previous = timed[i - 1]!;
    gapOf.set(
      current.id,
      gaps[i - 1] ??
        Math.max(0, (postedAt.get(current.id) as number) - (postedAt.get(previous.id) as number)),
    );
  }
  return replies
    .map((reply) => ({
      tweetId: reply.id,
      parentId: null,
      text: sampleText(reply.text, MAX_REPLY_CHARS),
      parentText: reply.parent ? sampleText(reply.parent, MAX_PARENT_CHARS) || null : null,
      postedAt: postedAt.get(reply.id) ?? null,
      gapSeconds: gapOf.get(reply.id) ?? null,
    }))
    .filter((row) => row.text.length > 0);
}

/**
 * 判定结果同步样本（judge / check 共用）：
 * - verdict 为 ai / suspect：写入本次参与判定的回复，并把该 handle 裁到 20 条；
 * - verdict 为 human：删除该 handle 全部样本（不给真人留存）；
 * - verdict 为 insufficient：不写、不删。
 * 写入用 ON CONFLICT DO NOTHING：同一批公开回复被重复判定时不产生重复行。
 */
export async function saveVerdictSamples(
  env: Cloudflare.Env,
  handle: string,
  verdict: AiVerdict,
  rows: readonly AiSampleRow[],
  nowS: number,
): Promise<void> {
  if (verdict === 'insufficient') return;
  const db = getDb(env);
  if (verdict === 'human') {
    await db.delete(aiAccountSamples).where(eq(aiAccountSamples.handle, handle));
    return;
  }
  // 多行 UPSERT 先按主键排序；同一批里重复的 tweet 只留一条
  const unique: AiSampleRow[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.tweetId)) continue;
    seen.add(row.tweetId);
    unique.push(row);
  }
  const values = unique
    .sort((a, b) => (a.tweetId < b.tweetId ? -1 : a.tweetId > b.tweetId ? 1 : 0))
    .map((row) => ({
      handle,
      tweetId: row.tweetId,
      parentId: row.parentId,
      text: row.text,
      parentText: row.parentText,
      postedAt: row.postedAt,
      gapSeconds: row.gapSeconds,
      // 两条判定路径（扩展直传 / TikHub）都是服务端判定时落库，来源统一记 judge
      source: 'judge',
      createdAt: nowS,
    }));
  if (values.length) {
    await db.insert(aiAccountSamples).values(values).onConflictDoNothing();
  }
  // 每 handle 只留最近 20 条：新写入的 created_at 最新，旧的裁掉
  const keep = await db
    .select({ tweetId: aiAccountSamples.tweetId })
    .from(aiAccountSamples)
    .where(eq(aiAccountSamples.handle, handle))
    .orderBy(
      desc(aiAccountSamples.createdAt),
      sql`${aiAccountSamples.postedAt} desc nulls last`,
      desc(aiAccountSamples.tweetId),
    )
    .limit(MAX_SAMPLES_PER_HANDLE);
  if (keep.length) {
    await db
      .delete(aiAccountSamples)
      .where(
        and(
          eq(aiAccountSamples.handle, handle),
          notInArray(
            aiAccountSamples.tweetId,
            keep.map((row) => row.tweetId),
          ),
        ),
      );
  }
}

/**
 * 判定已经落库后再同步样本：样本只用于页面展示，写失败不能让一次成功的判定变成 500。
 */
export async function syncVerdictSamples(
  env: Cloudflare.Env,
  handle: string,
  verdict: AiVerdict,
  rows: readonly AiSampleRow[],
  nowS: number,
): Promise<void> {
  try {
    await saveVerdictSamples(env, handle, verdict, rows, nowS);
  } catch (error) {
    console.error('[community-api] ai account samples sync failed', error);
  }
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

  // 判定模型网关：没配好（缺 AI binding / key）→ unavailable；配好但熔断全开 → paused。
  const availability = await judgeAvailability(env, now);
  if (!env.TIKHUB_API_KEY || availability === 'unavailable') {
    return fallback({ status: 503, code: 'ai_check_unavailable' });
  }
  if (!(await vendorOpen(env, 'tikhub', now)) || availability === 'paused') {
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
        comment: null,
      });
      return { status: 200, body: toValue(row, false) };
    }
    const accountRhythm = rhythm(handle, data);
    const judged = await judgeAccount(env, replies, replyGaps(handle, data));
    const verdict = decide(judged.score, accountRhythm);
    const row = await writeVerdict(env, {
      handle,
      xUserId,
      verdict,
      score: Math.round(judged.score * 100) / 100,
      blue,
      replyIds: replies.map((r) => r.id),
      rhythm: accountRhythm,
      model: judged.model,
      judgedAt: nowS,
      // 服务端自己拉的证据不可伪造：直接可公开
      submitter: null,
      confirmed: true,
      comment: judged.comment,
    });
    /*
     * 广场样本：TikHub 路径拿得到正文（buildReplies 的 text），所以同样落库；原帖 ID 只有
     * timeline 里有（buildReplies 只保留原帖正文），按回复 ID 反查。间隔用 snowflake 现算：
     * 这条路径没有客户端上报的 gaps，而 replyGaps 覆盖的时间线未必与这 10 条一一对应。
     */
    const parentIds = new Map(
      data.timeline.map((tweet) => [tweet.tweet_id, tweet.in_reply_to_status_id_str ?? null]),
    );
    const samples = sampleRowsFromReplies(replies, []).map((sample) => ({
      ...sample,
      parentId: parentIds.get(sample.tweetId) ?? null,
    }));
    await syncVerdictSamples(env, handle, verdict, samples, nowS);
    return { status: 200, body: toValue(row, false) };
  } catch (error) {
    if (error instanceof VendorError) return fallback({ status: 502, code: 'upstream_failed' });
    throw error;
  } finally {
    await releaseLock(env, handle);
  }
}
