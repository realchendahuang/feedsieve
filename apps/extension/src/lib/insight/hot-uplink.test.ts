import { describe, expect, it, vi } from 'vitest';
import {
  createHotUplink,
  HOT_FIRST_UPLOAD_DELAY_MS,
  HOT_OBSERVATION_MAX_AGE_MS,
  HOT_UPLOAD_INTERVAL_MS,
  HOT_UPLOAD_MAX_PER_ROUND,
  HOT_UPLOAD_MIN_VELOCITY,
  type HotUplinkDeps,
  type HotUploadItem,
} from './hot-uplink';

type PostBody = { session_id: string; observations: HotUploadItem[] };

const NOW = Date.UTC(2026, 9, 30, 12);

function memory(initial: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = { ...initial };
  return {
    data,
    get: async (key: string) => (key in data ? { [key]: structuredClone(data[key]) } : {}),
    set: async (items: Record<string, unknown>) => {
      Object.assign(data, structuredClone(items));
    },
  };
}

function setup(overrides: Partial<HotUplinkDeps> = {}) {
  let now = NOW;
  // 大多数用例跳过「第一次延后 2 分钟」：假装很久以前上报过
  const state = memory({ hotUplinkStateV1: { lastUploadAt: 0 } });
  // 默认每条都在火；个别帖子用 velocities 覆盖
  const velocities = new Map<string, number | null>();
  const stored: Record<string, unknown> = {};
  const post = vi.fn<(body: PostBody) => Promise<Response>>(
    async () => new Response('{}', { status: 200 }),
  );
  const uplink = createHotUplink({
    isAllowed: async () => true,
    getSelfHandle: async () => 'me',
    velocityOf: async (postId) =>
      velocities.has(postId) ? velocities.get(postId)! : HOT_UPLOAD_MIN_VELOCITY * 2,
    post,
    storage: {
      get: async (key) => (key in stored ? { [key]: stored[key] } : {}),
      set: async (items) => {
        Object.assign(stored, items);
      },
    },
    stateStorage: state,
    now: () => now,
    randomId: () => 'session-0000000000000001',
    ...overrides,
  });
  return { uplink, post, velocities, advance: (ms: number) => (now += ms) };
}

function observation(tweets: Array<Record<string, unknown>>, shareable = true) {
  return [
    {
      at: NOW,
      shareable,
      tweets: tweets.map((tweet) => ({ createdAt: NOW - 3_600_000, views: 1_000, ...tweet })),
      authors: [{ handle: 'alice', followers: 3_000 }],
    },
  ];
}

