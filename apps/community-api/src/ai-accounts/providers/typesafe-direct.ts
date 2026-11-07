/**
 * TypeSafe 直连 provider（旧路径，默认不启用）。
 *
 * TypeSafe 的 Jev API 与 Workers AI 上的模型是同一个东西，但走他们自己的 `/v1/systemone`
 * 和账号 key。2026-11-06 起维护者的 TypeSafe 组织被停用，默认改走 Workers AI（见 workers-ai.ts）；
 * 这里保留是为了：① 其他部署方可以继续自带 TypeSafe key；② Workers AI 不可用时能配成第二顺位。
 * 只在 AI_JUDGE_PROVIDERS 里显式写 `typesafe-direct` 且配置了 TYPESAFE_API_KEY 时才可用。
 */
import { recordVendor, VendorError } from '../breaker';
import questionFile from '../question.json';
import {
  errorStatus,
  noulScore,
  usageOf,
  type JudgeProvider,
  type JudgeResult,
} from './types';

const TYPESAFE_URL = 'https://api.typesafe.ai/v1/systemone';
const REQUEST_TIMEOUT_MS = 15_000;

export function createTypesafeDirectProvider(): JudgeProvider {
  const vendor = 'typesafe';
  const model = 'jev-latest';
  return {
    id: 'typesafe-direct',
    vendor,
    model,
    available: (env) => !!env.TYPESAFE_API_KEY,
    async judge(env, input): Promise<JudgeResult> {
      const key = env.TYPESAFE_API_KEY;
      if (!key) throw new VendorError(vendor, 0);
      const body = JSON.stringify({
        model,
        state: {
          replies: input.replies.map(({ parent, text }) => ({ parent, text })),
          reply_gaps_seconds: input.gaps,
        },
        questions: questionFile.questions,
      });
      let response: Response;
      try {
        response = await fetch(TYPESAFE_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        await recordVendor(env, vendor, false);
        throw new VendorError(vendor, errorStatus(error));
      }
      const json = (await response.json().catch(() => null)) as unknown;
      const score = noulScore(json);
      if (!response.ok || score === null) {
        await recordVendor(env, vendor, false);
        throw new VendorError(vendor, response.status);
      }
      await recordVendor(env, vendor, true);
      const usage = usageOf(json);
      return { score, model: usage.model ?? model, tokens: usage.tokens, provider: 'typesafe-direct' };
    },
  };
}
