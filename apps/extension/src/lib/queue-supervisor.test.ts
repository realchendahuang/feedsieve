import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyCancel,
  applyResumeMutations,
  applyUserPause,
  createQueueSupervisor,
  decideOrphanPause,
  QUEUE_HEARTBEAT_TTL_MS,
  type QueueSupervisorDeps,
} from './queue-supervisor';
import type { PersistentBlockQueueState } from './block-queue-store';

const TTL = QUEUE_HEARTBEAT_TTL_MS;

function makeState(overrides: Partial<PersistentBlockQueueState> = {}): PersistentBlockQueueState {
  return {
    id: 'q1',
    source: 'page-batch',
    status: 'running',
    tasks: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('decideOrphanPause（纯判定）', () => {
  it('心跳新鲜：不降级，安排 TTL+1s 后复查一次', () => {
    const decision = decideOrphanPause(1_000, 1_000 + TTL - 1, TTL);
    expect(decision).toEqual({ pause: false, rescheduleAfterMs: TTL + 1_000 });
  });

  it('心跳停摆：降级，不安排复查', () => {
    expect(decideOrphanPause(1_000, 1_000 + TTL, TTL)).toEqual({
      pause: true,
      rescheduleAfterMs: null,
    });
    expect(decideOrphanPause(1_000, 1_000 + TTL + 5_000, TTL).pause).toBe(true);
  });

  it('心跳缺失 / 非数字 / NaN（防御）：按孤儿处理', () => {
    expect(decideOrphanPause(undefined, 1_000, TTL).pause).toBe(true);
    expect(decideOrphanPause('100', 1_000, TTL).pause).toBe(true);
    expect(decideOrphanPause(Number.NaN, 1_000, TTL).pause).toBe(true);
  });
});

describe('applyResumeMutations（纯变更）', () => {
  it('quota_exhausted 暂停 → 显式放行（quotaOverride）+ 清 pauseReason', () => {
    const state = makeState({ pauseReason: 'quota_exhausted' });
    applyResumeMutations(state);
    expect(state.quotaOverride).toBe(true);
    expect(state.pauseReason).toBeUndefined();
  });

  it('其它暂停原因只清 pauseReason，不解除额度门控', () => {
    const state = makeState({ pauseReason: 'user', quotaOverride: undefined });
    applyResumeMutations(state);
    expect(state.quotaOverride).toBeUndefined();
    expect(state.pauseReason).toBeUndefined();
  });

  it('running → pending；pending 清退避计时', () => {
    const state = makeState({
      tasks: [
        { handle: 'a', category: 'bot_spam', status: 'running', retryAt: 1, retryAfterMs: 2 },
        { handle: 'b', category: 'bot_spam', status: 'pending', retryAt: 3, retryAfterMs: 4 },
      ],
    });
    applyResumeMutations(state);
    expect(state.tasks[0]?.status).toBe('pending');
    expect(state.tasks[0]?.retryAt).toBeUndefined();
    expect(state.tasks[0]?.retryAfterMs).toBeUndefined();
    expect(state.tasks[1]?.status).toBe('pending');
    expect(state.tasks[1]?.retryAt).toBeUndefined();
    expect(state.tasks[1]?.retryAfterMs).toBeUndefined();
  });

  it('retryable failed 放回 pending 并清失败标记；非 retryable failed 保留终态', () => {
    const state = makeState({
      tasks: [
        { handle: 'a', category: 'bot_spam', status: 'failed', failureCode: 'rate_limited', retryAt: 1 },
        { handle: 'b', category: 'bot_spam', status: 'failed', failureCode: 'user' },
      ],
    });
    applyResumeMutations(state);
    expect(state.tasks[0]?.status).toBe('pending');
    expect(state.tasks[0]?.failureCode).toBeUndefined();
    expect(state.tasks[1]?.status).toBe('failed');
    expect(state.tasks[1]?.failureCode).toBe('user');
  });
});

describe('applyUserPause / applyCancel（纯变更）', () => {
  it('用户暂停：status paused + pauseReason user', () => {
    const state = makeState();
    applyUserPause(state);
    expect(state.status).toBe('paused');
    expect(state.pauseReason).toBe('user');
  });

  it('取消：pending/running 取消，success/failed 保留终态', () => {
    const state = makeState({
      tasks: [
        { handle: 'a', category: 'bot_spam', status: 'pending' },
        { handle: 'b', category: 'bot_spam', status: 'running' },
        { handle: 'c', category: 'bot_spam', status: 'success' },
        { handle: 'd', category: 'bot_spam', status: 'failed' },
      ],
    });
    applyCancel(state);
    expect(state.status).toBe('cancelled');
    expect(state.tasks.map((task) => task.status)).toEqual([
      'cancelled',
      'cancelled',
      'success',
      'failed',
    ]);
  });
});

describe('createQueueSupervisor', () => {
  let storage: Record<string, unknown>;
  let saved: PersistentBlockQueueState[];
  let releaseExecutor: (() => void) | null = null;

  function makeDeps(overrides: Partial<QueueSupervisorDeps> = {}): QueueSupervisorDeps {
    saved = [];
    return {
      load: vi.fn(async () => (storage['queue'] as PersistentBlockQueueState | undefined) ?? null),
      save: vi.fn(async (state: PersistentBlockQueueState) => {
        saved.push(structuredClone(state));
        storage['queue'] = structuredClone(state);
      }),
      readHeartbeat: vi.fn(async () => storage['hb']),
      writeHeartbeat: vi.fn((at: number) => {
        storage['hb'] = at;
      }),
      runExecutor: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            releaseExecutor = resolve;
          }),
      ),
      ...overrides,
    };
  }

  beforeEach(() => {
    storage = {};
    vi.useFakeTimers();
  });

  it('resume：队列不存在 → absent，不落盘不启动', async () => {
    const deps = makeDeps();
    const supervisor = createQueueSupervisor(deps);
    await expect(supervisor.resume()).resolves.toEqual({ status: 'absent' });
    expect(deps.save).not.toHaveBeenCalled();
    expect(deps.runExecutor).not.toHaveBeenCalled();
  });

  it('resume：其它 tab 心跳新鲜 → already-running（协议返回 running），绝不启动第二个 runner', async () => {
    storage['queue'] = makeState();
    storage['hb'] = 10_000;
    const deps = makeDeps({ now: () => 10_001 });
    const supervisor = createQueueSupervisor(deps);
    await expect(supervisor.resume()).resolves.toEqual({ status: 'running' });
    expect(deps.save).not.toHaveBeenCalled();
    expect(deps.runExecutor).not.toHaveBeenCalled();
  });

  it('resume：心跳停摆 → adopt：状态改写 + 落盘 + 启动 runner', async () => {
    storage['queue'] = makeState({
      status: 'paused',
      pauseReason: 'quota_exhausted',
      tasks: [{ handle: 'a', category: 'bot_spam', status: 'pending', retryAt: 1 }],
    });
    storage['hb'] = 1;
    const deps = makeDeps({ now: () => TTL + 10_000 });
    const supervisor = createQueueSupervisor(deps);
    await expect(supervisor.resume()).resolves.toEqual({ status: 'running' });
    expect(deps.save).toHaveBeenCalledTimes(1);
    const savedState = saved[0];
    expect(savedState?.status).toBe('running');
    expect(savedState?.quotaOverride).toBe(true);
    expect(savedState?.pauseReason).toBeUndefined();
    expect(savedState?.tasks[0]?.retryAt).toBeUndefined();
    expect(deps.runExecutor).toHaveBeenCalledTimes(1);
  });

  it('resume：本 tab 已持有 runner（心跳写所有权）→ adopt 语义与抽取前一致', async () => {
    storage['queue'] = makeState();
    storage['hb'] = 10_000;
    const deps = makeDeps({ now: () => 10_001 });
    const supervisor = createQueueSupervisor(deps);
    const firstRun = supervisor.run();
    // 本 tab 正在跑：resume 应 adopt（重置 running 任务）而不是 already-running
    storage['queue'] = makeState({ tasks: [{ handle: 'a', category: 'bot_spam', status: 'running' }] });
    await expect(supervisor.resume()).resolves.toEqual({ status: 'running' });
    expect(deps.save).toHaveBeenCalledTimes(1);
    expect(deps.runExecutor).toHaveBeenCalledTimes(1);
    releaseExecutor?.();
    await firstRun;
  });

  it('run：幂等；心跳立即写 + 周期写；结束后清理', async () => {
    storage['queue'] = makeState();
    let heartbeatWrites = 0;
    const deps = makeDeps({
      writeHeartbeat: vi.fn(() => {
        heartbeatWrites += 1;
      }),
    });
    const supervisor = createQueueSupervisor(deps);
    const first = supervisor.run();
    const second = supervisor.run();
    // run() 无前置 await：持有标记与立即心跳同步生效；并发 run 共享同一执行
    expect(deps.runExecutor).toHaveBeenCalledTimes(1);
    expect(heartbeatWrites).toBe(1); // 立即心跳
    await vi.advanceTimersByTimeAsync(3_000);
    expect(heartbeatWrites).toBe(2); // 3s 周期心跳
    releaseExecutor?.();
    await Promise.all([first, second]);
    expect(heartbeatWrites).toBe(2); // 结束后不再写
    // 结束后 resume 可以重新启动
    storage['queue'] = makeState({ status: 'paused' });
    await supervisor.resume();
    expect(deps.runExecutor).toHaveBeenCalledTimes(2);
    releaseExecutor?.();
  });

  it('pauseOrphaned：非 running 状态直接跳过', async () => {
    storage['queue'] = makeState({ status: 'paused' });
    const deps = makeDeps();
    const supervisor = createQueueSupervisor(deps);
    await supervisor.pauseOrphaned(true);
    expect(deps.save).not.toHaveBeenCalled();
  });

  it('pauseOrphaned：心跳新鲜 + allowReschedule → 延迟复查；owner 活着不动、停摆则降级', async () => {
    let clock = 10_001;
    const deps = makeDeps({ now: () => clock });
    const supervisor = createQueueSupervisor(deps);

    // 启动：心跳新鲜，安排 TTL+1s 后复查
    storage['queue'] = makeState();
    storage['hb'] = 10_000;
    await supervisor.pauseOrphaned(true);
    expect(deps.save).not.toHaveBeenCalled();

    // 复查时 owner 仍在跑（心跳持续新鲜）：不降级
    clock = 10_000 + TTL + 2_000;
    storage['hb'] = clock - 1_000; // owner 1s 前还在写
    await vi.advanceTimersByTimeAsync(TTL + 1_000);
    expect(deps.save).not.toHaveBeenCalled();
    expect((storage['queue'] as PersistentBlockQueueState).status).toBe('running');

    // 再次启动复查，但在复查触发前 owner 真消失（心跳停摆）：降级 paused + running → pending
    storage['queue'] = makeState({
      tasks: [{ handle: 'a', category: 'bot_spam', status: 'running' }],
    });
    storage['hb'] = clock - 1_000;
    await supervisor.pauseOrphaned(true);
    clock = storage['hb'] as number + TTL + 2_000; // 复查时刻心跳早已过期
    await vi.advanceTimersByTimeAsync(TTL + 1_000);
    expect(deps.save).toHaveBeenCalledTimes(1);
    const after = storage['queue'] as PersistentBlockQueueState;
    expect(after.status).toBe('paused');
    expect(after.tasks[0]?.status).toBe('pending');
  });

  it('pauseOrphaned：启动路径心跳新鲜但 allowReschedule=false 时不安排复查', async () => {
    storage['queue'] = makeState();
    storage['hb'] = 10_000;
    const deps = makeDeps({ now: () => 10_001 });
    const supervisor = createQueueSupervisor(deps);
    await supervisor.pauseOrphaned(false);
    await vi.advanceTimersByTimeAsync(TTL + 5_000);
    expect(deps.save).not.toHaveBeenCalled();
  });

  it('pauseByUser / cancel：协议返回值与状态语义', async () => {
    storage['queue'] = makeState({
      tasks: [{ handle: 'a', category: 'bot_spam', status: 'running' }],
    });
    const deps = makeDeps();
    const supervisor = createQueueSupervisor(deps);
    await expect(supervisor.pauseByUser()).resolves.toEqual({ status: 'paused' });
    expect(saved[0]?.pauseReason).toBe('user');
    await expect(supervisor.cancel()).resolves.toEqual({ status: 'cancelled' });
    expect(saved[1]?.tasks[0]?.status).toBe('cancelled');
  });

  it('pauseByUser / cancel：队列不存在 → absent', async () => {
    const deps = makeDeps();
    const supervisor = createQueueSupervisor(deps);
    await expect(supervisor.pauseByUser()).resolves.toEqual({ status: 'absent' });
    await expect(supervisor.cancel()).resolves.toEqual({ status: 'absent' });
  });
});
