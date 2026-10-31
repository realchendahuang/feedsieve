import { env } from 'cloudflare:workers';
import { count, eq, like } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { accounts, hotObservations, hotPosts, meta, trainingSampleUsage } from '../src/db/schema';
import worker from '../src/index';
import {
  boardDecay,
  capPerAuthor,
  cleanupHotData,
  computeHotBoards,
  getHotBoards,
  ingestObservations,
  ipNet,
  MIN_REPORTERS,
  reporterThreshold,
} from '../src/hot';

const NOW = Date.now();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** 固定门槛 3 的部署（默认按活跃人数自动定，测试里人少会是 1）。 */
const strict = { ...env, HOT_MIN_REPORTERS: String(MIN_REPORTERS) };

function observation(postId: string, views: number, overrides: Record<string, unknown> = {}) {
  return {
    post_id: postId,
    handle: 'alice',
    display_name: 'Alice',
    avatar_url: 'https://pbs.twimg.com/profile_images/1/a_normal.jpg',
    verified: true,
    followers: 3_000,
    created_at: NOW - 3 * HOUR,
    snippet: '一条很热的帖子',
    views,
    likes: 120,
    replies: 8,
    observed_at: NOW - MINUTE,
    ...overrides,
  };
}

function session(n: number): string {
  return `0000000000000000-${String(n).padStart(4, '0')}`;
}

/** 每个会话一个不同的 /24 网段。 */
function ipOf(n: number): string {
  return `198.51.${n % 250}.7`;
}

async function report(
  sessions: number[],
  items: Array<Record<string, unknown>>,
  ip: (n: number) => string | undefined = ipOf,
) {
  for (const n of sessions) {
    await ingestObservations(env, { session_id: session(n), observations: items }, ip(n));
  }
}

beforeEach(async () => {
  const db = getDb(env);
  await Promise.all([
    db.delete(hotPosts),
    db.delete(hotObservations),
    db.delete(meta).where(like(meta.key, 'hot:%')),
    db.delete(trainingSampleUsage).where(like(trainingSampleUsage.identity, 'hot-%')),
  ]);
});

