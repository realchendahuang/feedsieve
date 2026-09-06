import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
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
  it('保留页面清理任务的证据和贡献策略，刷新后仍可恢复', async () => {
    const created = await createPersistentBlockQueue('page-batch', [
      {
        handle: '@SpamAccount',
        xUserId: '123',
        category: 'adult_gray_traffic',
        reason: '命中成人引流词库',
        evidence: {
          contentFingerprint: '0123456789abcdef',
          linkDomains: ['spam.example'],
        },
        communityVote: true,
      },
      { handle: 'spamaccount', category: 'other' },
    ]);
    expect(created.tasks).toHaveLength(1);
    created.status = 'paused';
    await setPersistentBlockQueue(created);

    const restored = await getPersistentBlockQueue();
    expect(restored).toMatchObject({
      id: created.id,
      source: 'page-batch',
      status: 'paused',
      tasks: [
        {
          handle: 'spamaccount',
          xUserId: '123',
          reason: '命中成人引流词库',
          evidence: {
            contentFingerprint: '0123456789abcdef',
            linkDomains: ['spam.example'],
          },
          communityVote: true,
          status: 'pending',
        },
      ],
    });
  });

  it('兼容旧社区队列，不要求旧任务包含证据字段', async () => {
    storage.persistentBlockQueueV1 = {
      id: 'legacy-queue',
      source: 'community-batch',
      status: 'paused',
      createdAt: 1,
      updatedAt: 2,
      tasks: [{ handle: 'legacy', category: 'other', status: 'pending' }],
    };
    expect(await getPersistentBlockQueue()).toMatchObject({
      id: 'legacy-queue',
      source: 'community-batch',
      tasks: [{ handle: 'legacy', status: 'pending' }],
    });
  });
});
