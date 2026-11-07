/**
 * Cloudflare Workers AI 判定 provider。
 *
 * 默认模型 `@cf/cloudflare/clef`（Cloudflare 自家的决策模型，27B）：直接走 Workers AI 计费，
 * 不经 AI Gateway 的第三方通道，也不需要预付费 credits 或 5% 手续费。
 * 也可以配 `@cf/cloudflare/clef-flash`（9B，更便宜更快、但评测分离度略差）。
 * 第三方模型（如 `typesafe/jev-1.14.0`）同样能走这里：会改经 AI Gateway，需要 credits。
 *
 * 隐私：判定正文只发给模型；第三方模型路径关闭 AI Gateway 日志（collectLog: false），正文不带 handle。
 */
import { recordVendor, VendorError } from '../breaker';
import questionFile from '../question.json';
import {
  errorStatus,
  noulScore,
  usageOf,
  type JudgeInput,
  type JudgeProvider,
  type JudgeResult,
} from './types';

/**
 * 默认判定模型：Cloudflare 自家的 Clef（27B，noul 决策模型）。
 * 2026-11-07 评测（247 个标注账号）：Clef AUC 0.936，重扫阈值后命中 20/33、误判真人 4/210；
 * clef-flash AUC 0.912（14/33）；clef-omni AUC 0.843，不适合这个任务。
 * 换第三方模型（如 typesafe/jev-1.14.0）时用 AI_JUDGE_MODEL 或 AI_JUDGE_PROVIDERS 覆盖。
 */
export const DEFAULT_JUDGE_MODEL = '@cf/cloudflare/clef';
/** 第三方模型必须经 AI Gateway；`default` 网关在首次认证请求时自动创建。 */
export const DEFAULT_AI_GATEWAY_ID = 'default';
const REQUEST_TIMEOUT_MS = 15_000;

function gatewayId(env: Cloudflare.Env): string {
  return env.AI_GATEWAY_ID?.trim() || DEFAULT_AI_GATEWAY_ID;
}

/**
 * 请求体：state 只有回复与回复间隔，questions 是仓库里唯一的 question.json。
 * Jev 不接受未知字段；Clef 系列要求 body 里再写一遍短模型名（`clef-flash`）。
 */
export function requestBody(model: string, input: JudgeInput): Record<string, unknown> {
  const state = {
    replies: input.replies.map(({ parent, text }) => ({ parent, text })),
    reply_gaps_seconds: input.gaps,
  };
  const questions = questionFile.questions;
  if (model.startsWith('@cf/cloudflare/clef')) {
    return { model: model.split('/').pop() ?? model, state, questions };
  }
  return { state, questions };
}

export function createWorkersAiProvider(model = DEFAULT_JUDGE_MODEL): JudgeProvider {
  const id = `workers-ai:${model}`;
  const vendor = id;
  return {
    id,
    vendor,
    model,
    available: (env) => !!env.AI,
    async judge(env, input): Promise<JudgeResult> {
      const ai = env.AI;
      if (!ai) {
        // registry 会过滤掉不可用的 provider；这里兜底，避免空绑定静默变成 0 分
        throw new VendorError(vendor, 0);
      }
      let json: Record<string, unknown>;
      const body = requestBody(model, input);
      try {
        // Cloudflare 自家模型（@cf/*）直连 Workers AI：不经 AI Gateway，不进第三方 credits 计费，
        // 也没有网关的 200 次/分钟限流。只有第三方模型（如 typesafe/jev-1.14.0）才必须经网关。
        if (model.startsWith('@cf/')) {
          json = (await ai.run(model, body)) as Record<string, unknown>;
        } else {
          json = (await ai.run(model, body, {
            gateway: {
              id: gatewayId(env),
              requestTimeoutMs: REQUEST_TIMEOUT_MS,
              // 判定正文是用户可见内容：不落 AI Gateway 日志（Cloudflare 侧不留 prompt）
              collectLog: false,
              // 只对瞬时错误重试一次；最终失败由熔断记一次
              retries: { maxAttempts: 2, backoff: 'linear', retryDelayMs: 300 },
            },
          })) as Record<string, unknown>;
        }
      } catch (error) {
        await recordVendor(env, vendor, false);
        throw new VendorError(vendor, errorStatus(error));
      }
      const score = noulScore(json);
      if (score === null) {
        // 200 但结构不对（模型改名/返回格式变了）：按失败记，别把坏数据写进判定表
        await recordVendor(env, vendor, false);
        throw new VendorError(vendor, 0);
      }
      await recordVendor(env, vendor, true);
      const usage = usageOf(json);
      return { score, model: usage.model ?? model, tokens: usage.tokens, provider: id };
    },
  };
}
