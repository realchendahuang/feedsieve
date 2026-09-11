/**
 * 持久拉黑队列的 tab 侧生命周期监管器（从 content.ts 抽出，行为零变化）。
 *
 * 职责：runner 持有权（本 tab 与其它 tab 区分）、owner 心跳、resume 的跨 tab
 * 双执行防御、孤儿 running 状态的降级复查。状态改写语义拆成纯函数
 * （decideOrphanPause / applyResumeMutations / applyUserPause / applyCancel）
 * 以便单测；跨 tab 判定复用 block-queue-store 的 decideQueueResume。
 *
 * 行为契约（与抽取前完全一致，改这里前先对照 content.ts 历史注释）：
 * - 心跳键 `blockQueueHeartbeatAt`：owner 每 3s 写一次；TTL 15s，超时视为
 *   owner 已消失（页面刷新会中断正在发出的请求）。
 * - 只有确认 owner 心跳停摆才把孤儿 running 降为 paused，避免误伤其它 tab
 *   正在执行的队列、也避免 popup 误报「仍在运行」。
 * - allowReschedule 仅启动调用为真：owner 恰好在心跳窗口内刷新时，靠
 *   「新页面启动必然重新走本函数」覆盖，定时复查本身不再自续，避免常驻轮询。
 */

import {
  decideQueueResume,
  type PersistentBlockQueueState,
} from './block-queue-store';

/** 队列 owner 心跳键：运行中每 QUEUE_HEARTBEAT_INTERVAL_MS 写一次。 */
export const QUEUE_HEARTBEAT_KEY = 'blockQueueHeartbeatAt';
/** 心跳超过该时长视为 owner 已消失（页面刷新 / 关闭）。 */
export const QUEUE_HEARTBEAT_TTL_MS = 15_000;
/** owner 心跳写入间隔。 */
export const QUEUE_HEARTBEAT_INTERVAL_MS = 3000;

/** 旧版本遗留的 retryable failed 任务（升级前已判死）resume 时放回 pending。 */
const RESUME_RETRYABLE_FAILURE_CODES = [
  'rate_limited',
  'auth_required',
  'missing_csrf',
  'network_error',
  'kill_switch',
];

export interface OrphanPauseDecision {
  pause: boolean;
  /** 非 null 时调用方应在该毫秒后复查一次（owner 心跳尚未过期的启动路径）。 */
  rescheduleAfterMs: number | null;
}

/**
 * 纯判定：心跳新鲜 = owner 大概率活着（比如我只是新开的 tab），不降级、
 * 延迟复查；心跳停摆 / 缺失 / 非数字（防御）= 真孤儿，降级为 paused。
 */
export function decideOrphanPause(
  heartbeatAt: unknown,
  now: number,
  ttlMs: number,
): OrphanPauseDecision {
  if (
    typeof heartbeatAt === 'number' &&
    Number.isFinite(heartbeatAt) &&
    now - heartbeatAt < ttlMs
  ) {
    // owner 也可能恰好此刻刷新/关闭（心跳还没过期）：启动路径延迟到过期后再复查一次。
    return { pause: false, rescheduleAfterMs: ttlMs + 1_000 };
  }
  return { pause: true, rescheduleAfterMs: null };
}

/**
 * 纯变更：resume 的队列状态改写（原 resumePersistentQueue 内联逻辑）。
 * 原地改写并返回同一状态。调用方负责先把 status 置为 running 并落盘。
 */
export function applyResumeMutations(state: PersistentBlockQueueState): void {
  // 额度用尽的暂停由用户显式放行：本轮不再因额度停队（友情提醒模式）。
  // 其它暂停原因（认证失效 / 429 风暴 / 手动）不解除额度门控语义。
  if (state.pauseReason === 'quota_exhausted') {
    state.quotaOverride = true;
  }
  delete state.pauseReason;
  for (const task of state.tasks) {
    if (task.status === 'running') task.status = 'pending';
    // 用户显式 resume：清掉退避计时，立即重试
    if (task.status === 'pending') {
      delete task.retryAt;
      delete task.retryAfterMs;
    }
    if (
      task.status === 'failed' &&
      RESUME_RETRYABLE_FAILURE_CODES.includes(task.failureCode ?? '')
    ) {
      task.status = 'pending';
      delete task.failureCode;
      delete task.retryAt;
      delete task.retryAfterMs;
    }
  }
}

/** 纯变更：用户显式暂停（popup 暂停按钮语义，pauseReason 记为 user）。 */
export function applyUserPause(state: PersistentBlockQueueState): void {
  state.status = 'paused';
  state.pauseReason = 'user';
}

/** 纯变更：用户取消：pending/running 全部取消，success/failed 保留终态。 */
export function applyCancel(state: PersistentBlockQueueState): void {
  state.status = 'cancelled';
  for (const task of state.tasks) {
    if (task.status === 'pending' || task.status === 'running') task.status = 'cancelled';
  }
}

