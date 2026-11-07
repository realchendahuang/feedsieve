/**
 * AI 判定模型的 provider 契约。
 *
 * 判定只有一件事：把「同一个账号最近的回复 + 回复间隔」交给一个模型，拿回 `ai_account` 的
 * `noul` 概率（0–1，越大越像 AI 代写）。所以 provider 只要实现 judge()，具体走 Workers AI
 * 绑定、AI Gateway 还是第三方 HTTP 由各自模块决定；加新供应商 = 新增一个 provider 文件 +
 * 在 registry 里注册一个配置名，判定/缓存/熔断/额度这些业务逻辑都不用动。
 */
import type { ReplyEvidence } from '../evidence';

export interface JudgeInput {
  replies: ReplyEvidence[];
  gaps: number[];
}

export interface JudgeResult {
  /** ai_account 问题的 noul 概率（0–1） */
  score: number;
  /** 模型版本标识（写进判定行 model 列；provider 没给版本时用模型 id） */
  model: string | null;
  /** 本次输入 token（没有就 0；只用于观测） */
  tokens: number;
  /** 实际干活的 provider（日志/排障用） */
  provider: string;
}

export interface JudgeProvider {
  /** 配置里写的名字，例如 workers-ai / typesafe-direct */
  readonly id: string;
  /** 熔断键：同一模型共用一把闸，失败不会连坐别的 provider */
  readonly vendor: string;
  /** 模型标识（默认值来自部署配置，写进日志） */
  readonly model: string;
  /** 当前部署是否具备调用条件（binding / key 是否配好） */
  available(env: Cloudflare.Env): boolean;
  judge(env: Cloudflare.Env, input: JudgeInput): Promise<JudgeResult>;
}

/**
 * 从模型返回的 JSON 里读 `answers.ai_account.noul`。
 * Jev（第三方）和 Clef（Cloudflare 自家）的 noul 问题返回结构一致；读不出合法概率返回 null，
 * 由 provider 记为一次失败（熔断），避免把坏数据写进判定表。
 */
export function noulScore(json: unknown): number | null {
  const answers = (json as { answers?: { ai_account?: { noul?: unknown } } } | null)?.answers;
  const score = answers?.ai_account?.noul;
  if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 1) return null;
  return score;
}

/** 读取模型返回的版本号与输入 token（字段缺失时给安全默认值）。 */
export function usageOf(json: unknown): { model: string | null; tokens: number } {
  const value = json as { model?: unknown; usage?: { input_tokens?: unknown } } | null;
  return {
    model: typeof value?.model === 'string' && value.model ? value.model : null,
    tokens:
      typeof value?.usage?.input_tokens === 'number' &&
      Number.isFinite(value.usage.input_tokens) &&
      value.usage.input_tokens >= 0
        ? value.usage.input_tokens
        : 0,
  };
}

/** 抛错对象不一定带 status：能读到数字就用，读不到按 0（网络/未知）记。 */
export function errorStatus(error: unknown): number {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' && Number.isFinite(status) ? status : 0;
}
