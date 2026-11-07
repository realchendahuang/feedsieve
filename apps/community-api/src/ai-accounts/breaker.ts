/**
 * 外部模型供应商的熔断闸。
 *
 * AI 号判定的供应商（TikHub、Workers AI 里的每个模型、TypeSafe 直连）共用这一套：
 * 连续失败 BREAKER_TRIP 次就暂停 BREAKER_COOLDOWN_MS，避免故障时持续计费重试。
 * 状态存 meta 表（与 prober 同模式），键是 `vendor_breaker:<vendor>`；成功一次即清零。
 */
import { eq, sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import { meta } from '../db/schema';

export const BREAKER_TRIP = 5;
export const BREAKER_COOLDOWN_MS = 30 * 60 * 1000;

/** 外部供应商调用失败：vendor 是熔断键，status 0 表示网络错误 / 超时 / 无法识别。 */
export class VendorError extends Error {
  constructor(
    readonly vendor: string,
    readonly status: number,
  ) {
    super(`${vendor}_failed_${status}`);
  }
}

interface BreakerState {
  disabled_until?: number;
  consecutive_failures?: number;
}

const breakerKey = (vendor: string) => `vendor_breaker:${vendor}`;

async function readBreaker(env: Cloudflare.Env, vendor: string): Promise<BreakerState> {
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

async function writeBreaker(env: Cloudflare.Env, vendor: string, state: BreakerState) {
  await getDb(env)
    .insert(meta)
    .values({ key: breakerKey(vendor), value: JSON.stringify(state) })
    .onConflictDoUpdate({ target: meta.key, set: { value: sql`excluded.value` } });
}

export async function vendorOpen(
  env: Cloudflare.Env,
  vendor: string,
  now = Date.now(),
): Promise<boolean> {
  const state = await readBreaker(env, vendor);
  return !(state.disabled_until && state.disabled_until > now);
}

export async function recordVendor(
  env: Cloudflare.Env,
  vendor: string,
  ok: boolean,
): Promise<void> {
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