export interface QueueSupervisorTimers {
  setInterval: (fn: () => void, ms: number) => ReturnType<typeof setInterval>;
  clearInterval: (handle: ReturnType<typeof setInterval>) => void;
  setTimeout: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (handle: ReturnType<typeof setTimeout>) => void;
}

export interface QueueSupervisorDeps {
  load: () => Promise<PersistentBlockQueueState | null>;
  save: (state: PersistentBlockQueueState) => Promise<void>;
  readHeartbeat: () => Promise<unknown>;
  writeHeartbeat: (at: number) => void;
  /** 真实队列执行体（content script 注入 executePersistentQueue）。 */
  runExecutor: () => Promise<void>;
  now?: () => number;
  timers?: QueueSupervisorTimers;
}

const defaultTimers: QueueSupervisorTimers = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (handle) => clearInterval(handle),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle),
};

export interface QueueSupervisor {
  /** 孤儿降级复查（allowReschedule 仅启动路径为真，见模块注释）。 */
  pauseOrphaned(allowReschedule?: boolean): Promise<void>;
  /** popup 恢复按钮：跨 tab 双执行防御后 adopt（协议返回值与抽取前一致）。 */
  resume(): Promise<{ status: string }>;
  /** popup 暂停按钮。 */
  pauseByUser(): Promise<{ status: 'paused' | 'absent' }>;
  /** popup 取消按钮。 */
  cancel(): Promise<{ status: 'cancelled' | 'absent' }>;
  /** 启动本 tab runner（幂等；心跳与持有标记随 runner 生命周期启停）。 */
  run(): Promise<void>;
}

export function createQueueSupervisor(deps: QueueSupervisorDeps): QueueSupervisor {
  const now = deps.now ?? Date.now;
  const timers = deps.timers ?? defaultTimers;
  /** 本 tab runner 的执行 Promise（幂等入队）；null = 本 tab 未在跑。 */
  let running: Promise<void> | null = null;
  /** 本 tab 持有 runner 期间为真：decideQueueResume 用它区分「我在跑」与「其它 tab 在跑」。 */
  let ownedByThisTab = false;

  async function run(): Promise<void> {
    if (running) return running;
    ownedByThisTab = true;
    const beat = (): void => {
      deps.writeHeartbeat(Date.now());
    };
    beat();
    const heartbeat = timers.setInterval(beat, QUEUE_HEARTBEAT_INTERVAL_MS);
    running = deps
      .runExecutor()
      .catch(() => {
        // 执行体内部已把异常归类成任务状态；这里只保证持有标记复位
      })
      .finally(() => {
        timers.clearInterval(heartbeat);
        running = null;
        ownedByThisTab = false;
      });
    return running;
  }

  async function pauseOrphaned(allowReschedule = false): Promise<void> {
    const state = await deps.load();
    if (!state || state.status !== 'running') return;
    const heartbeat = await deps.readHeartbeat();
    const decision = decideOrphanPause(heartbeat, now(), QUEUE_HEARTBEAT_TTL_MS);
    if (!decision.pause) {
      if (allowReschedule && decision.rescheduleAfterMs !== null) {
        timers.setTimeout(() => {
          void pauseOrphaned(false);
        }, decision.rescheduleAfterMs);
      }
      return;
    }
    state.status = 'paused';
    for (const task of state.tasks) {
      if (task.status === 'running') task.status = 'pending';
    }
    await deps.save(state);
  }

  async function resume(): Promise<{ status: string }> {
    const state = await deps.load();
    if (!state) return { status: 'absent' };
    // 跨 tab 双执行防御：resume 消息由 popup 路由到活动 tab。若其它 tab 的
    // runner 心跳新鲜，本 tab 绝不能把 owner 的 running 任务重置为 pending
    // 再开第二个 runner（同一任务双执行、写状态互踩）。
    const heartbeat = await deps.readHeartbeat();
    if (
      decideQueueResume(
        state.status,
        heartbeat,
        now(),
        QUEUE_HEARTBEAT_TTL_MS,
        ownedByThisTab,
      ) === 'already-running'
    ) {
      // 队列确实在跑（别的 tab）：对 popup 返回 running（协议语义不变），但不启动
      return { status: 'running' };
    }
    state.status = 'running';
    applyResumeMutations(state);
    await deps.save(state);
    void run();
    return { status: 'running' };
  }

  async function pauseByUser(): Promise<{ status: 'paused' | 'absent' }> {
    const state = await deps.load();
    if (!state) return { status: 'absent' };
    applyUserPause(state);
    await deps.save(state);
    return { status: 'paused' };
  }

  async function cancel(): Promise<{ status: 'cancelled' | 'absent' }> {
    const state = await deps.load();
    if (!state) return { status: 'absent' };
    applyCancel(state);
    await deps.save(state);
    return { status: 'cancelled' };
  }

  return { pauseOrphaned, resume, pauseByUser, cancel, run };
}
