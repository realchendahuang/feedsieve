import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProfileCatalog, type CatalogStorage } from './profile-catalog';
import {
  createProfileSync,
  needsUpload,
  PROFILE_FIRST_UPLOAD_DELAY_MS,
  PROFILE_PULL_INTERVAL_MS,
  PROFILE_UPLOAD_INTERVAL_MS,
  type ProfileUploadPost,
} from './profile-sync';

const NOW = Date.UTC(2026, 9, 31, 12);
const DAY = 24 * 60 * 60 * 1000;

function memoryStorage() {
  const data: Record<string, unknown> = {};
  const storage: CatalogStorage & {
    get(key: string | string[]): Promise<Record<string, unknown>>;
  } = {
    async get(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(
        list.filter((k) => k in data).map((k) => [k, structuredClone(data[k])]),
      );
    },
    async set(items) {
      Object.assign(data, structuredClone(items));
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
    },
  };
  return { data, storage };
}

function tweet(postId: string, views: number, extra: Record<string, unknown> = {}) {
  return {
    postId,
    handle: 'alice',
    createdAt: NOW - 2 * DAY,
    views,
    likes: 10,
    kind: 'original',
    ...extra,
  };
}

function remote(posts: Array<Record<string, unknown>>, cursor: string, complete = true) {
  return {
    handle: 'alice',
    account: { followers: 5_000, updated_at: NOW },
    posts,
    cursor,
    complete,
  };
}

