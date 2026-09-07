/**
 * 持久化队列 runner：唯一执行状态机。
 *
 * 状态迁移、失败分类、自适应节奏、恢复语义只有这一套（供扩展注入持久化适配器）。
 * runner 不关心 X 具体动作 —— perform 由宿主提供，结果按 failure.ts 分类。
 *
 * 特性：
 * - transient 失败按任务退避重试（指数退避 + Retry-After + 抖动），不暂停整个队列
 * - pause 失败暂停队列（认证失效 / 官方暂停 / 安全额度用尽），等用户重登、开关解除或手动继续
 * - permanent / unsupported 单任务判死
 * - 成功后按注入节奏休眠（successPaceMs，默认 400ms），宿主可给「base + 抖动」防固定节拍
 * - 每次迭代重新 load：pause/cancel/页面刷新都能安全中断
 * - 短 sleep 分片：暂停/取消在 ≤250ms 内生效
 */

import { classifyFailure, maxAttemptsForClass, nextBackoffMs, PACE_FLOOR_MS } from './failure';

export interface TaskRunRecord {
  handle: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'cancelled';
  attempts?: number;
  lastErrorCode?: string;
  lastHttpStatus?: number;
  lastLatencyMs?: number;
  retryAt?: number;
  retryAfterMs?: number;
}

export interface QueueSession<T extends TaskRunRecord> {
  status: 'running' | 'paused' | 'completed' | 'cancelled';
  tasks: T[];
  /** 最近一次暂停原因（如 quota_exhausted / auth_required / user），host 侧可读 */
  pauseReason?: string;
}

export type QueueRunOutcome =
  | { ok: true }
  | { ok: false; code: string; httpStatus?: number; retryAfterMs?: number };

export interface QueueRunnerOptions<T extends TaskRunRecord> {
  load(): Promise<QueueSession<T> | null>;
  save(session: QueueSession<T>): Promise<void>;
  /** 实际执行一个任务（响应式动作由宿主实现）。 */
  perform(task: T): Promise<QueueRunOutcome>;
  /** 成功收尾（宿主侧页面副作用等），在任务标记 success 之后调用。 */
  onSuccess?(task: T): Promise<void> | void;
  /** 成功后相邻任务间隔（ms）——供宿主注入「base + 抖动」节奏；默认 PACE_FLOOR_MS。 */
  successPaceMs?(): number;
  now?(): number;
  sleep?(ms: number): Promise<void>;
}

// 纯逻辑包不依赖 DOM/node 类型；运行时宿主（浏览器 SW / Node 测试）都提供 setTimeout
declare function setTimeout(handler: () => void, timeout?: number): number;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 调度分片：每次等待至多这么长，便于期间收到 pause/cancel 立即生效。 */
const SLEEP_SLICE_MS = 250;

export async function runQueuedBlocks<T extends TaskRunRecord>(
  options: QueueRunnerOptions<T>,
): Promise<void> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const successPaceMs = options.successPaceMs ?? (() => PACE_FLOOR_MS);

  for (;;) {
    const session = await options.load();
    if (!session || session.status !== 'running') {
      return;
    }
    const task = session.tasks.find(
      (candidate) => candidate.status === 'pending' || candidate.status === 'running',
    );
    if (!task) {
      session.status = 'completed';
      delete session.pauseReason;
      await options.save(session);
      return;
    }

    task.status = 'running';
    await options.save(session);

    const startedAt = now();
    const outcome = await options.perform(task);
    const latency = Math.max(0, now() - startedAt);

    const reloaded = (await options.load()) ?? session;
    const current = reloaded.tasks.find((candidate) => candidate.handle === task.handle);
    if (!current) {
      // 等待期间任务被移除/取消：直接进入下一轮，不重写状态
      continue;
    }

    current.attempts = (current.attempts ?? 0) + 1;
    current.lastLatencyMs = latency;
    if (outcome.ok) {
      current.status = 'success';
      delete current.lastErrorCode;
      delete current.retryAt;
      delete current.retryAfterMs;
      delete reloaded.pauseReason;
      await options.save(reloaded);
      if (options.onSuccess) {
        await options.onSuccess(task);
      }
      await sleep(successPaceMs());
      continue;
    }

    current.lastErrorCode = outcome.code;
    if (outcome.httpStatus !== undefined) {
      current.lastHttpStatus = outcome.httpStatus;
    }
    if (outcome.retryAfterMs !== undefined) {
      current.retryAfterMs = outcome.retryAfterMs;
    }
    const failureClass = classifyFailure({ code: outcome.code, httpStatus: outcome.httpStatus });

    if (failureClass === 'pause') {
      // 认证失效 / 缺 CSRF / 官方暂停 / 安全额度用尽：整队列暂停，等重登、开关解除或手动继续
      current.status = 'pending';
      reloaded.status = 'paused';
      reloaded.pauseReason = outcome.code;
      await options.save(reloaded);
      return;
    }

    if (
      failureClass === 'transient' &&
      (current.attempts ?? 0) < maxAttemptsForClass(failureClass)
    ) {
      current.status = 'pending';
      current.retryAt = now() + nextBackoffMs(current.attempts, outcome.retryAfterMs);
      await options.save(reloaded);
      // 分片等到 retryAt（期间可被 pause/cancel 打断）
      for (;;) {
        const remaining = (current.retryAt ?? now()) - now();
        if (remaining <= 0) break;
        await sleep(Math.min(remaining, SLEEP_SLICE_MS));
      }
      continue;
    }

    // permanent / unsupported / transient 次数耗尽
    current.status = 'failed';
    await options.save(reloaded);
    await sleep(PACE_FLOOR_MS);
  }
}