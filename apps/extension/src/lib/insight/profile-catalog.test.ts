import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createProfileCatalog,
  PROFILE_INDEX_KEY,
  PROFILE_KEY_PREFIX,
  PROFILE_META_PREFIX,
  type CatalogStorage,
} from './profile-catalog';

const NOW = Date.UTC(2026, 9, 30, 12);
const DAY = 24 * 60 * 60 * 1000;

function memoryStorage(initial: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = { ...initial };
  const storage: CatalogStorage = {
    get: vi.fn(async (keys: string | string[]) => {
      const out: Record<string, unknown> = {};
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        if (key in data) out[key] = JSON.parse(JSON.stringify(data[key]));
      }
      return out;
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(data, JSON.parse(JSON.stringify(items)));
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
    }),
  };
  return { storage, data };
}

/** 一个 snowflake post_id，对应发帖时间 ts（毫秒）。 */
function idAt(ts: number, seq = 0): string {
  const TWITTER_EPOCH = 1288834974657;
  return String((BigInt(ts - TWITTER_EPOCH) << 22n) + BigInt(seq));
}

/** 和生产 shardOf 一致：发帖时间所在的 30 天窗口号。 */
function shardNo(ts: number): number {
  const TWITTER_EPOCH = 1288834974657;
  return Math.floor((ts - TWITTER_EPOCH) / (30 * DAY));
}

