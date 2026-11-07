/**
 * Cloudflare Workers AI（经 AI Gateway）判定 provider。
 *
 * 默认模型 `typesafe/jev-1.14.0`：Jev 是第三方模型，Worker 里用 `env.AI` 绑定调，Cloudflare
 * 负责凭据与计费（AI Gateway Unified Billing 预付费 credits，价格 $0.042/百万输入 token），
 * 不再需要维护 TypeSafe 直连 key。`@cf/cloudflare/clef-flash` 这类自家决策模型也走同一个
 * provider（body 里要多带一遍短模型名，见 requestBody），可用 AI_JUDGE_PROVIDERS 配成兜底。
 *
 * 隐私：判定正文只发给模型，不写 AI Gateway 日志（collectLog: false），也不带 handle。
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
 * Jev 在 Workers AI 上的模型 id。
 * `typesafe/jev` 是浮动别名（当前 1.13），要 1.14 必须显式写版本，否则升级不可预期。
 */
export const DEFAULT_JUDGE_MODEL = 'typesafe/jev-1.14.0';
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
      try {
        json = (await ai.run(model, requestBody(model, input), {
          gateway: {
            id: gatewayId(env),
            requestTimeoutMs: REQUEST_TIMEOUT_MS,
            // 判定正文是用户可见内容：不落 AI Gateway 日志（Cloudflare 侧不留 prompt）
            collectLog: false,
            // 只对瞬时错误重试一次；最终失败由熔断记一次
            retries: { maxAttempts: 2, backoff: 'linear', retryDelayMs: 300 },
          },
        })) as Record<string, unknown>;
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
