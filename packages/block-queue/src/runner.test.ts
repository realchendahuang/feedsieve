import { describe, expect, it, vi } from 'vitest';
import { runQueuedBlocks, type QueueRunnerOptions, type QueueSession, type TaskRunRecord } from './runner';

interface FakeTask extends TaskRunRecord {
  category: string;
}

function task(handle: string, overrides: Partial<FakeTask> = {}): FakeTask {
  return { handle, category: 'other', status: 'pending', ...overrides };
}

interface Harness {
  session: QueueSession<FakeTask>;
  perform: ReturnType<typeof vi.fn>;
  onSuccess: ReturnType<typeof vi.fn>;
  saveCount: () => number;
  run: () => Promise<void>;
}

function makeHarness(initialTasks: FakeTask[], initialStatus: QueueSession<FakeTask>['status'] = 'running'): Harness {
  let session: QueueSession<FakeTask> = { status: initialStatus, tasks: [...initialTasks] };
  let saves = 0;
  let clock = 1_000_000;
  const perform = vi.fn(async (task: FakeTask) => {
    return { ok: true } as const;
  });
  const onSuccess = vi.fn(async () => undefined);
  const options: QueueRunnerOptions<FakeTask> = {
    load: async () => session,
    save: async (next) => {
      session = next;
      saves += 1;
    },
    perform,
    onSuccess,
    now: () => clock,
    sleep: async (_ms: number) => {
      // 测试里瞬时推进时钟，避免真实等待
      clock += 250;
    },
  };
  return {
    session: session!,
    get perform() {
      return perform;
    },
    get onSuccess() {
      return onSuccess;
    },
    saveCount: () => saves,
    run: () => runQueuedBlocks(options),
  };
}

describe('runQueuedBlocks（持久化队列 runner）', () => {
  it('全部成功：任务逐个执行并标记 success，队列 completed', async () => {
    const h = makeHarness([task('a'), task('b')]);
    h.perform.mockResolvedValue({ ok: true });
    await h.run();
    expect(h.perform).toHaveBeenCalledTimes(2);
    expect(h.session.status).toBe('completed');
    expect(h.session.tasks.map((t) => t.status)).toEqual(['success', 'success']);
    expect(h.onSuccess).toHaveBeenCalledTimes(2);
  });

  it('transient 失败按任务退避重试，不暂停队列；耗尽后判死', async () => {
    const h = makeHarness([task('flaky')]);
    h.perform
      .mockResolvedValueOnce({ ok: false, code: 'network_error' })
      .mockResolvedValueOnce({ ok: false, code: 'network_error' })
      .mockResolvedValueOnce({ ok: false, code: 'network_error' })
      .mockResolvedValueOnce({ ok: false, code: 'network_error' });
    await h.run();
    expect(h.perform).toHaveBeenCalledTimes(3); // 首试 + 2 次重试（MAX_TRANSIENT_ATTEMPTS=3）
    expect(h.session.tasks[0]).toMatchObject({ status: 'failed', attempts: 3, lastErrorCode: 'network_error' });
    expect(h.session.status).toBe('completed');
  });

  it('transient 重试后成功：attempts 累计但最终 success，retryAt 清除', async () => {
    const h = makeHarness([task('recovers')]);
    h.perform
      .mockResolvedValueOnce({ ok: false, code: 'rate_limited', httpStatus: 429, retryAfterMs: 1000 })
      .mockResolvedValueOnce({ ok: true });
    await h.run();
    const t = h.session.tasks[0]!;
    expect(t.status).toBe('success');
    expect(t.attempts).toBe(2);
    expect(t.retryAt).toBeUndefined();
    expect(t.lastErrorCode).toBeUndefined();
    // 429 的 Retry-After 被记录
    expect(h.perform).toHaveBeenCalledTimes(2);
  });

  it('pause 失败（auth_required / kill_switch）整队列暂停，等待 resume', async () => {
    const h = makeHarness([task('auth')]);
    h.perform.mockResolvedValue({ ok: false, code: 'auth_required', httpStatus: 403 });
    await h.run();
    expect(h.session.status).toBe('paused');
    expect(h.session.tasks[0]).toMatchObject({ status: 'pending', lastErrorCode: 'auth_required' });

    // 用户重登后 resume：同一 runner 继续执行
    h.session.status = 'running';
    h.perform.mockReset();
    h.perform.mockResolvedValue({ ok: true });
    await h.run();
    expect(h.session.tasks[0]?.status).toBe('success');
    expect(h.session.status).toBe('completed');
  });

  it('permanent / unsupported 单任务判死，队列继续其它任务', async () => {
    const h = makeHarness([task('dead'), task('alive')]);
    h.perform.mockImplementation(async (t) =>
      t.handle === 'dead' ? { ok: false, code: 'no-id' } : { ok: true },
    );
    await h.run();
    expect(h.perform).toHaveBeenCalledTimes(2);
    expect(h.session.tasks.map((t) => t.status)).toEqual(['failed', 'success']);
    expect(h.session.status).toBe('completed');
  });

  it('跑动中 pause/cancel 在分片 sleep 内生效', async () => {
    const h = makeHarness([task('a'), task('b')]);
    h.perform.mockImplementation(async (t) => {
      if (t.handle === 'a') {
        h.session.status = 'paused'; // 模拟用户手动暂停
      }
      return { ok: true };
    });
    await h.run();
    expect(h.perform).toHaveBeenCalledTimes(1);
    expect(h.session.status).toBe('paused');
  });

  it('非 running 状态（paused/cancelled）直接返回，不执行任何任务', async () => {
    const h = makeHarness([task('a')], 'paused');
    await h.run();
    expect(h.perform).not.toHaveBeenCalled();
  });
});