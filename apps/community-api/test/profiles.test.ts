import { env } from 'cloudflare:workers';
import { count, eq, like } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { accounts, profileAccounts, profilePosts, trainingSampleUsage } from '../src/db/schema';
import worker from '../src/index';
import {
  getProfile,
  ingestProfileObservations,
  PROFILE_PAGE_LIMIT,
  PROFILE_READ_IP_DAILY_LIMIT,
  PROFILE_SETTLE_MS,
  cleanupProfileCounters,
} from '../src/profiles';

const NOW = Date.now();
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const TWITTER_EPOCH = 1288834974657n;
/** 拉取只返回 1 分钟以前提交的变化：读的时刻放到写入之后。 */
const LATER = NOW + PROFILE_SETTLE_MS + 60_000;

/** 发帖时刻对应的真实 snowflake ID（seq 区分同一毫秒的多条）。 */
function snowflake(at: number, seq = 0): string {
  return String(((BigInt(at) - TWITTER_EPOCH) << 22n) + BigInt(seq));
}

function post(at: number, views: number, overrides: Record<string, unknown> = {}, seq = 0) {
  return {
    post_id: snowflake(at, seq),
    handle: 'Alice',
    created_at: at,
    kind: 'original',
    media: 'none',
    snippet: '一条帖子',
    views,
    likes: Math.round(views / 100),
    ...overrides,
  };
}

function session(n: number): string {
  return `0000000000000000-${String(n).padStart(4, '0')}`;
}

const ALICE = [{ handle: 'alice', followers: 5_000 }];

async function ingest(posts: unknown[], reported: unknown[] = ALICE, n = 1, now = NOW) {
  return ingestProfileObservations(
    env,
    { session_id: session(n), posts, accounts: reported },
    '203.0.113.7',
    now,
  );
}

beforeEach(async () => {
  const db = getDb(env);
  await Promise.all([
    db.delete(profilePosts),
    db.delete(profileAccounts),
    db.delete(trainingSampleUsage).where(like(trainingSampleUsage.identity, 'profile-%')),
  ]);
});

