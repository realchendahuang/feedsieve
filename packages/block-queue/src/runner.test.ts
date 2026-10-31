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
  sleeps: number[];
  run: () => Promise<void>;
}

function makeHarness(
  initialTasks: FakeTask[],
  initialStatus: QueueSession<FakeTask>['status'] = 'running',
  overrides: Partial<QueueRunnerOptions<FakeTask>> = {},
): Harness {
  let session: QueueSession<FakeTask> = { status: initialStatus, tasks: [...initialTasks] };
  let saves = 0;
  let clock = 1_000_000;
  const sleeps: number[] = [];
  const perform = vi.fn(async () => {
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
    sleep: async (ms) => {
      // 测试里瞬时推进时钟，避免真实等待；同时留档以便断言注入的节奏
      sleeps.push(ms);
      clock += ms;
    },
    ...overrides,
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
    sleeps,
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
    expect(h.session.pauseReason).toBe('auth_required');
    expect(h.session.tasks[0]).toMatchObject({ status: 'pending', lastErrorCode: 'auth_required' });

    // 用户重登后 resume：同一 runner 继续执行，pauseReason 随成功清除
    h.session.status = 'running';
    h.perform.mockReset();
    h.perform.mockResolvedValue({ ok: true });
    await h.run();
    expect(h.session.tasks[0]?.status).toBe('success');
    expect(h.session.status).toBe('completed');
    expect(h.session.pauseReason).toBeUndefined();
  });

  it('quota_exhausted（安全额度用尽）整队列暂停并记录 pauseReason，任务保持 pending', async () => {
    const h = makeHarness([task('quota'), task('rest')]);
    h.perform.mockResolvedValue({ ok: false, code: 'quota_exhausted' });
    await h.run();
    expect(h.session.status).toBe('paused');
    expect(h.session.pauseReason).toBe('quota_exhausted');
    expect(h.session.tasks.map((t) => t.status)).toEqual(['pending', 'pending']);
    // 额度暂停不发第二路请求：quota 任务只试一次
    expect(h.perform).toHaveBeenCalledTimes(1);
  });

  it('successPaceMs 注入生效：成功后分片休眠（≤250ms/片，总量一致）；默认仍为 PACE_FLOOR_MS', async () => {
    const injected = makeHarness([task('a')], 'running', { successPaceMs: () => 1500 });
    await injected.run();
    // 1500ms 注入节奏被切成 6 片 250ms，保持总量一致且期间可响应 pause
    expect(injected.sleeps.filter((ms) => ms === 250).length).toBe(6);

    const defaulted = makeHarness([task('a')]);
    await defaulted.run();
    // 默认 400ms 同样分片（250 + 150）
    expect(defaulted.sleeps).toContain(250);
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

  it('perform 裸抛异常按瞬时网络失败处理：重试后判死，不卡死在 running', async () => {
    const h = makeHarness([task('boom')]);
    h.perform.mockRejectedValue(new Error('DOM broken'));
    await h.run();
    expect(h.perform).toHaveBeenCalledTimes(3); // MAX_TRANSIENT_ATTEMPTS
    expect(h.session.tasks[0]).toMatchObject({
      status: 'failed',
      attempts: 3,
      lastErrorCode: 'network_error',
    });
  });

  it('存储消失（load 返回 null）时中止，不把旧 session 写回复活任务', async () => {
    let loads = 0;
    const h = makeHarness([task('a')], 'running', {
      load: async () => {
        loads += 1;
        // 第 1/2 次：主循环读取 + 标记 running 的写前复核；第 3 次是 perform 后的重读
        if (loads >= 3) {
          return null; // perform 之后存储消失
        }
        return h.session;
      },
    });
    h.perform.mockResolvedValue({ ok: true });
    await h.run();
    expect(h.perform).toHaveBeenCalledTimes(1);
    // 只写了一次（标记 running）；perform 后的写入被「会话不可用」挡掉
    expect(h.saveCount()).toBe(1);
  });

  it('退避等待每片醒来复核队列状态：宿主暂停不等满整个退避', async () => {
    let wakes = 0;
    const h = makeHarness([task('flaky')], 'running', {
      sleep: async () => {
        wakes += 1;
        if (wakes === 1) {
          h.session.status = 'paused'; // 第一片睡眠期间宿主暂停
        }
      },
    });
    h.perform.mockResolvedValueOnce({ ok: false, code: 'network_error' });
    h.perform.mockResolvedValue({ ok: true });
    await h.run();
    // 只睡了一片就因 pause 退出，没有等到后续分片/重试
    expect(wakes).toBe(1);
    expect(h.perform).toHaveBeenCalledTimes(1);
    expect(h.session.status).toBe('paused');
  });

  it('成功时清除上次失败留下的 httpStatus', async () => {
    const h = makeHarness([task('a', { lastHttpStatus: 429 })]);
    h.perform.mockResolvedValue({ ok: true });
    await h.run();
    expect(h.session.tasks[0]?.lastHttpStatus).toBeUndefined();
    expect(h.session.tasks[0]?.status).toBe('success');
  });

  it('执行期间宿主暂停：成功结果不会把队列状态从 paused 覆盖回 running/completed', async () => {
    const h = makeHarness([task('a')]);
    let pausedByHost = false;
    h.perform.mockImplementation(async () => {
      if (!pausedByHost) {
        pausedByHost = true;
        h.session.status = 'paused'; // perform 期间用户手动暂停
      }
      return { ok: true };
    });
    await h.run();
    // runner 写前复核发现 paused → 放弃写入并退出；任务保持 running 留给下次恢复重做
    expect(h.session.status).toBe('paused');
    expect(h.perform).toHaveBeenCalledTimes(1);
  });
});