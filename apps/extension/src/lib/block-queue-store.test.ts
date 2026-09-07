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

  it('保留 runner 写入的 pauseReason，供 popup 区分暂停原因', async () => {
    storage.persistentBlockQueueV1 = {
      id: 'paused-queue',
      source: 'community-batch',
      status: 'paused',
      pauseReason: 'quota_exhausted',
      createdAt: 1,
      updatedAt: 2,
      tasks: [{ handle: 'quota', category: 'other', status: 'pending' }],
    };
    expect(await getPersistentBlockQueue()).toMatchObject({
      id: 'paused-queue',
      status: 'paused',
      pauseReason: 'quota_exhausted',
    });
    // 无 pauseReason 的旧队列正常兼容（字段可选）
    storage.persistentBlockQueueV1 = {
      id: 'legacy-paused',
      source: 'page-batch',
      status: 'paused',
      createdAt: 1,
      updatedAt: 2,
      tasks: [],
    };
    const restored = await getPersistentBlockQueue();
    expect(restored?.pauseReason).toBeUndefined();
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

  it('保留一键拉黑中社区名单命中条目的 communityVote: false（防自我放大）', async () => {
    const created = await createPersistentBlockQueue('page-batch', [
      // content.ts 的 page-batch 处理器按 evidence.detectionSource === 'community-list'
      // 计算该值并写入任务；store 层只负责原样保留 communityVote。
      { handle: 'in_list_user', category: 'bot_spam', reason: '名单命中', communityVote: false },
      {
        handle: 'newly_flagged',
        category: 'copy_paste',
        reason: '指纹命中',
        communityVote: true,
      },
    ]);
    expect(created.tasks).toHaveLength(2);
    await setPersistentBlockQueue(created);

    const restored = await getPersistentBlockQueue();
    expect(restored?.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ handle: 'in_list_user', communityVote: false }),
        expect.objectContaining({ handle: 'newly_flagged', communityVote: true }),
      ]),
    );
  });

  it('runner 的重试/失败字段原样持久化，failed 任务补 failureCode 供 UI 展示', async () => {
    storage.persistentBlockQueueV1 = {
      id: 'retry-queue',
      source: 'page-batch',
      status: 'running',
      createdAt: 1,
      updatedAt: 2,
      tasks: [
        {
          handle: 'retrying',
          category: 'other',
          status: 'pending',
          attempts: 2,
          lastErrorCode: 'rate_limited',
          lastHttpStatus: 429,
          lastLatencyMs: 800,
          retryAt: 4000,
          retryAfterMs: 1200,
        },
        {
          handle: 'dead',
          category: 'other',
          status: 'failed',
          lastErrorCode: 'no-id',
          attempts: 1,
        },
      ],
    };
    const restored = await getPersistentBlockQueue();
    expect(restored?.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          handle: 'retrying',
          status: 'pending',
          attempts: 2,
          lastErrorCode: 'rate_limited',
          lastHttpStatus: 429,
          lastLatencyMs: 800,
          retryAt: 4000,
          retryAfterMs: 1200,
        }),
        expect.objectContaining({
          handle: 'dead',
          status: 'failed',
          lastErrorCode: 'no-id',
          failureCode: 'no-id', // 归一化：UI 继续读 failureCode
        }),
      ]),
    );
  });
});