describe('POST /v1/profile-observations', () => {
  it('stores posts and the account, and drops forged or malformed posts', async () => {
    const at = NOW - 3 * DAY;
    const response = await worker.fetch(
      new Request('https://api.example.com/v1/profile-observations', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' },
        body: JSON.stringify({
          session_id: session(1),
          accounts: [
            { handle: 'Alice', display_name: 'Alice', followers: 32_000, following_count: 210 },
          ],
          posts: [
            post(at, 12_000),
            post(at, 5, { post_id: 'not-a-number' }, 1),
            // 发帖时间和 ID 对不上：伪造
            post(at, 99_999, { created_at: at - 3 * DAY }, 2),
            // 没有浏览也没有点赞：没有洞察价值
            { post_id: snowflake(at, 3), handle: 'alice', created_at: at },
          ],
        }),
      }),
      env,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: 2, rejected: 3 });
    const profile = (await getProfile(env, 'alice', undefined, LATER))!;
    expect(profile.account?.followers).toBe(32_000);
    expect(profile.posts).toHaveLength(1);
    expect(profile.posts[0]).toMatchObject({
      post_id: snowflake(at),
      views: 12_000,
      kind: 'original',
    });
  });

  it('accepts small accounts and skips accounts on the community blocklist', async () => {
    const at = NOW - DAY;
    const small = await ingest(
      [post(at, 100, { handle: 'tiny' })],
      [{ handle: 'tiny', followers: 999 }],
    );
    expect(small).toEqual({ status: 200, body: { accepted: 2, rejected: 0 } });
    // 没带资料：补一条只有 handle 的账号行，帖子照样收
    expect((await ingest([post(at, 100, { handle: 'nobody' }, 1)], [])).body).toEqual({
      accepted: 1,
      rejected: 0,
    });
    await getDb(env)
      .insert(accounts)
      .values({
        handle: 'spammer',
        reportCount: 5,
        rescueCount: 0,
        // 在公开名单里（快照发布写入）
        listed: 1,
        firstReportAt: Math.floor(NOW / 1000),
        updatedAt: Math.floor(NOW / 1000),
      });
    const spam = await ingest(
      [post(at, 100, { handle: 'spammer' }, 2)],
      [{ handle: 'spammer', followers: 50_000 }],
    );
    expect(spam.body).toEqual({ accepted: 0, rejected: 2 });
    // 资料已经在服务端：之后只带帖子也收
    await ingest([], ALICE);
    expect((await ingest([post(at, 100, {}, 3)], [])).body).toEqual({ accepted: 1, rejected: 0 });
    await getDb(env).delete(accounts).where(eq(accounts.handle, 'spammer'));
  });

  it('keeps the first text: a later report cannot replace it', async () => {
    const at = NOW - DAY;
    await ingest([post(at, 100, { snippet: '原文' })]);
    await ingest([post(at, 200, { snippet: '加我微信' })], undefined, 2);
    const [row] = (await getProfile(env, 'alice', undefined, LATER))!.posts;
    expect(row).toMatchObject({ snippet: '原文', views: 200 });
  });

  it('rejects bad envelopes', async () => {
    expect(
      (await ingestProfileObservations(env, { session_id: 'x', posts: [] }, undefined)).status,
    ).toBe(400);
    expect(
      (await ingestProfileObservations(env, { session_id: session(1) }, undefined)).status,
    ).toBe(400);
    const tooMany = Array.from({ length: 201 }, (_, i) => post(NOW - DAY, 10, {}, i));
    expect((await ingest(tooMany)).status).toBe(400);
  });

  it('merges reports from many people into one row: counts only go up, empty fields do not erase', async () => {
    const at = NOW - 2 * HOUR;
    await ingest(
      [post(at, 1_000, { snippet: '原文', media_url: 'https://pbs.twimg.com/media/a.jpg' })],
      undefined,
      1,
    );
    // 另一个人晚到的旧观测：数字更小、没带正文
    await ingest([post(at, 400, { snippet: undefined, likes: 3 })], undefined, 2);
    // 第三个人看到更新的数字
    await ingest([post(at, 5_000, { likes: 80, pinned: true, snippet: undefined })], undefined, 3);
    const rows = (await getProfile(env, 'alice', undefined, LATER))!.posts;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      views: 5_000,
      likes: 80,
      pinned: true,
      snippet: '原文',
      media_url: 'https://pbs.twimg.com/media/a.jpg',
    });
  });

  it('keeps the first author: a post cannot be moved to another creator', async () => {
    const at = NOW - DAY;
    await ingest([post(at, 100)]);
    await ingest(
      [post(at, 200, { handle: 'mallory' })],
      [{ handle: 'mallory', followers: 9_000 }],
      2,
    );
    const rows = (await getProfile(env, 'alice', undefined, LATER))!.posts;
    // 作者对不上的上报不合并：数字也不记到这条帖子上
    expect(rows[0]).toMatchObject({ views: 100 });
    expect((await getProfile(env, 'mallory', undefined, LATER))!.posts).toEqual([]);
  });

  it('does not let one report zero out a creator, and caps one IP per creator per day', async () => {
    await ingest([], [{ handle: 'alice', followers: 40_000 }]);
    await ingest([], [{ handle: 'alice', followers: 0 }], 2);
    await ingest([], [{ handle: 'alice', followers: 41_000 }], 3);
    const [account] = await getDb(env).select().from(profileAccounts);
    expect(account!.followers).toBe(41_000);

    const { hashIp } = await import('../src/lib/hash');
    const { utcToday } = await import('../src/lib/time');
    const salt = env.HOT_SALT && env.HOT_SALT.length >= 16 ? env.HOT_SALT : env.INSTALLATION_SALT;
    await getDb(env)
      .insert(trainingSampleUsage)
      .values({
        identity: `profile-ip-handle:${await hashIp(salt, '203.0.113.7')}:alice`,
        day: utcToday(),
        count: 2_000,
      });
    const result = await ingest([post(NOW - DAY, 10)], []);
    expect(result.body).toEqual({ accepted: 0, rejected: 1 });
  });

  it('ignores implausible view jumps on old posts', async () => {
    const old = NOW - 10 * DAY;
    const fresh = NOW - 2 * HOUR;
    await ingest([post(old, 2_000), post(fresh, 2_000, {}, 1)]);
    await ingest([post(old, 900_000), post(fresh, 900_000, {}, 1)], undefined, 2);
    const rows = (await getProfile(env, 'alice', undefined, LATER))!.posts;
    const views = Object.fromEntries(rows.map((row) => [row.post_id, row.views]));
    // 老帖子浏览已经稳定：一次涨 450 倍不采信；刚发的帖子可以
    expect(views[snowflake(old)]).toBe(2_000);
    expect(views[snowflake(fresh, 1)]).toBe(900_000);
  });

  it('charges the daily session limit', async () => {
    const db = getDb(env);
    const [usage] = await db
      .select({ n: count() })
      .from(trainingSampleUsage)
      .where(like(trainingSampleUsage.identity, 'profile-session:%'));
    expect(usage!.n).toBe(0);
    await ingest([post(NOW - DAY, 10)]);
    const rows = await db
      .select()
      .from(trainingSampleUsage)
      .where(like(trainingSampleUsage.identity, 'profile-session:%'));
    expect(rows[0]!.count).toBe(2);
    // 会话 ID 只以加盐哈希出现，帖子表里没有上报者
    expect(rows[0]!.identity).not.toContain(session(1));
    expect(Object.keys((await db.select().from(profilePosts))[0]!)).not.toContain('reporter');
  });

  it('stores posts compactly and hands back the same fields', async () => {
    const at = NOW - 5 * DAY;
    await ingest([
      post(at, 3_000_000_000, {
        kind: 'quote',
        media: 'video',
        pinned: true,
        lang: 'zh',
        media_url: 'https://pbs.twimg.com/amplify_video_thumb/1/img/a.jpg',
        likes: 9_000_000_000,
        bookmarks: 12,
      }),
    ]);
    const [row] = await getDb(env).select().from(profilePosts);
    // 表里不存 handle、发帖时间和图片地址前缀
    expect(Object.keys(row!)).not.toContain('handle');
    expect(Object.keys(row!)).not.toContain('createdAt');
    expect(row!.media).toBe('amplify_video_thumb/1/img/a.jpg');
    const [out] = (await getProfile(env, 'alice', undefined, LATER))!.posts;
    expect(out).toEqual({
      post_id: snowflake(at),
      created_at: at,
      kind: 'quote',
      media: 'video',
      pinned: true,
      lang: 'zh',
      snippet: '一条帖子',
      media_url: 'https://pbs.twimg.com/amplify_video_thumb/1/img/a.jpg',
      views: 3_000_000_000,
      // 除浏览以外的计数存 integer：超出的按上限存
      likes: 2_147_483_647,
      bookmarks: 12,
    });
  });

  it('keeps every post of a creator: no cap, nothing deleted', async () => {
    const total = 1_250;
    for (let start = 0; start < total; start += 200) {
      const batch = [];
      for (let i = start; i < Math.min(total, start + 200); i++)
        batch.push(post(NOW - DAY, 10, {}, i));
      await ingest(batch, undefined, 300 + start);
    }
    const [left] = await getDb(env).select({ n: count() }).from(profilePosts);
    expect(left!.n).toBe(total);
  });
});