describe('createHotUplink', () => {
  it('only uploads posts that are heating up and drops the rest', async () => {
    const { uplink, post, velocities } = setup();
    velocities.set('2', HOT_UPLOAD_MIN_VELOCITY - 1);
    velocities.set('3', null); // 算不出流速（太老 / 没有浏览数）
    await uplink.observe(
      observation([
        { postId: '1', handle: 'alice' },
        { postId: '2', handle: 'alice' },
        { postId: '3', handle: 'alice' },
      ]),
    );
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0]![0]!.observations.map((item) => item.post_id)).toEqual(['1']);
    // 不火的不留着等下一轮
    expect(uplink.pendingCount()).toBe(0);
  });

  it('sends nothing at all when nothing is heating up', async () => {
    const { uplink, post, velocities } = setup();
    velocities.set('1', 50);
    await uplink.observe(observation([{ postId: '1', handle: 'alice' }]));
    expect(post).not.toHaveBeenCalled();
  });

  it('waits two minutes before the first upload and survives a service worker restart', async () => {
    let now = NOW;
    const state = memory();
    const post = vi.fn<(body: PostBody) => Promise<Response>>(
      async () => new Response('{}', { status: 200 }),
    );
    const make = () =>
      createHotUplink({
        isAllowed: async () => true,
        getSelfHandle: async () => null,
        velocityOf: async () => HOT_UPLOAD_MIN_VELOCITY * 2,
        post,
        storage: memory(),
        stateStorage: state,
        now: () => now,
      });
    await make().observe(observation([{ postId: '1', handle: 'alice' }]));
    expect(post).not.toHaveBeenCalled();
    // service worker 被回收后重新唤醒：待发队列还在
    now += HOT_FIRST_UPLOAD_DELAY_MS;
    const restarted = make();
    await restarted.observe(observation([{ postId: '2', handle: 'alice' }]));
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0]![0]!.observations.map((item) => item.post_id)).toEqual(['1', '2']);
  });

  it('waits 15 minutes between uploads by default', () => {
    expect(HOT_UPLOAD_INTERVAL_MS).toBe(15 * 60 * 1000);
    expect(HOT_UPLOAD_MIN_VELOCITY).toBe(1_000);
  });

  it('uploads public posts with only the fields the hot list needs', async () => {
    const { uplink, post } = setup();
    await uplink.observe(
      observation([
        {
          postId: '1',
          handle: 'alice',
          displayName: 'Alice',
          snippet: 'x'.repeat(1000),
          avatarUrl: 'https://pbs.twimg.com/profile_images/1/a_normal.jpg',
          likes: 5,
        },
      ]),
    );
    expect(post).toHaveBeenCalledTimes(1);
    const body = post.mock.calls[0]![0]!;
    expect(body.session_id).toBe('session-0000000000000001');
    expect(body.observations).toEqual([
      {
        post_id: '1',
        handle: 'alice',
        display_name: 'Alice',
        avatar_url: 'https://pbs.twimg.com/profile_images/1/a_normal.jpg',
        followers: 3_000,
        created_at: NOW - 3_600_000,
        snippet: 'x'.repeat(280),
        views: 1_000,
        likes: 5,
        observed_at: NOW,
      },
    ]);
  });

  it('never uploads the user’s own posts, protected accounts or private pages', async () => {
    const { uplink, post } = setup();
    await uplink.observe(
      observation([
        { postId: '1', handle: 'me' },
        { postId: '2', handle: 'locked', protected: true },
      ]),
    );
    await uplink.observe(observation([{ postId: '3', handle: 'alice' }], false));
    expect(post).not.toHaveBeenCalled();
    expect(uplink.pendingCount()).toBe(0);
  });

  it('uploads at most once per interval and keeps the newest observation per post', async () => {
    const { uplink, post, advance } = setup();
    await uplink.observe(observation([{ postId: '1', handle: 'alice' }]));
    expect(post).toHaveBeenCalledTimes(1);
    await uplink.observe(observation([{ postId: '1', handle: 'alice', views: 2_000 }]));
    await uplink.observe(observation([{ postId: '1', handle: 'alice', views: 3_000 }]));
    expect(post).toHaveBeenCalledTimes(1);
    advance(HOT_UPLOAD_INTERVAL_MS);
    await uplink.observe(observation([{ postId: '2', handle: 'alice' }]));
    expect(post).toHaveBeenCalledTimes(2);
    const views = post.mock.calls[1]![0]!.observations.map((item) => item.views);
    expect(views).toEqual([3_000, 1_000]);
  });

  it('keeps the batch when the server fails and backs off before retrying', async () => {
    const post = vi.fn<(body: PostBody) => Promise<Response>>(
      async () => new Response('{}', { status: 503 }),
    );
    const { uplink, advance } = setup({ post });
    await uplink.observe(observation([{ postId: '1', handle: 'alice' }]));
    expect(uplink.pendingCount()).toBe(1);
    post.mockImplementation(async () => new Response('{}', { status: 200 }));
    // 第一次失败退避两个间隔：一个间隔后还不重发
    advance(HOT_UPLOAD_INTERVAL_MS);
    await uplink.observe(observation([{ postId: '2', handle: 'alice' }]));
    expect(post).toHaveBeenCalledTimes(1);
    expect(uplink.pendingCount()).toBe(2);
    advance(HOT_UPLOAD_INTERVAL_MS);
    await uplink.observe(observation([{ postId: '3', handle: 'alice' }]));
    expect(post).toHaveBeenCalledTimes(2);
    expect(uplink.pendingCount()).toBe(0);
  });

  it('waits as long as the server says when the daily limit is used up', async () => {
    const post = vi.fn<(body: PostBody) => Promise<Response>>(
      async () =>
        new Response(JSON.stringify({ error: 'rate_limited', retry_after_ms: 3 * 3_600_000 }), {
          status: 429,
        }),
    );
    const { uplink, advance } = setup({ post });
    await uplink.observe(observation([{ postId: '1', handle: 'alice' }]));
    advance(2 * 3_600_000);
    await uplink.observe(observation([{ postId: '2', handle: 'alice' }]));
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('follows the upload interval the server asks for', async () => {
    const post = vi.fn<(body: PostBody) => Promise<Response>>(
      async () => new Response(JSON.stringify({ next_upload_ms: 40 * 60_000 }), { status: 200 }),
    );
    const { uplink, advance } = setup({ post });
    await uplink.observe(observation([{ postId: '1', handle: 'alice' }]));
    advance(30 * 60_000);
    await uplink.observe(observation([{ postId: '2', handle: 'alice' }]));
    expect(post).toHaveBeenCalledTimes(1);
    advance(10 * 60_000);
    await uplink.observe(observation([{ postId: '3', handle: 'alice' }]));
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('drops observations the server would reject as too old', async () => {
    const { uplink, post, advance } = setup();
    // 先占住这一轮
    await uplink.observe(observation([{ postId: '1', handle: 'alice' }]));
    await uplink.observe(observation([{ postId: '2', handle: 'alice' }]));
    advance(HOT_OBSERVATION_MAX_AGE_MS + 60_000);
    await uplink.observe([
      {
        at: NOW + HOT_OBSERVATION_MAX_AGE_MS,
        shareable: true,
        tweets: [{ postId: '3', handle: 'alice', createdAt: NOW, views: 5 }],
        authors: [],
      },
    ]);
    expect(post.mock.calls[1]![0]!.observations.map((item) => item.post_id)).toEqual(['3']);
  });

  it('does not resend a post whose numbers barely moved', async () => {
    const { uplink, post, advance } = setup();
    await uplink.observe(observation([{ postId: '1', handle: 'alice', views: 10_000 }]));
    advance(HOT_UPLOAD_INTERVAL_MS);
    await uplink.observe(observation([{ postId: '1', handle: 'alice', views: 10_200 }]));
    expect(post).toHaveBeenCalledTimes(1);
    advance(HOT_UPLOAD_INTERVAL_MS);
    await uplink.observe(observation([{ postId: '1', handle: 'alice', views: 12_000 }]));
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('sends the fastest posts first and at most one round’s worth', async () => {
    const { uplink, post, velocities } = setup();
    const tweets = Array.from({ length: HOT_UPLOAD_MAX_PER_ROUND + 50 }, (_, i) => {
      velocities.set(String(i + 1), HOT_UPLOAD_MIN_VELOCITY + i);
      return { postId: String(i + 1), handle: 'alice' };
    });
    await uplink.observe(observation(tweets));
    const sentIds = post.mock.calls.flatMap(([body]) =>
      body.observations.map((item) => item.post_id),
    );
    expect(sentIds).toHaveLength(HOT_UPLOAD_MAX_PER_ROUND);
    expect(sentIds[0]).toBe(String(HOT_UPLOAD_MAX_PER_ROUND + 50));
  });

  it('never uploads posts X marks as possibly sensitive', async () => {
    const { uplink, post } = setup();
    await uplink.observe(observation([{ postId: '1', handle: 'alice', sensitive: true }]));
    expect(post).not.toHaveBeenCalled();
    expect(uplink.pendingCount()).toBe(0);
  });

  it('stops collecting as soon as the user opts out', async () => {
    let allowed = true;
    const { uplink, post, advance } = setup({ isAllowed: async () => allowed });
    await uplink.observe(observation([{ postId: '1', handle: 'alice' }]));
    await uplink.observe(observation([{ postId: '2', handle: 'alice' }]));
    expect(uplink.pendingCount()).toBe(1);
    allowed = false;
    await uplink.observe(observation([{ postId: '3', handle: 'alice' }]));
    expect(uplink.pendingCount()).toBe(0);
    advance(HOT_UPLOAD_INTERVAL_MS);
    await uplink.observe(observation([{ postId: '4', handle: 'alice' }]));
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('sends nothing and drops pending data when the user opts out', async () => {
    const { uplink, post } = setup({ isAllowed: async () => false });
    await uplink.observe(observation([{ postId: '1', handle: 'alice' }]));
    expect(post).not.toHaveBeenCalled();
    expect(uplink.pendingCount()).toBe(0);
  });
});
