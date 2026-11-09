// @vitest-environment happy-dom
/**
 * content 侧消息路由回归：伪人页「一键屏蔽 AI 号」（feedsieve:ai-block-start）。
 *
 * 只测入队前的拒绝 / 净化口径与队列 source——执行、额度、暂停恢复全部复用
 * 社区批量队列，不在这一层重复覆盖。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerContentMessageHandlers } from './messages';
import { createContentState } from './page-state';

type MessageListener = (message: unknown) => unknown;

// 与 Chrome 一致：可注册多个 listener，取第一个给出异步/同步响应的
let listeners: MessageListener[];
let startPersistentQueue: ReturnType<typeof vi.fn>;
let filterEnabled: boolean;
let profileEnabled: boolean;
let profileFill: {
  fill: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  status: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  listeners = [];
  filterEnabled = true;
  profileEnabled = true;
  profileFill = {
    fill: vi.fn(async () => ({ ok: true, added: 2, stopped: 'stagnant' })),
    stop: vi.fn(),
    status: vi.fn(() => ({ running: true, handle: 'alice', added: 4, last: null })),
  };
  vi.stubGlobal('browser', {
    runtime: {
      onMessage: {
        addListener: vi.fn((callback: MessageListener) => {
          listeners.push(callback);
        }),
      },
      sendMessage: vi.fn(async () => undefined),
      getManifest: () => ({ version: '0.0.0' }),
    },
    storage: {
      local: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined) },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  });
  startPersistentQueue = vi.fn(async (source: string, items: unknown[], targetTabId?: number) => ({
    status: 'started',
    id: 'queue-1',
    count: items.length,
    source,
    targetTabId,
  }));
  registerContentMessageHandlers({
    state: createContentState(),
    queueSupervisor: {} as never,
    followingSync: {} as never,
    startPersistentQueue: startPersistentQueue as never,
    runManualSpamBlock: vi.fn() as never,
    profileFill: profileFill as never,
    isFilterEnabled: () => filterEnabled,
    isProfileEnabled: () => profileEnabled,
  });
});

async function send(message: unknown): Promise<unknown> {
  for (const callback of listeners) {
    const result = await callback(message);
    if (result !== undefined) return result;
  }
  return undefined;
}

describe('feedsieve:profile-fill', () => {
  it('开始 / 停止 / 查询状态三条消息各走各的入口', async () => {
    expect(await send({ type: 'feedsieve:profile-fill', handle: 'Alice' })).toEqual({
      ok: true,
      added: 2,
      stopped: 'stagnant',
    });
    expect(profileFill.fill).toHaveBeenCalledWith('alice');
    expect(await send({ type: 'feedsieve:profile-fill-stop' })).toEqual({ ok: true });
    expect(profileFill.stop).toHaveBeenCalledTimes(1);
    // 面板重开时用它与页面对账，恢复「停止」与收尾提示
    expect(await send({ type: 'feedsieve:profile-fill-status' })).toEqual({
      running: true,
      handle: 'alice',
      added: 4,
      last: null,
    });
  });

  it('主页模块关闭时不再启动补全，状态也查不到', async () => {
    profileEnabled = false;
    expect(await send({ type: 'feedsieve:profile-fill', handle: 'alice' })).toEqual({
      ok: false,
      code: 'module-disabled',
    });
    expect(profileFill.fill).not.toHaveBeenCalled();
    expect(await send({ type: 'feedsieve:profile-fill-status' })).toBeNull();
  });
});

describe('feedsieve:ai-block-start', () => {
  it('降噪模块全关时拒绝入队（module-disabled）', async () => {
    filterEnabled = false;
    const result = await send({
      type: 'feedsieve:ai-block-start',
      items: [{ handle: 'ai_bot', category: 'ai_slop' }],
    });
    expect(result).toEqual({ status: 'error', error: 'module-disabled', id: '', count: 0 });
    expect(startPersistentQueue).not.toHaveBeenCalled();
  });

  it('items 全部非法时返回 invalid-items，不入队', async () => {
    const result = await send({
      type: 'feedsieve:ai-block-start',
      items: [
        { handle: 'not a handle', category: 'ai_slop' },
        { handle: 'ok_bot' }, // 缺 category
        { handle: '@@@', category: 'ai_slop' }, // 净化后为空
        null,
        'garbage',
      ],
    });
    expect(result).toEqual({ status: 'error', error: 'invalid-items', id: '', count: 0 });
    expect(startPersistentQueue).not.toHaveBeenCalled();
  });

  it('合法 items 净化后以 ai-batch 入队，条数与净化结果一致', async () => {
    const result = await send({
      type: 'feedsieve:ai-block-start',
      items: [
        { handle: '@BotOne', category: 'ai_slop' },
        { handle: 'invalid handle', category: 'ai_slop' },
        { handle: 'second_bot', category: 'ai_slop', xUserId: '1234567890' },
        { handle: 'missing_category' },
      ],
      targetTabId: 42,
    });

    expect(startPersistentQueue).toHaveBeenCalledTimes(1);
    const [source, items, targetTabId] = startPersistentQueue.mock.calls[0] as [
      string,
      Array<{ handle: string; category: string; xUserId?: string }>,
      number | undefined,
    ];
    expect(source).toBe('ai-batch');
    expect(targetTabId).toBe(42);
    // 非法 handle / 缺 category 的被丢弃；合法 handle 统一小写去 @
    expect(items.map((item) => [item.handle, item.category])).toEqual([
      ['botone', 'ai_slop'],
      ['second_bot', 'ai_slop'],
    ]);
    expect(items[1]?.xUserId).toBe('1234567890');
    expect(result).toMatchObject({ status: 'started', count: 2 });
  });
});