describe('POST /v1/observations', () => {
  it('accepts valid observations, drops malformed ones and tells the client when to upload next', async () => {
    const response = await worker.fetch(
      new Request('https://api.example.com/v1/observations', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' },
        body: JSON.stringify({
          session_id: session(1),
          observations: [
            observation('100', 50_000),
            observation('bad-id', 1),
            observation('101', 10, { observed_at: NOW + 60 * MINUTE }), // 未来的观测时刻
            observation('102', 10, { avatar_url: 'https://evil.example/a.jpg' }), // 头像不合法：只丢字段
          ],
        }),
      }),
      env,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      accepted: 2,
      rejected: 2,
      next_upload_ms: 15 * MINUTE,
    });
    const [row] = await getDb(env)
      .select({ avatarUrl: hotPosts.avatarUrl })
      .from(hotPosts)
      .where(eq(hotPosts.postId, '102'));
    expect(row?.avatarUrl).toBeNull();
  });

  it('accepts observations from earlier in the upload interval, but not stale ones', async () => {
    const result = await ingestObservations(
      env,
      {
        session_id: session(2),
        observations: [
          observation('110', 5_000, { observed_at: NOW - 60 * MINUTE }),
          observation('111', 5_000, { observed_at: NOW - 100 * MINUTE }),
        ],
      },
      undefined,
      NOW,
    );
    expect(result).toMatchObject({ status: 200, body: { accepted: 1, rejected: 1 } });
  });

  it('lets the deployment stretch the upload interval', async () => {
    const result = await ingestObservations(
      { ...env, HOT_UPLOAD_INTERVAL_MIN: '45' },
      { session_id: session(3), observations: [observation('120', 5_000)] },
      undefined,
    );
    expect(result).toMatchObject({ body: { next_upload_ms: 45 * MINUTE } });
  });

  it('records the reporter network as a short salted hash', async () => {
    await ingestObservations(
      env,
      { session_id: session(4), observations: [observation('130', 5_000)] },
      '203.0.113.9',
    );
    const [row] = await getDb(env)
      .select({ net: hotObservations.net })
      .from(hotObservations)
      .where(eq(hotObservations.postId, '130'));
    expect(row?.net).toMatch(/^[0-9a-f]{16}$/);
    expect(ipNet('203.0.113.9')).toBe(ipNet('203.0.113.200'));
    expect(ipNet('2001:db8:1:2::1')).toBe(ipNet('2001:db8:1:ffff::9'));
    // 同一个 /48 的不同写法是同一段；IPv4 映射地址按 IPv4 算
    expect(ipNet('2001:db8::1')).toBe(ipNet('2001:0db8:0000:1::5'));
    expect(ipNet('2001:db8::1')).not.toBe(ipNet('2001:db9::1'));
    expect(ipNet('::ffff:203.0.113.9')).toBe(ipNet('203.0.113.4'));
  });

  it('works with its own salt even when the shared installation salt is unusable', async () => {
    const result = await ingestObservations(
      { ...env, INSTALLATION_SALT: 'short', HOT_SALT: 'hot-salt-0123456789abcdef' },
      { session_id: session(42), observations: [observation('150', 5_000)] },
      '203.0.113.7',
    );
    expect(result).toMatchObject({ status: 200, body: { accepted: 1, rejected: 0 } });
  });

  it('rejects requests without a session id or with too many observations', async () => {
    expect(
      (await ingestObservations(env, { observations: [observation('1', 1)] }, undefined)).status,
    ).toBe(400);
    const tooMany = Array.from({ length: 101 }, (_, i) => observation(String(i + 1), 1));
    expect(
      (await ingestObservations(env, { session_id: session(1), observations: tooMany }, undefined))
        .status,
    ).toBe(400);
  });

  it('rate limits a single session per day and says when to retry', async () => {
    const ingest = () =>
      ingestObservations(
        env,
        { session_id: session(9), observations: [observation('140', 10)] },
        undefined,
      );
    expect((await ingest()).status).toBe(200);
    await getDb(env)
      .update(trainingSampleUsage)
      .set({ count: 5_000 })
      .where(like(trainingSampleUsage.identity, 'hot-session:%'));
    const limited = await ingest();
    expect(limited.status).toBe(429);
    const retry = (limited.body as { retry_after_ms?: number }).retry_after_ms ?? 0;
    expect(retry).toBeGreaterThan(0);
    expect(retry).toBeLessThanOrEqual(24 * HOUR);
  });

  it('skips rewriting a post row when many people report the same numbers', async () => {
    await report([1], [observation('160', 5_000, { snippet: '第一版' })]);
    await report([2], [observation('160', 5_000, { snippet: '第二版' })]);
    const [same] = await getDb(env)
      .select({ snippet: hotPosts.snippet })
      .from(hotPosts)
      .where(eq(hotPosts.postId, '160'));
    expect(same?.snippet).toBe('第一版');
    await report([3], [observation('160', 6_000, { snippet: '第三版' })]);
    const [grown] = await getDb(env)
      .select({ snippet: hotPosts.snippet, views: hotPosts.views })
      .from(hotPosts)
      .where(eq(hotPosts.postId, '160'));
    expect(grown).toEqual({ snippet: '第三版', views: 6_000 });
  });
});

describe('usage limits are charged in order', () => {
  const usage = () =>
    getDb(env)
      .select({ identity: trainingSampleUsage.identity, count: trainingSampleUsage.count })
      .from(trainingSampleUsage)
      .where(like(trainingSampleUsage.identity, 'hot-%'));
  const ingest = (n: number) =>
    ingestObservations(
      env,
      { session_id: session(7), observations: [observation(String(3000 + n), 10)] },
      '203.0.113.77',
    );

  it('does not charge the IP when the session limit is exceeded', async () => {
    expect((await ingest(1)).status).toBe(200);
    await getDb(env)
      .update(trainingSampleUsage)
      .set({ count: 5_000 })
      .where(like(trainingSampleUsage.identity, 'hot-session:%'));
    expect((await ingest(2)).status).toBe(429);
    const rows = await usage();
    expect(rows.find((row) => row.identity.startsWith('hot-session:'))?.count).toBe(5_000);
    expect(rows.find((row) => row.identity.startsWith('hot-ip:'))?.count).toBe(1);
  });

  it('keeps the session charge when only the IP limit is exceeded', async () => {
    expect((await ingest(3)).status).toBe(200);
    await getDb(env)
      .update(trainingSampleUsage)
      .set({ count: 50_000 })
      .where(like(trainingSampleUsage.identity, 'hot-ip:%'));
    expect((await ingest(4)).status).toBe(429);
    const rows = await usage();
    expect(rows.find((row) => row.identity.startsWith('hot-session:'))?.count).toBe(2);
    expect(rows.find((row) => row.identity.startsWith('hot-ip:'))?.count).toBe(50_000);
  });
});

