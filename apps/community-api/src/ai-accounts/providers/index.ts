/**
 * AI 判定模型网关：按部署配置给出一条 provider 顺序，逐个试，谁先成功用谁。
 *
 * 配置：`AI_JUDGE_PROVIDERS` 逗号分隔，默认 `workers-ai`。
 *   workers-ai                  → Cloudflare Workers AI，模型取 AI_JUDGE_MODEL（默认 typesafe/jev-1.14.0）
 *   workers-ai:<model id>       → 指定 Workers AI 模型（例如 workers-ai:@cf/cloudflare/clef-flash）
 *   typesafe-direct             → TypeSafe 直连，需要 TYPESAFE_API_KEY（默认不启用）
 *
 * 每个 provider 有独立的熔断闸；某个挂了自动轮到下一个，全挂才抛 VendorError（接口返回 502）。
 * 加新供应商：实现 providers/types.ts 的 JudgeProvider，在 providerForSpec 里加一个分支即可。
 */
import { vendorOpen, VendorError } from '../breaker';
import { DEFAULT_JUDGE_MODEL, createWorkersAiProvider } from './workers-ai';
import { createTypesafeDirectProvider } from './typesafe-direct';
import type { JudgeInput, JudgeProvider, JudgeResult } from './types';

export const DEFAULT_PROVIDER_SPEC = 'workers-ai';

function providerForSpec(env: Cloudflare.Env, spec: string): JudgeProvider | null {
  if (spec === 'workers-ai') {
    return createWorkersAiProvider(env.AI_JUDGE_MODEL?.trim() || DEFAULT_JUDGE_MODEL);
  }
  if (spec.startsWith('workers-ai:')) {
    const model = spec.slice('workers-ai:'.length).trim();
    return model ? createWorkersAiProvider(model) : null;
  }
  if (spec === 'typesafe-direct') return createTypesafeDirectProvider();
  console.warn(`[community-api] 忽略未知的 AI 判定 provider：${spec}`);
  return null;
}

/** 按部署配置解析 provider 顺序（去重、跳过无法识别的项）。 */
export function parseJudgeProviders(env: Cloudflare.Env): JudgeProvider[] {
  const specs = (env.AI_JUDGE_PROVIDERS ?? '')
    .split(',')
    .map((spec) => spec.trim())
    .filter(Boolean);
  const list = specs.length ? specs : [DEFAULT_PROVIDER_SPEC];
  const seen = new Set<string>();
  const providers: JudgeProvider[] = [];
  for (const spec of list) {
    const provider = providerForSpec(env, spec);
    if (!provider || seen.has(provider.id)) continue;
    seen.add(provider.id);
    providers.push(provider);
  }
  return providers;
}

export type JudgeAvailability = 'ready' | 'unavailable' | 'paused';

/**
 * 判定链路当前能不能接新活（在扣用户额度之前查）：
 * - unavailable：一个 provider 都没配好（缺 AI binding / 缺 key）→ 503 ai_check_unavailable
 * - paused：都配好了但熔断全开 → 503 ai_check_paused
 * - ready：至少有一个能试
 */
export async function judgeAvailability(
  env: Cloudflare.Env,
  now = Date.now(),
): Promise<JudgeAvailability> {
  const providers = parseJudgeProviders(env).filter((provider) => provider.available(env));
  if (!providers.length) return 'unavailable';
  const open = await Promise.all(
    providers.map((provider) => vendorOpen(env, provider.vendor, now)),
  );
  return open.some(Boolean) ? 'ready' : 'paused';
}

/**
 * 实际判定：按配置顺序调用，失败换下一个；全失败抛最后一个 VendorError。
 * 判定结果与 provider 无关（都是 ai_account.noul），所以调用方（judge/check）不用知道用的是谁。
 */
export async function judgeAccount(
  env: Cloudflare.Env,
  replies: JudgeInput['replies'],
  gaps: JudgeInput['gaps'],
): Promise<JudgeResult> {
  const providers = parseJudgeProviders(env).filter((provider) => provider.available(env));
  let lastError: VendorError | null = null;
  for (const provider of providers) {
    if (!(await vendorOpen(env, provider.vendor))) continue;
    try {
      return await provider.judge(env, { replies, gaps });
    } catch (error) {
      if (error instanceof VendorError) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }
  throw lastError ?? new VendorError('ai-judge', 0);
}

export type { JudgeInput, JudgeProvider, JudgeResult } from './types';
export { DEFAULT_JUDGE_MODEL };
