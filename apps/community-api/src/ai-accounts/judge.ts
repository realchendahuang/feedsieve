/**
 * POST /v1/ai-accounts/judge：证据直传版的账号级 AI 判定。
 *
 * 与 /check 的区别：回复证据由扩展在本地从 DOM 抓取后直接上报（handle + replies[] + gaps[]），
 * 服务端不再经过 TikHub。省掉 TikHub 成本，也省掉用户 X 会话额度——用户要查谁，他自己点进
 * 那个人的 with_replies 页就有数据（见 docs/06 的 2026-10-31 定稿：砍掉 TikHub 主通道）。
 *
 * 判定模型的凭据（Workers AI / AI Gateway，或可配置的其他 provider）只在服务端，扩展不持有，
 * 所以判定这一跳必须经过本 Worker 中转；具体走哪个模型由 providers/ 的网关按部署配置决定。
 *
 * 判一次、全体共享：结果写同一张 ai_account_verdicts 表并缓存（ai/suspect 7 天给翻身机会，
 * human/insufficient 30 天）。命中缓存不调用 Jev、不计费、不计入单用户额度。
 * 单用户每天新判定上限（INSTALL_DAILY_CHECKS）是真正拦人的闸；全站只有防余额烧穿的兜底闸。
 *
 * 防刷：本接口的判定结果只决定「本人看到的标签」；要进公共 AI 号名单，必须 ≥3 个独立安装
 * 投票共识（见 vote.ts），单个用户伪造证据刷不动公共名单。判定 7 天过期后可重判，自然纠偏。
 */
import { eq } from 'drizzle-orm';
import { getDb } from '../db/client';
import { aiAccountVerdicts } from '../db/schema';
import { hashInstallationId, hashIp } from '../lib/hash';
import { stripNul } from '../lib/sql';
import {
  acquireLock,
  bump,
  dailyBudget,
  readVerdict,
  INSTALL_DAILY_CHECKS,
  IP_DAILY_CHECKS,
  releaseLock,
  reserve,
  sampleRowsFromReplies,
  syncVerdictSamples,
  toValue,
  writeVerdict,
  type AiCheckResult,
} from './check';
import {
  DECISION,
  decide,
  MAX_PARENT_CHARS,
  MAX_REPLIES,
  MAX_REPLY_CHARS,
  MIN_REPLIES,
  rhythmFromReplies,
  type AiVerdict,
  type ReplyEvidence,
} from './evidence';
import { judgeAccount, VendorError } from './vendors';
import { judgeAvailability } from './providers';

const HANDLE = /^[a-z0-9_]{1,15}$/;
const POST_ID = /^\d{1,25}$/;
/** 单条回复 / 原帖截断（码点）：和 evidence.buildReplies 同口径，也是 token 的主要来源 */
const MAX_TEXT = MAX_REPLY_CHARS;
const MAX_PARENT = MAX_PARENT_CHARS;
const TCO = /https:\/\/t\.co\/\S+/g;
/** 回复间隔的合理上限（秒）：30 天，超出按异常丢弃该值。 */
const MAX_GAP_S = 30 * 86_400;
/** 一次最多上传两批：第一批（最近 15 条）先判，落在灰色地带时用第二批再判一次取平均 */
export const MAX_UPLOAD = MAX_REPLIES * 2;
const TWITTER_EPOCH = 1288834974657n;

/** 回复间隔从帖子 ID（snowflake）算，不信任客户端传的间隔；ID 解析不了时退回客户端的。 */
function gapsFromIds(replies: ReplyEvidence[], fallback: number[]): number[] {
  const at = replies
    .map((r) => Number((BigInt(r.id) >> 22n) + TWITTER_EPOCH))
    .filter((ms) => ms > Number(TWITTER_EPOCH))
    .sort((a, b) => a - b);
  if (at.length < 2) return fallback;
  return at.slice(1).map((x, i) => Math.round((x - at[i]!) / 1000));
}

/** Jev 在疑似线到强线之间（0.40–0.55）最容易判错：第二批够数时补判一次取平均 */
function grayZone(score: number): boolean {
  return score >= DECISION.suspect && score < DECISION.strong;
}

/** 两份证据的回复 ID 重合到这个比例（按较少的一份算），就算同一批公开回复的独立印证 */
export const CONFIRM_OVERLAP = 0.5;

function overlapRatio(a: readonly string[], b: readonly string[]): number {
  if (!a.length || !b.length) return 0;
  const set = new Set(a);
  const shared = b.filter((id) => set.has(id)).length;
  return shared / Math.min(a.length, b.length);
}

/** AI 一侧（ai / suspect）还是真人一侧：两次判定落在同一侧才算一致 */
function side(verdict: AiVerdict): 'ai' | 'human' | 'none' {
  return verdict === 'ai' || verdict === 'suspect' ? 'ai' : verdict === 'human' ? 'human' : 'none';
}

