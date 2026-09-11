import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParsedApiData } from '@feedsieve/x-adapter';
import { createFollowingSync, type FollowingSyncDeps } from './following-sync';

/**
 * 只需要 following-sync 消费的 ParsedApiData 字段；其余字段与本模块无关。
 */
function page(
  overrides: Partial<Pick<ParsedApiData, 'following' | 'followingCursor' | 'sourceUrl'>> = {},
): ParsedApiData {
  return {
    matchedEndpoints: ['Following'],
    tweets: [],
    promoted: [],
    listMembers: [],
    following: [],
    ...overrides,
  } as ParsedApiData;
}

function account(handle: string, xUserId?: string) {
  return { handle, ...(xUserId ? { xUserId } : {}) };
}

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

function seedWaiting(now = 1_000): void {
  storage['xSelfHandleV1'] = 'me';
  storage['followingAllowlistSyncStateV1'] = {
    status: 'waiting',
    collected: 0,
    startedAt: now,
    updatedAt: now,
  };
}

function makeSync(overrides: Partial<FollowingSyncDeps> = {}) {
  const navigated: string[] = [];
  const sleeps: number[] = [];
  const fetches: Array<{ sourceUrl: string; cursor: string }> = [];
  const sync = createFollowingSync({
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    navigate: (url) => {
      navigated.push(url);
    },
    fetchPage: async (sourceUrl: string, cursor: string) => {
      fetches.push({ sourceUrl, cursor });
      return page();
    },
    ...overrides,
  });
  return { sync, navigated, sleeps, fetches };
}

describe('start（popup 同步入口）', () => {
  it('未知自己 handle → self_handle_unknown，不跳转', async () => {
    const { sync, navigated } = makeSync();
    await expect(sync.start()).resolves.toEqual({ status: 'error', error: 'self_handle_unknown' });
    expect(navigated).toEqual([]);
  });

  it('写 waiting 状态、清 draft、跳转到自己的关注页', async () => {
    storage['xSelfHandleV1'] = 'Me';
    storage['followingAllowlistSyncDraftV1'] = [{ handle: 'stale' }];
    const { sync, navigated } = makeSync({ now: () => 42_000 });
    const result = await sync.start();
    expect(result).toEqual({
      status: 'navigating',
      url: 'https://x.com/me/following',
    });
    expect(navigated).toEqual(['https://x.com/me/following']);
    expect(storage['followingAllowlistSyncDraftV1']).toEqual([]);
    expect(storage['followingAllowlistSyncStateV1']).toMatchObject({
      status: 'waiting',
      collected: 0,
      startedAt: 42_000,
      updatedAt: 42_000,
    });
  });
});