describe('cleanupProfileCounters', () => {
  it('drops yesterday’s profile rate-limit counters, leaves everything else', async () => {
    const db = getDb(env);
    await db.insert(trainingSampleUsage).values([
      { identity: 'profile-ip:old', day: '2000-01-01', count: 5 },
      { identity: 'hot-ip:old', day: '2000-01-01', count: 5 },
    ]);
    await ingest([post(NOW - DAY, 100)]);
    await cleanupProfileCounters(env);
    const left = (await db.select().from(trainingSampleUsage)).map((r) => r.identity);
    expect(left).toContain('hot-ip:old');
    expect(left).not.toContain('profile-ip:old');
    // 今天的计数和帖子都还在
    expect(left.some((identity) => identity.startsWith('profile-session:'))).toBe(true);
    expect((await getProfile(env, 'alice', undefined, LATER))!.posts).toHaveLength(1);
    await db.delete(trainingSampleUsage).where(eq(trainingSampleUsage.identity, 'hot-ip:old'));
  });
});

describe('GET /v1/profiles/:handle', () => {
  it('waits a minute before handing out a change, so late commits are not skipped', async () => {
    await ingest([post(NOW - DAY, 100)]);
    expect((await getProfile(env, 'alice', undefined, NOW + 1_000))!.posts).toEqual([]);
    expect((await getProfile(env, 'alice', undefined, LATER))!.posts).toHaveLength(1);
  });

  it('a refused number does not move the cursor', async () => {
    const old = NOW - 10 * DAY;
    await ingest([post(old, 5_000)], undefined, 1, NOW - 120_000);
    const first = (await getProfile(env, 'alice', undefined, LATER))!;
    // 老帖子浏览一次涨 100 倍：不采信，也不产生增量
    await ingest([post(old, 500_000)], undefined, 2, NOW - 100_000);
    expect((await getProfile(env, 'alice', first.cursor, LATER))!.posts).toEqual([]);
  });

  it('returns everything first, then only what changed since the cursor', async () => {
    const at = NOW - 3 * DAY;
    await ingest([post(at, 100), post(at, 200, {}, 1)], ALICE, 1, NOW - 10_000);
    const first = (await getProfile(env, 'ALICE', undefined, LATER))!;
    expect(first.posts.map((p) => p.post_id)).toEqual([snowflake(at), snowflake(at, 1)]);
    expect(first.complete).toBe(true);

    // 同样的数字再报一次：不算变化
    await ingest([post(at, 100)], undefined, 2, NOW - 5_000);
    expect((await getProfile(env, 'alice', first.cursor, LATER))!.posts).toEqual([]);

    // 有一条涨了
    await ingest([post(at, 250, {}, 1)], undefined, 3, NOW);
    const next = (await getProfile(env, 'alice', first.cursor, LATER))!;
    expect(next.posts.map((p) => [p.post_id, p.views])).toEqual([[snowflake(at, 1), 250]]);
    expect(next.cursor).not.toBe(first.cursor);
  });

  it('pages through more posts than one response holds without losing rows', async () => {
    const total = PROFILE_PAGE_LIMIT + 50;
    for (let start = 0; start < total; start += 200) {
      const batch = [];
      for (let i = start; i < Math.min(total, start + 200); i++)
        batch.push(post(NOW - DAY, 10, {}, i));
      await ingest(batch, undefined, 200 + start);
    }
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < 5; page++) {
      const result = (await getProfile(env, 'alice', cursor, LATER))!;
      for (const p of result.posts) seen.add(p.post_id);
      cursor = result.cursor;
      if (result.complete) break;
    }
    expect(seen.size).toBe(total);
  });

  it('limits uncached reads per IP', async () => {
    const { hashIp } = await import('../src/lib/hash');
    const { utcToday } = await import('../src/lib/time');
    const salt = env.HOT_SALT && env.HOT_SALT.length >= 16 ? env.HOT_SALT : env.INSTALLATION_SALT;
    await getDb(env)
      .insert(trainingSampleUsage)
      .values({
        identity: `profile-read-ip:${await hashIp(salt, '198.51.100.4')}`,
        day: utcToday(),
        count: PROFILE_READ_IP_DAILY_LIMIT,
      });
    const limited = await worker.fetch(
      new Request('https://api.example.com/v1/profiles/alice', {
        headers: { 'cf-connecting-ip': '198.51.100.4' },
      }),
      env,
    );
    expect(limited.status).toBe(429);
    const other = await worker.fetch(
      new Request('https://api.example.com/v1/profiles/alice', {
        headers: { 'cf-connecting-ip': '198.51.100.5' },
      }),
      env,
    );
    expect(other.status).toBe(200);
  });

  it('validates the handle and the cursor, and is edge-cacheable', async () => {
    const bad = await worker.fetch(
      new Request('https://api.example.com/v1/profiles/bad-handle!'),
      env,
    );
    expect(bad.status).toBe(400);
    const badCursor = await worker.fetch(
      new Request('https://api.example.com/v1/profiles/alice?cursor=xyz'),
      env,
    );
    expect(badCursor.status).toBe(400);
    const ok = await worker.fetch(new Request('https://api.example.com/v1/profiles/alice'), env);
    expect(ok.status).toBe(200);
    // 不带游标的全量：边缘缓存 5 分钟
    expect(ok.headers.get('cache-control')).toContain('s-maxage=300');
    expect(await ok.json()).toMatchObject({
      handle: 'alice',
      account: null,
      posts: [],
      complete: true,
    });
  });
});