function medianGap(gaps: number[]): number | null {
  if (!gaps.length) return null;
  const sorted = [...gaps].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

/** 从客户端 payload 里挑出一条合法回复证据；任何字段不合法则返回 null（整条丢弃）。 */
function cleanReply(raw: unknown): ReplyEvidence | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !POST_ID.test(r.id)) return null;
  if (typeof r.text !== 'string') return null;
  // t.co 短链对判断写法没有信息量，只占 token
  const text = [...r.text.replace(TCO, '').trim()].slice(0, MAX_TEXT).join('').trim();
  if (!text) return null;
  const parent =
    typeof r.parent === 'string' && r.parent.trim()
      ? [...r.parent.replace(TCO, '').trim()].slice(0, MAX_PARENT).join('').trim() || null
      : null;
  return { id: r.id, parent, text };
}

/** 去重（同原帖只留一条、同帖 ID 只留一条）并裁到 MAX_REPLIES，与 TikHub 路径口径一致。 */
function cleanReplies(raw: unknown, limit = MAX_UPLOAD): ReplyEvidence[] {
  if (!Array.isArray(raw)) return [];
  const seenParents = new Set<string>();
  const seenIds = new Set<string>();
  const out: ReplyEvidence[] = [];
  for (const item of raw) {
    const reply = cleanReply(item);
    if (!reply) continue;
    if (seenIds.has(reply.id)) continue;
    if (reply.parent && seenParents.has(reply.parent)) continue;
    seenIds.add(reply.id);
    if (reply.parent) seenParents.add(reply.parent);
    out.push(reply);
    if (out.length >= limit) break;
  }
  return out;
}

function cleanGaps(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (g): g is number => typeof g === 'number' && Number.isFinite(g) && g >= 0 && g <= MAX_GAP_S,
    )
    .map((g) => Math.round(g))
    .slice(-(MAX_UPLOAD - 1));
}

