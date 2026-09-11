import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createPersistentBlockQueue,
  getPersistentBlockQueue,
  setPersistentBlockQueue,
} from './block-queue-store';
import { decideQueueResume, sanitizeQueueItem } from './block-queue-store';

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
    // 「仍要继续」标记随队列持久化（本轮放行额度门控）
    storage.persistentBlockQueueV1 = {
      id: 'paused-queue',
      source: 'community-batch',
      status: 'paused',
      pauseReason: 'quota_exhausted',
      quotaOverride: true,
      createdAt: 1,
      updatedAt: 2,
      tasks: [{ handle: 'quota', category: 'other', status: 'pending' }],
    };
    expect(await getPersistentBlockQueue()).toMatchObject({
      status: 'paused',
      pauseReason: 'quota_exhausted',
      quotaOverride: true,
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
    expect(restored?.quotaOverride).toBeUndefined();
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

  it('消息入队前严格校验：畸形 handle / 非数字 id / 缺 category 整条丢弃', () => {
    expect(sanitizeQueueItem({ handle: '@Good_User', xUserId: '12345', category: 'bot_spam' })).toEqual({
      handle: 'good_user',
      xUserId: '12345',
      category: 'bot_spam',
    });
    expect(sanitizeQueueItem({ handle: 'ok_handle', category: 'other' })).toEqual({
      handle: 'ok_handle',
      category: 'other',
    });
    // handle 非法形态：16+ 位、含非法字符、非字符串、空
    expect(sanitizeQueueItem({ handle: 'a'.repeat(16), category: 'other' })).toBeNull();
    expect(sanitizeQueueItem({ handle: 'bad handle!', category: 'other' })).toBeNull();
    expect(sanitizeQueueItem({ handle: 123, category: 'other' })).toBeNull();
    expect(sanitizeQueueItem({ handle: '', category: 'other' })).toBeNull();
    // id 非纯数字 → 丢弃 id（条目仍可用，id 在执行期现解析）
    expect(sanitizeQueueItem({ handle: 'ok', xUserId: 'abc123', category: 'other' })).toEqual({
      handle: 'ok',
      category: 'other',
    });
    // category 缺失 / 非字符串 / 空串
    expect(sanitizeQueueItem({ handle: 'ok' })).toBeNull();
    expect(sanitizeQueueItem({ handle: 'ok', category: 7 })).toBeNull();
    expect(sanitizeQueueItem({ handle: 'ok', category: '' })).toBeNull();
    // 非对象
    expect(sanitizeQueueItem(null)).toBeNull();
    expect(sanitizeQueueItem('spam')).toBeNull();
  });

  it('存储态里的畸形 xUserId 反序列化时被剔除', async () => {
    storage.persistentBlockQueueV1 = {
      id: 'forged-queue',
      source: 'community-batch',
      status: 'paused',
      createdAt: 1,
      updatedAt: 2,
      tasks: [{ handle: 'ok', xUserId: 'DROP TABLE', category: 'other', status: 'pending' }],
    };
    const restored = await getPersistentBlockQueue();
    expect(restored?.tasks[0]).toMatchObject({ handle: 'ok' });
    expect(restored?.tasks[0]).not.toHaveProperty('xUserId');
  });

  describe('decideQueueResume（跨 tab 双跑防御）', () => {
    const NOW = 1_000_000;
    const TTL = 15_000;

    it('状态非 running：本 tab 直接接管', () => {
      expect(decideQueueResume('paused', NOW, NOW, TTL, false)).toBe('adopt');
      expect(decideQueueResume('completed', undefined, NOW, TTL, false)).toBe('adopt');
    });

    it('running + 本 tab 持有 runner：接管（runPersistentQueue 的现有 running guard 兜底）', () => {
      expect(decideQueueResume('running', NOW - 1000, NOW, TTL, true)).toBe('adopt');
    });

    it('running + 心跳新鲜 + 非本 tab：拒绝启动第二个 runner', () => {
      expect(decideQueueResume('running', NOW - 3000, NOW, TTL, false)).toBe('already-running');
    });

    it('running + 心跳过期/缺失 + 非本 tab：真孤儿，接管', () => {
      expect(decideQueueResume('running', NOW - 16_000, NOW, TTL, false)).toBe('adopt');
      expect(decideQueueResume('running', undefined, NOW, TTL, false)).toBe('adopt');
      expect(decideQueueResume('running', 'forged', NOW, TTL, false)).toBe('adopt');
    });
  });
});
