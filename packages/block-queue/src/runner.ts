/**
 * 持久化队列 runner：唯一执行状态机。
 *
 * 状态迁移、失败分类、自适应节奏、恢复语义只有这一套（供扩展注入持久化适配器）。
 * runner 不关心 X 具体动作 —— perform 由宿主提供，结果按 failure.ts 分类。
 *
 * 特性：
 * - transient 失败按任务退避重试（指数退避 + Retry-After + 抖动）；串行执行，
 *   单个任务退避期间后续任务顺延（换并发前先确认 X 侧风控接受）
 * - pause 失败暂停队列（认证失效 / 官方暂停 / 安全额度用尽），等用户重登、开关解除或手动继续
 * - permanent / unsupported 单任务判死
 * - 成功后按注入节奏休眠（successPaceMs，默认 400ms），宿主可给「base + 抖动」防固定节拍
 * - 每次迭代重新 load；所有等待均分片（≤250ms/片），pause/cancel 最迟一片内生效
 * - 存储写入前复核队列仍 running：宿主在执行 / 等待期间暂停不会被旧数据覆盖
 * - 宿主动作 / 存储读写异常不逃逸：perform 抛错按瞬时失败分类，存储故障放弃本次写
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

  // perform 是主风险面：网络/会话失败已结构化，但 DOM / 页面异常仍可能裸抛。
  // 一律按瞬时网络失败走统一分类退避，任务不会卡死在 running。
  const perform = async (task: T): Promise<QueueRunOutcome> => {
    try {
      return await options.perform(task);
    } catch {
      return { ok: false, code: 'network_error' };
    }
  };
  const load = async (): Promise<QueueSession<T> | null> => {
    try {
      return await options.load();
    } catch {
      // storage 读故障：按「会话不可用」处理，本轮放弃
      return null;
    }
  };
  /** 写前复核：宿主可能在执行 / 等待期间暂停了队列（load 能感知到，
   *  但直接把内存里的旧 session 写回会覆盖宿主刚写下的 paused）。
   *  返回 false = 队列已非 running（或存储不可读），放弃写入并让 runner 退出。 */
  const save = async (session: QueueSession<T>): Promise<boolean> => {
    const fresh = await load();
    if (!fresh || fresh.status !== 'running') {
      return false;
    }
    try {
      await options.save(session);
    } catch {
      // storage 写故障：放弃本次写；任务保持 running，下次启动按 at-least-once 重做
    }
    return true;
  };
  /** 分片等待：每片醒来复核队列仍 running，宿主 pause/cancel 最迟一片（≤250ms）生效。 */
  const sleepSliced = async (totalMs: number): Promise<boolean> => {
    let remaining = Math.max(0, totalMs);
    while (remaining > 0) {
      await sleep(Math.min(remaining, SLEEP_SLICE_MS));
      remaining -= SLEEP_SLICE_MS;
      const fresh = await load();
      if (!fresh || fresh.status !== 'running') {
        return false;
      }
    }
    return true;
  };

  for (;;) {
    const session = await load();
    if (!session || session.status !== 'running') {
      return;
    }
    const task = session.tasks.find(
      (candidate) => candidate.status === 'pending' || candidate.status === 'running',
    );
    if (!task) {
      session.status = 'completed';
      delete session.pauseReason;
      if (!(await save(session))) {
        return;
      }
      return;
    }

    task.status = 'running';
    if (!(await save(session))) {
      return;
    }

    const startedAt = now();
    const outcome = await perform(task);
    const latency = Math.max(0, now() - startedAt);

    const reloaded = await load();
    if (!reloaded) {
      // 存储消失（用户清理数据等）：不把旧 session 写回复活任务，直接中止
      return;
    }
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
      delete current.lastHttpStatus;
      delete current.retryAt;
      delete current.retryAfterMs;
      delete reloaded.pauseReason;
      if (!(await save(reloaded))) {
        return;
      }
      if (options.onSuccess) {
        try {
          await options.onSuccess(task);
        } catch {
          // 收尾副作用失败不影响已成功的任务状态
        }
      }
      if (!(await sleepSliced(successPaceMs()))) {
        return;
      }
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
      if (!(await save(reloaded))) {
        return;
      }
      return;
    }

    if (
      failureClass === 'transient' &&
      (current.attempts ?? 0) < maxAttemptsForClass(failureClass)
    ) {
      current.status = 'pending';
      current.retryAt = now() + nextBackoffMs(current.attempts, outcome.retryAfterMs);
      if (!(await save(reloaded))) {
        return;
      }
      // 分片等到 retryAt（期间每片复核，pause/cancel 立即生效）
      if (!(await sleepSliced((current.retryAt ?? now()) - now()))) {
        return;
      }
      continue;
    }

    // permanent / unsupported / transient 次数耗尽
    current.status = 'failed';
    if (!(await save(reloaded))) {
      return;
    }
    if (!(await sleepSliced(PACE_FLOOR_MS))) {
      return;
    }
  }
}