export async function judgeAiAccount(
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

  const replies = cleanReplies(body?.replies);
  const gaps = cleanGaps(body?.gaps);
  const blue = typeof body?.blue_verified === 'boolean' ? body.blue_verified : null;
  // 公开结果页 / OG 图用：昵称截 64 字，头像只认 X 图床
  const displayName =
    typeof body?.display_name === 'string'
      ? stripNul([...body.display_name.trim()].slice(0, 64).join('')) || null
      : null;
  const avatarUrl =
    typeof body?.avatar_url === 'string' &&
    /^https:\/\/pbs\.twimg\.com\/[\w./-]{1,300}$/.test(body.avatar_url)
      ? body.avatar_url
      : null;
  // 回给了几个不同的人（只有数字，扩展不上传这些人的账号）
  const authorCount =
    typeof body?.author_count === 'number' &&
    Number.isInteger(body.author_count) &&
    body.author_count >= 0 &&
    body.author_count <= MAX_UPLOAD
      ? body.author_count
      : null;
  const xUserId =
    typeof body?.x_user_id === 'string' && /^\d{1,20}$/.test(body.x_user_id)
      ? body.x_user_id
      : null;

  const nowS = Math.floor(now / 1000);
  const installHash = await hashInstallationId(env.INSTALLATION_SALT, installationId);
  const existing = await readVerdict(env, handle);
  // 旧版问题判出的结论继续有效到过期：换问题不让全部缓存作废、重新花钱
  const fresh = !!existing && existing.expires_at > nowS;
  let previousIds: string[];
  try {
    previousIds = existing?.reply_ids ? (JSON.parse(existing.reply_ids) as string[]) : [];
  } catch {
    previousIds = [];
  }
  /*
   * 扩展交来的证据可以伪造，所以单人结论只给本人看（confirmed=0）。公开的条件：
   * 另一个独立安装交来的证据和已有证据有一半以上回复 ID 重合（同一批公开回复，不花钱），
   * 或者重新判一次落在同一侧（AI / 真人）。已确认 / 本人再查 / 服务端拉的证据直接返回缓存。
   */
  if (fresh && existing) {
    const sameSubmitter = !existing.submitter || existing.submitter === installHash;
    if (existing.confirmed === 1 || sameSubmitter) {
      // 早期判定没存昵称头像：有人再来查时顺手补上（公开结果页 / OG 图用）
      if (displayName || avatarUrl) {
        await getDb(env)
          .update(aiAccountVerdicts)
          .set({
            ...(displayName ? { displayName } : {}),
            ...(avatarUrl ? { avatarUrl } : {}),
          })
          .where(eq(aiAccountVerdicts.handle, handle));
      }
      await bump(env, 'ai-outcome:cached');
      return { status: 200, body: toValue(existing, true) };
    }
    const ids = replies.map((r) => r.id);
    if (overlapRatio(previousIds, ids) >= CONFIRM_OVERLAP) {
      await getDb(env)
        .update(aiAccountVerdicts)
        .set({
          confirmed: 1,
          ...(displayName ? { displayName } : {}),
          ...(avatarUrl ? { avatarUrl } : {}),
        })
        .where(eq(aiAccountVerdicts.handle, handle));
      await bump(env, 'ai-outcome:confirmed');
      return { status: 200, body: toValue({ ...existing, confirmed: 1 }, true) };
    }
  }

  // 证据不足：不花 Jev 的钱，直接记 insufficient（客户端据此引导用户往下滚、加载更多回复）。
  if (replies.length < MIN_REPLIES) {
    await bump(env, 'ai-outcome:insufficient');
    return { status: 400, body: { error: 'insufficient_replies' } };
  }

  // 新判定暂时做不了时退回旧结果：只退回可公开的、或本人自己的，别人的未确认结论不外泄
  const shareable =
    !!existing &&
    (existing.confirmed === 1 || !existing.submitter || existing.submitter === installHash);
  const fallback = (error: { status: 429 | 502 | 503; code: string }): AiCheckResult =>
    existing && shareable
      ? { status: 200, body: toValue(existing, true, true) }
      : { status: error.status, body: { error: error.code } };

  // 判定模型网关：没配好（缺 AI binding / key）→ unavailable；配好但熔断全开 → paused。
  // 放在扣额度之前：供应商不可用时不能白扣用户的每日额度。
  const availability = await judgeAvailability(env, now);
  if (availability === 'unavailable') {
    return fallback({ status: 503, code: 'ai_check_unavailable' });
  }
  if (availability === 'paused') {
    return fallback({ status: 503, code: 'ai_check_paused' });
  }

  // 单用户闸（真正拦人的）：每安装 / 每 IP 每天。缓存命中已在上面提前返回，不走到这里。
  if (!(await reserve(env, `ai-check-install:${installHash}`, INSTALL_DAILY_CHECKS))) {
    return fallback({ status: 429, code: 'rate_limited' });
  }
  if (
    ip &&
    !(await reserve(env, `ai-check-ip:${await hashIp(env.INSTALLATION_SALT, ip)}`, IP_DAILY_CHECKS))
  ) {
    return fallback({ status: 429, code: 'rate_limited' });
  }
  // 全站兜底闸：防 key 余额烧穿后无限打失败请求，不是业务限额。
  if (!(await reserve(env, 'ai-check-global', dailyBudget(env)))) {
    return fallback({ status: 429, code: 'daily_budget_exhausted' });
  }

  if (!(await acquireLock(env, handle, now))) {
    return { status: 202, body: { handle, verdict: 'pending' } };
  }
  try {
    const first = replies.slice(0, MAX_REPLIES);
    const second = replies.slice(MAX_REPLIES, MAX_UPLOAD);
    let judged = await judgeAccount(env, first, gapsFromIds(first, gaps.slice(0, MAX_REPLIES - 1)));
    let used = first;
    let rounds = 1;
    if (grayZone(judged.score) && second.length >= MIN_REPLIES) {
      const again = await judgeAccount(env, second, gapsFromIds(second, []), {
        preferredProvider: judged.provider,
      });
      judged = { ...again, score: (judged.score + again.score) / 2 };
      used = replies;
      rounds = 2;
    }
    const usedGaps = gapsFromIds(used, gaps);
    const accountRhythm = rhythmFromReplies(used, usedGaps);
    const ids = used.map((r) => Number((BigInt(r.id) >> 22n) + TWITTER_EPOCH));
    const span = ids.length >= 2 ? Math.round((Math.max(...ids) - Math.min(...ids)) / 1000) : null;
    const verdict = decide(judged.score, accountRhythm);
    // 另一个人的未确认结论还在有效期：这次独立重判落在同一侧，就互相印证、可以公开
    const corroborated =
      fresh &&
      !!existing &&
      existing.submitter !== installHash &&
      side(existing.verdict) !== 'none' &&
      side(existing.verdict) === side(verdict);
    const row = await writeVerdict(env, {
      handle,
      xUserId,
      verdict,
      score: Math.round(judged.score * 100) / 100,
      blue,
      replyIds: used.map((r) => r.id),
      rhythm: {
        ...accountRhythm,
        median_gap: medianGap(usedGaps),
        span,
        authors: authorCount,
        rounds,
      },
      model: judged.model,
      judgedAt: nowS,
      submitter: installHash,
      confirmed: corroborated,
      displayName,
      avatarUrl,
    });
    /*
     * AI 号广场的回复样本：ai / suspect 把本次参与判定的回复落库（human 清除、insufficient 不写不删，
     * 见 saveVerdictSamples）。间隔直接用上面判定时的 usedGaps，与节奏统计同源；
     * 扩展直传路径没有原帖 ID，parent_id 留空。
     */
    await syncVerdictSamples(env, handle, verdict, sampleRowsFromReplies(used, usedGaps), nowS);
    await bump(env, corroborated ? 'ai-outcome:confirmed' : 'ai-outcome:judged');
    return { status: 200, body: toValue(row, false) };
  } catch (error) {
    if (error instanceof VendorError) return fallback({ status: 502, code: 'upstream_failed' });
    throw error;
  } finally {
    await releaseLock(env, handle);
  }
}
