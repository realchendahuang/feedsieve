/**
 * AI 号判定的外部入口：TikHub（拉账号最近回复）与模型网关（账号级判定）。
 *
 * 判定模型不再写死在 TypeSafe 直连：默认走 Cloudflare Workers AI 的 `@cf/cloudflare/clef`
 * （经 AI Gateway，见 ./providers/workers-ai.ts），可通过 AI_JUDGE_PROVIDERS 切换/追加其他
 * Jev 或决策类模型。熔断状态存 meta 表（与 prober 同模式），连续失败后暂停一段时间。
 */
import { recordVendor, VendorError } from './breaker';
import questionFile from './question.json';
import type { VendorTimeline } from './evidence';

export { VendorError, recordVendor, vendorOpen } from './breaker';
export { judgeAccount } from './providers';
export type { JudgeResult } from './providers';

export const AI_QUESTION_VERSION = questionFile.version;

const TIKHUB_URL = 'https://api.tikhub.io/api/v1/twitter/web/fetch_user_tweet_replies';
const REQUEST_TIMEOUT_MS = 15_000;

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
