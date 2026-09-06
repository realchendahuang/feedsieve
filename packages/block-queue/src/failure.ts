/**
 * 失败分类 + 重试节奏（自适应）。
 *
 * 分类决定恢复语义：
 * - transient  —— 限流/网络/5xx：单任务按指数退避重试（含 Retry-After），不阻塞队列其它任务
 * - pause      —— 认证失效 / 缺 CSRF / 官方暂停：整个队列暂停，等用户重登或开关解除
 * - permanent  —— 目标不存在 / 永久 4xx：单任务判死
 * - unsupported—— 端点被移除（404/405/410）：X 侧结构性变化，停止并提示版本兼容问题
 */

export const PACE_FLOOR_MS = 400;
/** transient 任务最多自动重试次数（含首次执行后的重试）。 */
export const MAX_TRANSIENT_ATTEMPTS = 3;
const MAX_BACKOFF_MS = 15_000;
const JITTER_RATIO = 0.2;

export type FailureClass = 'transient' | 'pause' | 'permanent' | 'unsupported';

export interface FailureInfo {
  code: string;
  httpStatus?: number;
}

export function classifyFailure(failure: FailureInfo): FailureClass {
  switch (failure.code) {
    case 'auth_required':
    case 'missing_csrf':
    case 'kill_switch':
      return 'pause';
    case 'rate_limited':
    case 'network_error':
      return 'transient';
    case 'http_error':
      if (failure.httpStatus !== undefined && failure.httpStatus >= 500) {
        return 'transient';
      }
      if (failure.httpStatus !== undefined && [404, 405, 410].includes(failure.httpStatus)) {
        return 'unsupported';
      }
      return 'permanent';
    default:
      // no-id / 其它业务失败码：不盲目重试
      return 'permanent';
  }
}

export function maxAttemptsForClass(failureClass: FailureClass): number {
  return failureClass === 'transient' ? MAX_TRANSIENT_ATTEMPTS : 1;
}

/**
 * 自适应退避：连续失败次数指数递增（400→800→1600…封顶 15s），
 * 尊重服务端 Retry-After，并注入 ±20% 抖动防 thundering herd。
 */
export function nextBackoffMs(consecutiveFailures: number, retryAfterMs?: number): number {
  const exponential = PACE_FLOOR_MS * 2 ** Math.min(Math.max(consecutiveFailures - 1, 0), 6);
  const base = Math.min(exponential, MAX_BACKOFF_MS);
  const delay = retryAfterMs !== undefined ? Math.max(retryAfterMs, PACE_FLOOR_MS) : base;
  const jitter = delay * JITTER_RATIO * Math.random();
  return Math.round(delay + jitter);
}