function setup(options: { allowed?: boolean; responses?: unknown[] } = {}) {
  let clock = NOW;
  const { storage } = memoryStorage();
  const catalog = createProfileCatalog({ storage, now: () => clock, persistDelayMs: 1 });
  const uploads: Array<{ posts: ProfileUploadPost[]; accounts: unknown[] }> = [];
  const responses = [...(options.responses ?? [])];
  const fetchProfile = vi.fn<(handle: string, cursor: string | undefined) => Promise<Response>>(
    async () => {
      // 默认：服务端还没有这个博主
      const body = responses.shift() ?? {
        handle: 'alice',
        account: null,
        posts: [],
        cursor: '0_',
        complete: true,
      };
      return new Response(JSON.stringify(body), { status: 200 });
    },
  );
  const post = vi.fn(async (body: { posts: ProfileUploadPost[]; accounts: unknown[] }) => {
    uploads.push(body);
    return new Response('{}', { status: 200 });
  });
  const sync = createProfileSync({
    catalog,
    isAllowed: async () => options.allowed ?? true,
    getSelfHandle: async () => 'me',
    post,
    fetchProfile,
    storage,
    now: () => clock,
    randomId: () => '0000000000000000-0001',
  });
  /** 内容脚本的一批观测：先进本机帖子库，再交给同步（和 background.ts 的顺序一致）。 */
  async function observe(observation: Record<string, unknown>) {
    const batch = [
      {
        at: clock,
        tweets: [],
        authors: [{ handle: 'alice', followers: 5_000 }],
        shareable: true,
        ...observation,
      },
    ];
    await catalog.ingest(batch);
    await sync.observe(batch);
  }
  return {
    catalog,
    sync,
    uploads,
    post,
    fetchProfile,
    observe,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('needsUpload', () => {
  it('uploads what the server does not have, and only real growth after that', () => {
    const base = {
      postId: '1',
      createdAt: NOW,
      firstSeenAt: NOW,
      updatedAt: NOW,
      seenPublic: true,
    };
    expect(needsUpload({ ...base, views: 100 })).toBe(true);
    expect(needsUpload({ ...base, views: 110, syncedViews: 100 })).toBe(false);
    expect(needsUpload({ ...base, views: 130, syncedViews: 100 })).toBe(true);
    expect(needsUpload({ ...base, views: 10_300, syncedViews: 10_000 })).toBe(false);
    expect(needsUpload({ ...base, views: 10_600, syncedViews: 10_000 })).toBe(true);
    expect(needsUpload({ ...base, likes: 3 })).toBe(true);
    expect(needsUpload({ ...base, likes: 3, synced: true })).toBe(false);
    expect(needsUpload({ postId: '2', views: 5, firstSeenAt: NOW, updatedAt: NOW })).toBe(false);
    // 只在书签、通知等页面看到过的
    expect(needsUpload({ ...base, views: 100, seenPublic: undefined })).toBe(false);
  });
});

describe('createProfileSync', () => {
  it('pulls the shared library when a profile is opened, so the second person starts with data', async () => {
    const t = setup({
      responses: [
        remote(
          [{ post_id: '10', created_at: NOW - 3 * DAY, views: 9_000, kind: 'original' }],
          '1_10',
        ),
      ],
    });
    await t.observe({ profile: 'alice', tweets: [tweet('11', 300)] });
    await vi.runAllTimersAsync();
    expect(t.fetchProfile).toHaveBeenCalledWith('alice', undefined);
    const entry = (await t.catalog.get('alice'))!;
    expect(Object.keys(entry.posts).sort()).toEqual(['10', '11']);
    expect(entry.posts['10']).toMatchObject({ views: 9_000, syncedViews: 9_000, synced: true });
    expect(entry.account.followers).toBe(5_000);
    expect(entry.remoteCursor).toBe('1_10');
  });

  it('pulls again only after the interval, with the cursor (incremental)', async () => {
    const t = setup({ responses: [remote([], '5_1'), remote([], '6_2')] });
    await t.observe({ profile: 'alice' });
    await vi.runAllTimersAsync();
    await t.observe({ profile: 'alice' });
    await vi.runAllTimersAsync();
    expect(t.fetchProfile).toHaveBeenCalledTimes(1);
    t.advance(PROFILE_PULL_INTERVAL_MS + 1);
    await t.observe({ profile: 'alice' });
    await vi.runAllTimersAsync();
    expect(t.fetchProfile).toHaveBeenLastCalledWith('alice', '5_1');
  });

  it('uploads only posts the server does not know yet, in batches', async () => {
    const t = setup({
      responses: [remote([{ post_id: '10', created_at: NOW - 3 * DAY, views: 9_000 }], '1_10')],
    });
    await t.observe({ profile: 'alice', tweets: [tweet('10', 9_100), tweet('11', 300)] });
    await vi.runAllTimersAsync();
    // 第一次上报在 1 分钟后
    expect(t.post).not.toHaveBeenCalled();
    t.advance(PROFILE_FIRST_UPLOAD_DELAY_MS);
    await t.observe({ tweets: [tweet('12', 50)] });
    expect(t.uploads).toHaveLength(1);
    // 10 号服务端已经有 9000，本机 9100 只涨了 1%：不报
    expect(t.uploads[0]!.posts.map((p) => p.post_id).sort()).toEqual(['11', '12']);
    expect(t.uploads[0]!.posts.every((p) => p.handle === 'alice')).toBe(true);

    // 报过的不再报；涨够了再报
    t.advance(PROFILE_UPLOAD_INTERVAL_MS);
    await t.observe({ tweets: [tweet('11', 310)] });
    expect(t.uploads).toHaveLength(1);
    t.advance(PROFILE_UPLOAD_INTERVAL_MS);
    await t.observe({ tweets: [tweet('11', 900)] });
    expect(t.uploads).toHaveLength(2);
    expect(t.uploads[1]!.posts.map((p) => [p.post_id, p.views])).toEqual([['11', 900]]);
  });

  it('keeps unsent posts for the next round when the server refuses', async () => {
    const t = setup();
    t.post.mockResolvedValueOnce(new Response('{}', { status: 429 }));
    await t.observe({ profile: 'alice', tweets: [tweet('11', 300)] });
    t.advance(PROFILE_FIRST_UPLOAD_DELAY_MS);
    await t.observe({});
    expect(t.post).toHaveBeenCalledTimes(1);
    t.advance(PROFILE_UPLOAD_INTERVAL_MS);
    await t.observe({});
    expect(t.uploads.at(-1)!.posts.map((p) => p.post_id)).toEqual(['11']);
  });

  it('does nothing in local-only mode, and never uploads protected accounts', async () => {
    const local = setup({ allowed: false });
    await local.observe({ profile: 'alice', tweets: [tweet('11', 300)] });
    local.advance(PROFILE_FIRST_UPLOAD_DELAY_MS);
    await local.observe({ tweets: [tweet('12', 300)] });
    await vi.runAllTimersAsync();
    expect(local.fetchProfile).not.toHaveBeenCalled();
    expect(local.post).not.toHaveBeenCalled();

    const locked = setup();
    await locked.observe({ profile: 'alice', tweets: [tweet('11', 300, { protected: true })] });
    locked.advance(PROFILE_FIRST_UPLOAD_DELAY_MS);
    await locked.observe({ tweets: [tweet('12', 300)] });
    expect(locked.post).not.toHaveBeenCalled();
  });

  it('does not upload posts seen only on private pages (bookmarks, notifications…)', async () => {
    const t = setup();
    await t.observe({ profile: 'alice' });
    await t.observe({ shareable: false, tweets: [tweet('11', 300)] });
    t.advance(PROFILE_FIRST_UPLOAD_DELAY_MS);
    await t.observe({ shareable: false, tweets: [tweet('12', 300)] });
    // 只报了主页上看到的博主资料，没有帖子
    expect(t.uploads.flatMap((u) => u.posts)).toEqual([]);
    // 之后在公开页面上也看到了：可以报
    t.advance(PROFILE_UPLOAD_INTERVAL_MS);
    await t.observe({ tweets: [tweet('11', 300)] });
    expect(t.uploads.at(-1)!.posts.map((p) => p.post_id)).toEqual(['11']);
  });

  it('does not upload creators under 1000 followers', async () => {
    const t = setup();
    await t.observe({
      profile: 'alice',
      authors: [{ handle: 'alice', followers: 999 }],
      tweets: [tweet('11', 300)],
    });
    t.advance(PROFILE_FIRST_UPLOAD_DELAY_MS);
    await t.observe({ authors: [{ handle: 'alice', followers: 999 }], tweets: [tweet('12', 300)] });
    expect(t.post).not.toHaveBeenCalled();
  });

  it('sends the creator profile with the first batch, then only when followers change', async () => {
    const t = setup();
    await t.observe({ profile: 'alice', tweets: [tweet('11', 300)] });
    t.advance(PROFILE_FIRST_UPLOAD_DELAY_MS);
    await t.observe({});
    expect(t.uploads[0]!.accounts).toEqual([{ handle: 'alice', followers: 5_000 }]);
    t.advance(PROFILE_UPLOAD_INTERVAL_MS);
    await t.observe({ tweets: [tweet('11', 900)] });
    expect(t.uploads[1]!.accounts).toEqual([]);
  });

  it('puts the round back when the network fails, and backs off a failed pull', async () => {
    const t = setup();
    t.fetchProfile.mockRejectedValueOnce(new Error('offline'));
    t.post.mockRejectedValueOnce(new Error('offline'));
    await t.observe({ profile: 'alice', tweets: [tweet('11', 300)] });
    await vi.runAllTimersAsync();
    // 拉取失败后 1 分钟内不重拉
    await t.observe({ profile: 'alice' });
    await vi.runAllTimersAsync();
    expect(t.fetchProfile).toHaveBeenCalledTimes(1);
    t.advance(PROFILE_FIRST_UPLOAD_DELAY_MS);
    await t.observe({ profile: 'alice' });
    await vi.runAllTimersAsync();
    expect(t.fetchProfile).toHaveBeenCalledTimes(2);
    expect(t.post).toHaveBeenCalledTimes(1);
    expect(t.sync.pendingCount()).toBe(1);
    t.advance(PROFILE_UPLOAD_INTERVAL_MS);
    await t.observe({});
    expect(t.uploads.at(-1)!.posts.map((p) => p.post_id)).toEqual(['11']);
  });

  it('only syncs creators whose profile was opened', async () => {
    const t = setup();
    await t.observe({ tweets: [tweet('11', 300)] });
    t.advance(PROFILE_FIRST_UPLOAD_DELAY_MS);
    await t.observe({ tweets: [tweet('12', 300)] });
    await vi.runAllTimersAsync();
    expect(t.post).not.toHaveBeenCalled();
    expect(t.fetchProfile).not.toHaveBeenCalled();
  });
});