describe('reporter threshold', () => {
  it('scales with the number of active reporters unless the deployment pins it', () => {
    expect(reporterThreshold(env, 0)).toBe(1);
    expect(reporterThreshold(env, 19)).toBe(1);
    expect(reporterThreshold(env, 20)).toBe(2);
    expect(reporterThreshold(env, 100)).toBe(3);
    expect(reporterThreshold({ ...env, HOT_MIN_REPORTERS: '5' }, 0)).toBe(5);
    expect(reporterThreshold({ ...env, HOT_MIN_REPORTERS: '0' }, 0)).toBe(1);
  });
});

describe('hot boards', () => {
  it('only lists posts seen by enough different sessions', async () => {
    await report([1, 2], [observation('200', 80_000)]);
    expect((await computeHotBoards(strict, NOW)).rising).toHaveLength(0);
    await report([3], [observation('200', 80_000)]);
    const { rising } = await computeHotBoards(strict, NOW);
    expect(rising.map((post) => post.postId)).toEqual(['200']);
    expect(rising[0]).toMatchObject({
      handle: 'alice',
      displayName: 'Alice',
      verified: true,
      snippet: '一条很热的帖子',
      views: 80_000,
    });
    expect(rising[0]!.velocity).toBeGreaterThan(0);
  });

  it('needs reporters from more than one network', async () => {
    // 同一个 IP 段换三个会话：凑不出人数
    await report([1, 2, 3], [observation('210', 80_000)], (n) => `198.51.100.${n}`);
    expect((await computeHotBoards(strict, NOW)).rising).toHaveLength(0);
    await report([4], [observation('210', 80_000)], () => '192.0.2.1');
    expect((await computeHotBoards(strict, NOW)).rising.map((p) => p.postId)).toEqual(['210']);
  });

  it('needs more than one recent reporter for the rising board', async () => {
    // 三个人一个多小时前看过，最近只剩一个人在报：进「24 小时」，不进「飙升」
    await report([1, 2], [observation('220', 80_000, { observed_at: NOW - 80 * MINUTE })], ipOf);
    await report([3], [observation('220', 120_000)]);
    const { rising, day } = await computeHotBoards(strict, NOW + 30 * MINUTE);
    expect(rising.map((p) => p.postId)).toEqual([]);
    expect(day.map((p) => p.postId)).toEqual(['220']);
  });

  it('lets a single reporter in during cold start', async () => {
    await report([1], [observation('250', 50_000, { lang: 'zh' })]);
    expect((await computeHotBoards(strict, NOW)).rising).toHaveLength(0);
    const { rising, threshold } = await computeHotBoards(env, NOW);
    expect(threshold).toBe(1);
    expect(rising[0]).toMatchObject({ postId: '250', lang: 'zh' });
  });

  it('uses the median across sessions, so one inflated report cannot move a post', async () => {
    await report([1], [observation('300', 10_000)]);
    await report([2], [observation('300', 10_200)]);
    await report([3], [observation('300', 9_900_000)]);
    const [post] = (await computeHotBoards(strict, NOW)).rising;
    expect(post?.views).toBe(10_200);
  });

  it('measures the recent speed, not the average over the whole window', async () => {
    await report(
      [1, 2, 3],
      [
        observation('400', 100_000, { observed_at: NOW - 85 * MINUTE }),
        observation('400', 110_000, { observed_at: NOW - 45 * MINUTE }),
        observation('400', 170_000, { observed_at: NOW - MINUTE }),
      ],
    );
    const [post] = (await computeHotBoards(strict, NOW)).rising;
    // 最近 40 分钟涨了 6 万（每小时约 8–9 万）；整段平均只有每小时 4–5 万
    expect(post!.velocity).toBeGreaterThan(65_000);
  });

  it('demotes posts that have been on the board for hours and drops them after 12 hours', async () => {
    await report([1], [observation('410', 80_000), observation('411', 80_000)]);
    await report([1], [observation('412', 80_000)]);
    const db = getDb(env);
    await db
      .update(hotPosts)
      .set({ firstSeen: NOW - 9 * HOUR })
      .where(eq(hotPosts.postId, '410'));
    await db
      .update(hotPosts)
      .set({ firstSeen: NOW - 13 * HOUR })
      .where(eq(hotPosts.postId, '412'));
    // 三条来自不同作者，避开每人 2 条的上限
    await db.update(hotPosts).set({ handle: 'bob' }).where(eq(hotPosts.postId, '411'));
    await db.update(hotPosts).set({ handle: 'carol' }).where(eq(hotPosts.postId, '412'));
    const { rising, day } = await computeHotBoards(env, NOW);
    expect(rising.map((post) => post.postId)).toEqual(['411', '410']);
    expect(day.map((post) => post.postId)).toContain('412');
    expect(boardDecay(6)).toBe(1);
    expect(boardDecay(9)).toBeCloseTo(0.5);
  });

  it('caps each author at two places', async () => {
    await report(
      [1],
      [observation('420', 90_000), observation('421', 80_000), observation('422', 70_000)],
    );
    const { rising } = await computeHotBoards(env, NOW);
    expect(rising.map((post) => post.postId)).toEqual(['420', '421']);
    expect(capPerAuthor([{ handle: 'a' }, { handle: 'a' }, { handle: 'b' }], 1, 10)).toEqual([
      { handle: 'a' },
      { handle: 'b' },
    ]);
  });

  it('ranks the 24-hour board by views and keeps posts that have cooled down', async () => {
    await report(
      [1],
      [
        observation('430', 2_000_000, {
          handle: 'bob',
          created_at: NOW - 20 * HOUR,
          observed_at: NOW - 70 * MINUTE,
        }),
        observation('430', 2_000_000, { handle: 'bob', created_at: NOW - 20 * HOUR }),
        observation('431', 90_000),
      ],
    );
    const { rising, day } = await computeHotBoards(env, NOW);
    expect(day.map((post) => post.postId)).toEqual(['430', '431']);
    expect(rising.map((post) => post.postId)).toEqual(['431']);
  });

  it('keeps porn bait off the board', async () => {
    await report([1], [observation('440', 90_000, { snippet: '福利在主页，私我' })]);
    const { rising, day } = await computeHotBoards(env, NOW);
    expect(rising).toHaveLength(0);
    expect(day).toHaveLength(0);
  });

  it('keeps community-blocklisted authors off the list', async () => {
    await getDb(env)
      .insert(accounts)
      .values({
        handle: 'spammer',
        category: 'bot_spam',
        reportCount: 5,
        rescueCount: 0,
        // 在公开名单里（快照发布写入）
        listed: 1,
        firstReportAt: 0,
        updatedAt: 0,
      })
      .onConflictDoUpdate({
        target: accounts.handle,
        set: { reportCount: 5, rescueCount: 0, listed: 1 },
      });
    await report([1, 2, 3], [observation('500', 90_000, { handle: 'spammer' })]);
    expect((await computeHotBoards(env, NOW)).rising).toHaveLength(0);
  });
});

