import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createInsightUplink,
  createSharedInsight,
  SHARED_INSIGHT_KEY,
  type SharedInsightStorage,
} from './shared-insight';

const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 30, 12);

function memoryStorage(initial: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = { ...initial };
  const storage: SharedInsightStorage = {
    get: vi.fn(async (key: string) => (key in data ? { [key]: data[key] } : {})),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(data, JSON.parse(JSON.stringify(items)));
    }),
  };
  return { storage, data };
}

function observation(at: number, views: number, postId = '1', handle = 'alice') {
  return {
    at,
    tweets: [{ postId, handle, createdAt: NOW - 2 * HOUR, views, snippet: 'hi' }],
    authors: [{ handle, followers: 3_000 }],
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('createSharedInsight', () => {
  it('merges observations from several tabs into one hot list', async () => {
    vi.useFakeTimers();
    const { storage } = memoryStorage();
    const broadcast = vi.fn();
    const shared = createSharedInsight({ storage, broadcast, now: () => NOW });
    // 标签页 A 和标签页 B 各看到一条不同的帖子，还有一条两个标签页都看到了
    await shared.ingest([observation(NOW - 20 * 60_000, 40_000, '1')]);
    await shared.ingest([
      observation(NOW - 60_000, 90_000, '1'),
      observation(NOW - 60_000, 5_000, '2', 'bob'),
    ]);
    const list = await shared.hotList('heat');
    expect(list.map((item) => item.postId)).toEqual(['1', '2']);
    // 两个标签页的观测合成了一条帖子的两个观测点，流速按增量计算（公式本身见 @feedsieve/metrics）
    expect(list[0]!.views).toBe(90_000);
    expect(list[0]!.velocity).not.toBeNull();
    expect(list[0]!.tier).toBe(2);
    expect((await shared.brief()).seen).toBe(2);

    // 合并后的广播和持久化都是合并的一次
    await vi.advanceTimersByTimeAsync(2_000);
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(storage.set).toHaveBeenCalledTimes(1);
  });

  it('reports a single post velocity for the hot-list uplink', async () => {
    const { storage } = memoryStorage();
    const shared = createSharedInsight({ storage, broadcast: () => {}, now: () => NOW });
    await shared.ingest([observation(NOW - 60_000, 90_000)]);
    expect(await shared.velocityOf('1')).toBeGreaterThan(1_000);
    expect(await shared.velocityOf('404')).toBeNull();
  });

  it('tracks read posts, flags them in the hot list and keeps them across restarts', async () => {
    vi.useFakeTimers();
    const { storage } = memoryStorage();
    const shared = createSharedInsight({ storage, broadcast: () => {}, now: () => NOW });
    await shared.ingest([
      observation(NOW - 60_000, 90_000, '1'),
      observation(NOW - 60_000, 9_000, '2', 'bob'),
    ]);
    expect(await shared.markRead(['1', '1', 'not-an-id'])).toBe(1);
    const list = await shared.hotList('heat');
    expect(list.find((item) => item.postId === '1')?.read).toBe(true);
    expect(list.find((item) => item.postId === '2')?.read).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);
    const restarted = createSharedInsight({ storage, broadcast: () => {}, now: () => NOW });
    expect(await restarted.readIds()).toEqual(['1']);
  });

  it('records when posts first showed on screen and sorts "just seen" by it', async () => {
    vi.useFakeTimers();
    const { storage, data } = memoryStorage();
    const shared = createSharedInsight({ storage, broadcast: vi.fn(), now: () => NOW });
    await shared.ingest([
      observation(NOW - 60_000, 90_000, '1'),
      observation(NOW - 60_000, 90_000, '2', 'bob'),
    ]);
    expect(
      await shared.markSeen([
        { postId: '2', at: NOW - 30_000 },
        { postId: '1', at: NOW - 10_000 },
        { postId: 'bad', at: NOW },
        { postId: '3', at: 'soon' },
      ]),
    ).toBe(2);
    expect((await shared.hotList('recent')).map((item) => item.postId)).toEqual(['1', '2']);
    await vi.advanceTimersByTimeAsync(2_000);
    const restarted = createSharedInsight({
      storage: memoryStorage(data).storage,
      broadcast: vi.fn(),
      now: () => NOW,
    });
    expect((await restarted.hotList('recent')).map((item) => item.postId)).toEqual(['1', '2']);
  });

  it('ignores an older observation that arrives late from another tab', async () => {
    const { storage } = memoryStorage();
    const shared = createSharedInsight({ storage, broadcast: () => {}, now: () => NOW });
    await shared.ingest([observation(NOW - 60_000, 90_000)]);
    await shared.ingest([observation(NOW - 5 * 60_000, 10_000)]);
    const [item] = await shared.hotList('heat');
    expect(item!.views).toBe(90_000);
  });

  it('restores from storage.session after the service worker restarts', async () => {
    vi.useFakeTimers();
    const { storage, data } = memoryStorage();
    const first = createSharedInsight({ storage, broadcast: () => {}, now: () => NOW });
    await first.ingest([observation(NOW - 60_000, 90_000)]);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(data[SHARED_INSIGHT_KEY]).toBeTruthy();

    const restarted = createSharedInsight({ storage, broadcast: () => {}, now: () => NOW });
    expect((await restarted.hotList('heat')).map((item) => item.postId)).toEqual(['1']);
  });

  it('drops malformed entries and clamps observation times', async () => {
    const { storage } = memoryStorage();
    const shared = createSharedInsight({ storage, broadcast: () => {}, now: () => NOW });
    const recorded = await shared.ingest([
      { at: NOW + 10 * HOUR, tweets: [{ postId: '7', handle: 'carol', views: 100 }], authors: [] },
      {
        at: NOW,
        tweets: [
          { postId: 'abc', handle: 'carol' },
          { postId: '8', handle: 'Bad Name' },
        ],
      },
      { at: 'soon', tweets: [{ postId: '9', handle: 'dave' }] },
      null,
    ]);
    expect(recorded).toBe(1);
    expect(await shared.ingest('not an array')).toBe(0);
  });

  it('keeps tweets seen within the last two hours', async () => {
    const { storage } = memoryStorage();
    let now = NOW;
    const shared = createSharedInsight({ storage, broadcast: () => {}, now: () => now });
    await shared.ingest([observation(NOW, 90_000)]);
    now = NOW + 90 * 60_000;
    expect(await shared.hotList('heat')).toHaveLength(1);
    now = NOW + 2 * HOUR + 1;
    expect(await shared.hotList('heat')).toHaveLength(0);
  });
});

describe('createInsightUplink', () => {
  it('batches observations and sends them once per interval', async () => {
    vi.useFakeTimers();
    const send = vi.fn().mockResolvedValue(undefined);
    const uplink = createInsightUplink({ send, flushMs: 2_000 });
    uplink.push(observation(NOW, 1));
    uplink.push(observation(NOW + 1, 2));
    uplink.push({ at: NOW, tweets: [], authors: [] });
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toHaveLength(2);
  });
});
