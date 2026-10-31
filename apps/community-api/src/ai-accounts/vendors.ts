/**
 * AI 号判定的两个第三方供应商：TikHub（拉账号最近回复）与 TypeSafe Jev（账号级判定）。
 * 只在 /v1/ai-accounts/check 未命中缓存时调用；每个账号各调用一次。
 * 供应商熔断状态存 meta 表（与 prober 同模式），连续失败后暂停一段时间，避免故障时持续计费重试。
 */
import { eq, sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import { meta } from '../db/schema';
import questionFile from './question.json';
import type { ReplyEvidence, VendorTimeline } from './evidence';

export const AI_QUESTION_VERSION = questionFile.version;

const TIKHUB_URL = 'https://api.tikhub.io/api/v1/twitter/web/fetch_user_tweet_replies';
const JEV_URL = 'https://api.typesafe.ai/v1/systemone';
const REQUEST_TIMEOUT_MS = 15_000;
const BREAKER_TRIP = 5;
const BREAKER_COOLDOWN_MS = 30 * 60 * 1000;

export type Vendor = 'tikhub' | 'typesafe';

export class VendorError extends Error {
  constructor(
    readonly vendor: Vendor,
    readonly status: number,
  ) {
    super(`${vendor}_failed_${status}`);
  }
}

interface BreakerState {
  disabled_until?: number;
  consecutive_failures?: number;
}

const breakerKey = (vendor: Vendor) => `vendor_breaker:${vendor}`;

async function readBreaker(env: Cloudflare.Env, vendor: Vendor): Promise<BreakerState> {
  const [row] = await getDb(env)
    .select({ value: meta.value })
    .from(meta)
    .where(eq(meta.key, breakerKey(vendor)));
  if (!row?.value) return {};
  try {
    return JSON.parse(row.value) as BreakerState;
  } catch {
    return {};
  }
}

async function writeBreaker(env: Cloudflare.Env, vendor: Vendor, state: BreakerState) {
  await getDb(env)
    .insert(meta)
    .values({ key: breakerKey(vendor), value: JSON.stringify(state) })
    .onConflictDoUpdate({ target: meta.key, set: { value: sql`excluded.value` } });
}

export async function vendorOpen(env: Cloudflare.Env, vendor: Vendor, now = Date.now()) {
  const state = await readBreaker(env, vendor);
  return !(state.disabled_until && state.disabled_until > now);
}

async function recordVendor(env: Cloudflare.Env, vendor: Vendor, ok: boolean) {
  const state = await readBreaker(env, vendor);
  if (ok) {
    if (state.consecutive_failures || state.disabled_until) await writeBreaker(env, vendor, {});
    return;
  }
  const failures = (state.consecutive_failures ?? 0) + 1;
  await writeBreaker(
    env,
    vendor,
    failures >= BREAKER_TRIP
      ? { disabled_until: Date.now() + BREAKER_COOLDOWN_MS, consecutive_failures: 0 }
      : { consecutive_failures: failures },
  );
  if (failures >= BREAKER_TRIP) console.warn(`[community-api] ${vendor} breaker opened (30m)`);
}

/** 拉账号最近一页回复（约 40 条，含它回复的原帖）。404 / 空时间线不算供应商故障。 */
export async function fetchUserReplies(
  env: Cloudflare.Env,
  handle: string,
): Promise<VendorTimeline> {
  const url = new URL(TIKHUB_URL);
  url.searchParams.set('screen_name', handle);
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${env.TIKHUB_API_KEY}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    await recordVendor(env, 'tikhub', false);
    throw new VendorError('tikhub', 0);
  }
  const json = (await response.json().catch(() => null)) as { data?: VendorTimeline } | null;
  if (!response.ok || !json?.data || !Array.isArray(json.data.timeline)) {
    await recordVendor(env, 'tikhub', false);
    throw new VendorError('tikhub', response.status);
  }
  await recordVendor(env, 'tikhub', true);
  return json.data;
}

export interface JevResult {
  score: number;
  model: string | null;
  tokens: number;
}

/** 账号级 Jev 判定：一次请求，state 只含回复与回复间隔。 */
export async function judgeAccount(
  env: Cloudflare.Env,
  replies: ReplyEvidence[],
  gaps: number[],
): Promise<JevResult> {
  const body = JSON.stringify({
    model: 'jev-latest',
    state: {
      replies: replies.map(({ parent, text }) => ({ parent, text })),
      reply_gaps_seconds: gaps,
    },
    questions: questionFile.questions,
  });
  let response: Response;
  try {
    response = await fetch(JEV_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.TYPESAFE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    await recordVendor(env, 'typesafe', false);
    throw new VendorError('typesafe', 0);
  }
  const json = (await response.json().catch(() => null)) as {
    model?: string;
    answers?: { ai_account?: { noul?: unknown } };
    usage?: { input_tokens?: number };
  } | null;
  const score = json?.answers?.ai_account?.noul;
  if (
    !response.ok ||
    typeof score !== 'number' ||
    !Number.isFinite(score) ||
    score < 0 ||
    score > 1
  ) {
    await recordVendor(env, 'typesafe', false);
    throw new VendorError('typesafe', response.status);
  }
  await recordVendor(env, 'typesafe', true);
  return { score, model: json?.model ?? null, tokens: json?.usage?.input_tokens ?? 0 };
}