describe('stored boards', () => {
  it('reuses the stored board for 5 minutes and tracks ranks and listing time', async () => {
    await report([1], [observation('600', 90_000), observation('601', 50_000, { handle: 'bob' })]);
    const first = await getHotBoards(env, NOW);
    // 第一版没有参照：都算新上榜
    expect(first.posts.map((post) => [post.postId, post.rank, post.rankDelta])).toEqual([
      ['600', 1, null],
      ['601', 2, null],
    ]);
    expect(first.posts[0]!.listedAt).toBe(NOW);

    // 5 分钟内：同一版
    await report([2], [observation('602', 500_000, { handle: 'carol' })]);
    expect((await getHotBoards(env, NOW + 2 * MINUTE)).generated_at).toBe(NOW);

    // 过期后重算：新帖第一，老帖名次各降一位，上榜时刻沿用
    const later = await getHotBoards(env, NOW + 6 * MINUTE);
    expect(later.generated_at).toBe(NOW + 6 * MINUTE);
    expect(later.posts.map((post) => [post.postId, post.rank, post.rankDelta])).toEqual([
      ['602', 1, null],
      ['600', 2, -1],
      ['601', 3, -1],
    ]);
    expect(later.posts.find((post) => post.postId === '600')?.listedAt).toBe(NOW);
    expect(later.posts.find((post) => post.postId === '602')?.listedAt).toBe(NOW + 6 * MINUTE);
  });

  it('serves the boards with an ETag and answers 304 when nothing changed', async () => {
    const response = await worker.fetch(new Request('https://api.example.com/v1/hot'), env);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=60, s-maxage=60');
    const etag = response.headers.get('etag');
    expect(etag).toMatch(/^"hot-\d+"$/);
    expect(await response.json()).toMatchObject({ window_hours: 2, posts: [], day: [] });
    const again = await worker.fetch(
      new Request('https://api.example.com/v1/hot', { headers: { 'if-none-match': etag! } }),
      env,
    );
    expect(again.status).toBe(304);
  });
});

describe('cleanup', () => {
  it('cleans up old observations and posts', async () => {
    await report([1], [observation('700', 1_000)]);
    await cleanupHotData(env, NOW + 3 * 24 * HOUR);
    const [posts] = await getDb(env).select({ n: count() }).from(hotPosts);
    const [points] = await getDb(env).select({ n: count() }).from(hotObservations);
    expect(posts?.n).toBe(0);
    expect(points?.n).toBe(0);
  });
});