describe('onPage（分页循环）', () => {
  it('同步状态非 waiting/running 时忽略', async () => {
    const { sync } = makeSync();
    storage['followingAllowlistSyncStateV1'] = { status: 'idle', collected: 0, updatedAt: 0 };
    await sync.onPage(page({ following: [account('a')] }));
    expect(storage['followingAllowlistSyncDraftV1']).toBeUndefined();
  });

  it('状态超过 60s 未更新 → following_sync_interrupted', async () => {
    seedWaiting(1_000);
    const { sync } = makeSync({ now: () => 1_000 + 61_000 });
    await sync.onPage(page({ following: [account('a')] }));
    expect(storage['followingAllowlistSyncStateV1']).toMatchObject({
      status: 'error',
      error: 'following_sync_interrupted',
    });
  });

  it('分页到「连续 3 空页」终止：draft 原子替换正式名单 + complete 状态', async () => {
    seedWaiting();
    let clock = 1_000;
    // 初始页直接给 onPage；翻页序列从第 2 页开始
    const initial = page({
      following: [account('a', '1'), account('b')],
      followingCursor: 'c1',
      sourceUrl: 'https://x.com/i/api/graphql/x/Following?variables=v1',
    });
    const fetchPages = [
      page({ following: [account('c', '3')], followingCursor: 'c2' }),
      page({ followingCursor: 'c3' }), // 空页 1（可能是时间线间隙）
      page({ following: [account('d')], followingCursor: 'c4' }), // 又有新账号：计数归零
      page({ followingCursor: 'c5' }), // 空页 1
      page({ followingCursor: 'c6' }), // 空页 2
      page(), // 空页 3 → 终止（无 cursor，双重终止信号）
    ];
    let call = 0;
    const sleeps: number[] = [];
    const sync = createFollowingSync({
      now: () => ++clock,
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
      fetchPage: async () => fetchPages[call++] ?? page(),
      navigate: () => {},
    });
    await sync.onPage(initial);
    // draft 已清，正式名单完整原子替换
    expect(storage['followingAllowlistSyncDraftV1']).toEqual([]);
    const list = storage['followingAllowlistV1'] as Array<{ handle: string; xUserId?: string }>;
    expect(list.map((item) => item.handle)).toEqual(['a', 'b', 'c', 'd']);
    expect(list.find((item) => item.handle === 'a')?.xUserId).toBe('1');
    expect(storage['followingAllowlistSyncStateV1']).toMatchObject({
      status: 'complete',
      collected: 4,
    });
    // 每次翻页前都有 650ms 间隔（共 6 次翻页）
    expect(sleeps).toEqual([650, 650, 650, 650, 650, 650]);
  });

  it('cursor 环 → following_cursor_loop 错误态，不动正式名单', async () => {
    seedWaiting();
    const { sync } = makeSync({
      now: () => 2_000,
      fetchPage: async () =>
        page({ followingCursor: 'same', sourceUrl: 'https://x.com/i/api/graphql/x/Following' }),
    });
    await sync.onPage(
      page({ following: [account('a')], followingCursor: 'same', sourceUrl: 'https://x.com/i/api/graphql/x/Following' }),
    );
    expect(storage['followingAllowlistSyncStateV1']).toMatchObject({
      status: 'error',
      error: 'following_cursor_loop',
    });
    expect(storage['followingAllowlistV1']).toBeUndefined();
  });

  it('缺 sourceUrl → following_source_url_missing', async () => {
    seedWaiting();
    const { sync } = makeSync({ now: () => 2_000 });
    await sync.onPage(page({ following: [account('a')], followingCursor: 'c1' }));
    expect(storage['followingAllowlistSyncStateV1']).toMatchObject({
      status: 'error',
      error: 'following_source_url_missing',
    });
  });

  it('分页安全上限 → following_page_limit_reached', async () => {
    seedWaiting();
    let clock = 1_000;
    const { sync } = makeSync({
      now: () => ++clock,
      maxPages: 3,
      fetchPage: async () =>
        page({ following: [account(`u${clock}`)], followingCursor: `c${clock}`, sourceUrl: 'https://x.com/i/api/graphql/x/Following' }),
    });
    await sync.onPage(
      page({ following: [account('u0')], followingCursor: 'c0', sourceUrl: 'https://x.com/i/api/graphql/x/Following' }),
    );
    expect(storage['followingAllowlistSyncStateV1']).toMatchObject({
      status: 'error',
      error: 'following_page_limit_reached',
    });
  });

  it('同页重入：并发 onPage 共享同一个分页 Promise，不重复开循环', async () => {
    seedWaiting();
    let clock = 1_000;
    let fetchCalls = 0;
    // 翻页结果无 cursor → 首轮即终止（无新账号 + 无 cursor 双重终止信号）
    const { sync } = makeSync({
      now: () => ++clock,
      fetchPage: async () => {
        fetchCalls += 1;
        return page();
      },
    });
    const firstPage = page({
      following: [account('a')],
      followingCursor: 'c1',
      sourceUrl: 'https://x.com/i/api/graphql/x/Following',
    });
    await Promise.all([sync.onPage(firstPage), sync.onPage(firstPage)]);
    expect(fetchCalls).toBe(1);
    expect(storage['followingAllowlistSyncStateV1']).toMatchObject({
      status: 'complete',
      collected: 1,
    });
  });
});