function tweet(postId: string, handle: string, extra: Record<string, unknown> = {}) {
  return {
    postId,
    handle,
    createdAt: NOW - DAY,
    views: 1_000,
    likes: 10,
    kind: 'original',
    ...extra,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('createProfileCatalog', () => {
  it('starts a catalog when a profile is opened and then collects that author everywhere', async () => {
    const { storage } = memoryStorage();
    const catalog = createProfileCatalog({ storage, now: () => NOW });
    // 首页上看到 alice 的帖子：还没打开过她的主页，不收
    await catalog.ingest([{ at: NOW, tweets: [tweet('1', 'alice')], authors: [] }]);
    expect(await catalog.get('alice')).toBeNull();
    // 打开 alice 的主页
    await catalog.ingest([
      {
        at: NOW,
        profile: 'alice',
        tweets: [tweet('2', 'alice', { pinned: true }), tweet('3', 'bob')],
        authors: [
          { handle: 'alice', followers: 12_000, displayName: 'Alice', verified: true },
          { handle: 'bob', followers: 5 },
        ],
      },
    ]);
    // 之后在搜索页看到她的帖子，也收
    await catalog.ingest([
      { at: NOW + 1, tweets: [tweet('4', 'alice', { kind: 'reply' })], authors: [] },
    ]);
    const entry = (await catalog.get('alice'))!;
    expect(Object.keys(entry.posts).sort()).toEqual(['2', '4']);
    expect(entry.posts['2']).toMatchObject({ pinned: true, firstSeenAt: NOW });
    expect(entry.posts['4']?.kind).toBe('reply');
    expect(entry.account).toMatchObject({
      handle: 'alice',
      followers: 12_000,
      displayName: 'Alice',
      verified: true,
    });
    expect(await catalog.get('bob')).toBeNull();
  });

  it('never lowers counts and keeps the pinned mark', async () => {
    const { storage } = memoryStorage();
    const catalog = createProfileCatalog({ storage, now: () => NOW });
    await catalog.ingest([
      {
        at: NOW,
        profile: 'alice',
        tweets: [tweet('1', 'alice', { views: 5_000, pinned: true })],
        authors: [],
      },
    ]);
    // 另一个标签页晚到的旧观测：数字更小，不覆盖
    await catalog.ingest([
      { at: NOW + 1, tweets: [tweet('1', 'alice', { views: 4_000, likes: 50 })], authors: [] },
    ]);
    const post = (await catalog.get('alice'))!.posts['1']!;
    expect(post.views).toBe(5_000);
    expect(post.likes).toBe(50);
    expect(post.pinned).toBe(true);
  });

  it('drops malformed tweets and authors', async () => {
    const { storage } = memoryStorage();
    const catalog = createProfileCatalog({ storage, now: () => NOW });
    await catalog.ingest([
      {
        at: NOW,
        profile: 'alice',
        tweets: [
          tweet('not-a-number', 'alice'),
          tweet('5', 'Alice!'),
          tweet('6', 'alice', { views: -3, kind: 'ad', mediaUrl: 'https://evil.example/x.jpg' }),
        ],
        authors: [{ handle: 'alice', followers: 'many', avatarUrl: 'javascript:alert(1)' }],
      },
    ]);
    const entry = (await catalog.get('alice'))!;
    expect(Object.keys(entry.posts)).toEqual(['6']);
    expect(entry.posts['6']).not.toHaveProperty('views');
    expect(entry.posts['6']).not.toHaveProperty('kind');
    expect(entry.posts['6']).not.toHaveProperty('mediaUrl');
    expect(entry.account).not.toHaveProperty('avatarUrl');
    expect(entry.account).not.toHaveProperty('followers');
  });

  it('keeps every post with no cap and never evicts a creator', async () => {
    vi.useFakeTimers();
    let clock = NOW;
    const { storage } = memoryStorage();
    const catalog = createProfileCatalog({ storage, now: () => clock, persistDelayMs: 10 });
    // 2000 条帖子，远超老上限 1000：全部保留，不淘汰
    const tweets = Array.from({ length: 2_000 }, (_, i) =>
      tweet(idAt(NOW - DAY - i * 60_000), 'alice', { createdAt: NOW - DAY - i * 60_000 }),
    );
    await catalog.ingest([{ at: NOW, profile: 'alice', tweets, authors: [] }]);
    await vi.advanceTimersByTimeAsync(20);
    expect(Object.keys((await catalog.get('alice'))!.posts)).toHaveLength(2_000);

    // 200 个博主，远超老上限 100：全部保留，最早打开的不被淘汰
    for (let i = 0; i < 200; i += 1) {
      clock += 1;
      await catalog.ingest([{ at: clock, profile: `user_${i}`, tweets: [], authors: [] }]);
    }
    await vi.advanceTimersByTimeAsync(20);
    expect(await catalog.size()).toBe(201);
    expect(await catalog.get('user_0')).not.toBeNull();
    expect(await catalog.get('alice')).not.toBeNull();
  });

  it('only rewrites the shards a post lands in, not the whole catalog', async () => {
    vi.useFakeTimers();
    const { storage } = memoryStorage();
    const set = storage.set as ReturnType<typeof vi.fn>;
    const catalog = createProfileCatalog({ storage, now: () => NOW, persistDelayMs: 10 });
    // 两条帖子，相隔很久 → 落在不同的 30 天窗口分片
    const old = idAt(NOW - 200 * DAY);
    const recent = idAt(NOW - DAY);
    const oldShard = `${PROFILE_META_PREFIX}alice#${shardNo(NOW - 200 * DAY)}`;
    const recentShard = `${PROFILE_META_PREFIX}alice#${shardNo(NOW - DAY)}`;
    expect(oldShard).not.toBe(recentShard);
    await catalog.ingest([
      {
        at: NOW,
        profile: 'alice',
        tweets: [tweet(old, 'alice', { createdAt: NOW - 200 * DAY }), tweet(recent, 'alice')],
        authors: [],
      },
    ]);
    await vi.advanceTimersByTimeAsync(20);

    // 只更新最近那条帖子：写盘只碰它那个分片 + 元数据，不碰老帖子的分片
    set.mockClear();
    await catalog.ingest([
      { at: NOW + 1, tweets: [tweet(recent, 'alice', { views: 9_999 })], authors: [] },
    ]);
    await vi.advanceTimersByTimeAsync(20);
    const written = set.mock.calls.flatMap((call) => Object.keys(call[0] as object));
    expect(written).toContain(recentShard);
    expect(written).not.toContain(oldShard);
    expect((await catalog.get('alice'))!.posts[recent]!.views).toBe(9_999);
  });

  it('migrates a legacy v1 single-blob profile into v2 shards and removes the old key', async () => {
    const legacyKey = `${PROFILE_KEY_PREFIX}alice`;
    const post = { ...tweet(idAt(NOW - DAY), 'alice'), firstSeenAt: NOW - DAY, updatedAt: NOW - DAY };
    const { storage, data } = memoryStorage({
      [PROFILE_INDEX_KEY]: [['alice', NOW - DAY]],
      [legacyKey]: {
        account: { handle: 'alice', followers: 8_000 },
        posts: { [post.postId]: post },
        firstVisitAt: NOW - 10 * DAY,
        lastVisitAt: NOW - DAY,
        remoteCursor: '5_7',
      },
    });
    const catalog = createProfileCatalog({ storage, now: () => NOW, persistDelayMs: 1 });
    const entry = (await catalog.get('alice'))!;
    expect(entry.account.followers).toBe(8_000);
    expect(entry.posts[post.postId]).toBeDefined();
    expect(entry.remoteCursor).toBe('5_7');
    await catalog.flush();
    // 老 key 删掉，新的元数据 + 分片写好
    expect(data[legacyKey]).toBeUndefined();
    expect(data[`${PROFILE_META_PREFIX}alice`]).toBeDefined();
    expect(Object.keys(data).some((k) => k.startsWith(`${PROFILE_META_PREFIX}alice#`))).toBe(true);
  });

  it('persists, survives a restart and clears everything including shards', async () => {
    vi.useFakeTimers();
    const { storage, data } = memoryStorage();
    const broadcast = vi.fn();
    const catalog = createProfileCatalog({
      storage,
      broadcast,
      now: () => NOW,
      persistDelayMs: 10,
      broadcastDelayMs: 10,
    });
    await catalog.ingest([
      { at: NOW, profile: 'alice', tweets: [tweet(idAt(NOW - DAY), 'alice')], authors: [] },
    ]);
    await vi.advanceTimersByTimeAsync(20);
    expect(broadcast).toHaveBeenCalledWith(['alice']);

    // 重启：从盘里把分片读回来
    const restarted = createProfileCatalog({ storage, now: () => NOW });
    expect(Object.keys((await restarted.get('alice'))!.posts)).toHaveLength(1);

    await restarted.clear();
    expect(await restarted.get('alice')).toBeNull();
    expect(Object.keys(data)).toEqual([]);
  });
});
