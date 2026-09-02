import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  blockQueueProgress,
  createPersistentBlockQueue,
  getPersistentBlockQueue,
  setPersistentBlockQueue,
} from './block-queue-store';

let storage: Record<string, unknown>;

beforeEach(() => {
  storage = {};
  vi.stubGlobal('browser', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
        set: vi.fn(async (patch: Record<string, unknown>) => Object.assign(storage, patch)),
      },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  });
});

describe('持久化拉黑队列', () => {
  it('按 handle 去重并能从 storage 恢复', async () => {
    const state = await createPersistentBlockQueue('community-batch', [
      { handle: '@Spam', category: 'bot_spam' },
      { handle: 'spam', category: 'bot_spam' },
      { handle: 'other', xUserId: '2', category: 'other' },
    ]);
    expect(state.tasks).toHaveLength(2);
    expect((await getPersistentBlockQueue())?.tasks).toHaveLength(2);
  });

  it('精确统计成功、失败和待执行', async () => {
    const state = await createPersistentBlockQueue('community-batch', [
      { handle: 'a', category: 'other' },
      { handle: 'b', category: 'other' },
      { handle: 'c', category: 'other' },
    ]);
    state.tasks[0]!.status = 'success';
    state.tasks[1]!.status = 'failed';
    await setPersistentBlockQueue(state);
    expect(blockQueueProgress(await getPersistentBlockQueue())).toEqual({
      total: 3,
      success: 1,
      failed: 1,
      pending: 1,
    });
  });
});
