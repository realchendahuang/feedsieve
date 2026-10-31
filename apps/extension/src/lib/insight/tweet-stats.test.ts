import { describe, expect, it } from 'vitest';
import { createTweetStatsStore, hotThreshold, HOT_EXIT_RATIO, HOT_WINDOW_MS } from './tweet-stats';

const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 29, 12);

describe('createTweetStatsStore', () => {
  it('keeps sensitive posts and porn bait out of the hot list', () => {
    const store = createTweetStatsStore();
    const createdAt = NOW - 2 * HOUR;
    store.recordTweet({ postId: '1', handle: 'a', createdAt, views: 50_000 }, NOW);
    store.recordTweet({ postId: '2', handle: 'b', createdAt, views: 50_000, sensitive: true }, NOW);
    store.recordTweet(
      { postId: '3', handle: 'c', createdAt, views: 50_000, snippet: '福利在主页，私我' },
      NOW,
    );
    expect(store.hotList(NOW).map((item) => item.postId)).toEqual(['1']);
    expect(store.brief(NOW).hot).toBe(1);
  });

  it('computes velocity from the decay model with a single observation', () => {
    const store = createTweetStatsStore();
    store.recordTweet({ postId: '1', handle: 'a', createdAt: NOW - 2 * HOUR, views: 10_000 }, NOW);
    const insight = store.insight('1', NOW)!;
    // 全程平均 5000/h；模型推算此刻约 4580/h，并给出预计 24h 浏览
    expect(insight.velocity).toBeGreaterThan(4_500);
    expect(insight.velocity).toBeLessThan(4_700);
    expect(insight.projected).toBeGreaterThan(50_000);
  });

  it('switches to the delta between observations once they are 10 minutes apart', () => {
    const store = createTweetStatsStore();
    const createdAt = NOW - 10 * HOUR;
    store.recordTweet({ postId: '1', handle: 'a', createdAt, views: 20_000 }, NOW);
    store.recordTweet({ postId: '1', handle: 'a', createdAt, views: 30_000 }, NOW + 30 * 60_000);
    // 30 分钟涨了 1 万 → 2 万/时，而不是全程均值 ~2900/时
    expect(store.insight('1', NOW + 30 * 60_000)?.velocity).toBe(20_000);
  });

  it('rolls the anchor forward so velocity reflects the last hour', () => {
    const store = createTweetStatsStore();
    const createdAt = NOW - 10 * HOUR;
    store.recordTweet({ postId: '1', handle: 'a', createdAt, views: 0 }, NOW);
    store.recordTweet({ postId: '1', handle: 'a', createdAt, views: 50_000 }, NOW + 30 * 60_000);
    // 超过 1 小时：基准点滚到上一次观测（50_000 @ +30min）
    store.recordTweet({ postId: '1', handle: 'a', createdAt, views: 51_000 }, NOW + 2 * HOUR);
    expect(store.insight('1', NOW + 2 * HOUR)?.velocity).toBeCloseTo(1_000 / 1.5);
  });

  it('uses author followers for breakout and returns null velocity for old posts', () => {
    const store = createTweetStatsStore();
    store.recordAuthor({ handle: 'a', followers: 1_000 });
    store.recordTweet({ postId: '1', handle: 'a', createdAt: NOW - 100 * HOUR, views: 8_000 }, NOW);
    const insight = store.insight('1', NOW);
    expect(insight?.breakout).toBe(8);
    expect(insight?.velocity).toBeNull();
    expect(insight?.heat).toBeNull();
  });

  it('merges partial author updates', () => {
    const store = createTweetStatsStore();
    store.recordAuthor({ handle: 'a', followers: 10 });
    store.recordAuthor({ handle: 'a', followingCount: 5 });
    expect(store.author('A')).toEqual({ followers: 10, followingCount: 5 });
  });

  it('ranks by reply opportunity: fewer replies wins at equal velocity', () => {
    const store = createTweetStatsStore();
    const createdAt = NOW - 2 * HOUR;
    store.recordTweet(
      { postId: 'crowded', handle: 'a', createdAt, views: 20_000, replies: 900 },
      NOW,
    );
    store.recordTweet({ postId: 'quiet', handle: 'b', createdAt, views: 20_000, replies: 3 }, NOW);
    store.recordTweet({ postId: 'old', handle: 'c', createdAt: NOW - 30 * HOUR, views: 9e6 }, NOW);
    const list = store.hotList(NOW, 'opportunity');
    expect(list.map((item) => item.postId)).toEqual(['quiet', 'crowded']);
    expect(list[0]?.opportunity?.competition).toBe(3);
    expect(list[0]?.viral).not.toBeNull();
  });

  it('ranks recent posts by heat and drops posts outside the window', () => {
    const store = createTweetStatsStore();
    store.recordTweet({ postId: 'warm', handle: 'a', createdAt: NOW - HOUR, views: 5_000 }, NOW);
    store.recordTweet({ postId: 'fast', handle: 'b', createdAt: NOW - HOUR, views: 50_000 }, NOW);
    store.recordTweet(
      { postId: 'stale', handle: 'c', createdAt: NOW - 2 * HOUR, views: 900_000 },
      NOW - HOT_WINDOW_MS - 1,
    );
    expect(store.hotList(NOW).map((item) => item.postId)).toEqual(['fast', 'warm']);
  });

  it('only lets hot posts in, whatever the sort', () => {
    const store = createTweetStatsStore();
    store.recordAuthor({ handle: 'famous', followers: 5_000_000 });
    store.recordTweet(
      { postId: 'quiet', handle: 'famous', createdAt: NOW - HOUR, views: 300, bookmarks: 99 },
      NOW,
    );
    store.recordTweet({ postId: 'hot', handle: 'b', createdAt: NOW - HOUR, views: 50_000 }, NOW);
    expect(store.insight('quiet', NOW)?.velocity).toBeLessThan(1_000);
    store.recordSeen('quiet', NOW);
    store.recordSeen('hot', NOW);
    for (const sort of ['heat', 'opportunity', 'followers', 'bookmarks', 'recent'] as const) {
      expect(store.hotList(NOW, sort).map((item) => item.postId)).toEqual(['hot']);
    }
  });

  it('sorts hot posts by followers or bookmarks', () => {
    const store = createTweetStatsStore();
    store.recordAuthor({ handle: 'big', followers: 900_000 });
    store.recordAuthor({ handle: 'small', followers: 800 });
    store.recordTweet(
      { postId: 'a', handle: 'small', createdAt: NOW - 3 * HOUR, views: 400_000, bookmarks: 5 },
      NOW,
    );
    store.recordTweet(
      { postId: 'b', handle: 'big', createdAt: NOW - 2 * HOUR, views: 60_000, bookmarks: 900 },
      NOW,
    );
    store.recordTweet({ postId: 'c', handle: 'new', createdAt: NOW - HOUR, views: 20_000 }, NOW);
    const ids = (sort: 'followers' | 'bookmarks') =>
      store.hotList(NOW, sort).map((item) => item.postId);
    // 粉丝数 / 收藏数未知的排最后
    expect(ids('followers')).toEqual(['b', 'a', 'c']);
    expect(ids('bookmarks')).toEqual(['b', 'a', 'c']);
  });

  it('ranks "just seen" by when a post first appeared on screen, not by post time', () => {
    const store = createTweetStatsStore();
    const MIN = 60_000;
    // 三条一起被 X 加载（同一个响应）；发帖时间 old 最早
    for (const [postId, age] of [
      ['old', 20],
      ['mid', 3],
      ['fresh', 1],
    ] as const) {
      store.recordTweet(
        { postId, handle: postId, createdAt: NOW - age * HOUR, views: 900_000 },
        NOW - 5 * MIN,
      );
    }
    store.recordSeen('fresh', NOW - 4 * MIN);
    store.recordSeen('old', NOW - MIN);
    // mid 预加载了但还没滑到：不在列表里
    expect(store.hotList(NOW, 'recent').map((item) => item.postId)).toEqual(['old', 'fresh']);
    // 往回翻又看到 fresh：不重新排到上面
    store.recordSeen('fresh', NOW);
    expect(store.hotList(NOW, 'recent').map((item) => item.postId)).toEqual(['old', 'fresh']);
    expect(store.insight('fresh', NOW)?.seenAt).toBe(NOW - 4 * MIN);
    // 跨 service worker 重启保留
    const restored = createTweetStatsStore();
    restored.importState(JSON.parse(JSON.stringify(store.exportState())));
    expect(restored.hotList(NOW, 'recent').map((item) => item.postId)).toEqual(['old', 'fresh']);
  });
});

describe('brief', () => {
  it('summarises the recent window with unique-author tiers', () => {
    const store = createTweetStatsStore();
    store.recordAuthor({ handle: 'a', followers: 500 });
    store.recordAuthor({ handle: 'b', followers: 30_000 });
    store.recordTweet({ postId: '1', handle: 'a', createdAt: NOW - HOUR, views: 100 }, NOW);
    store.recordTweet({ postId: '2', handle: 'a', createdAt: NOW - HOUR, views: 50_000 }, NOW);
    store.recordTweet({ postId: '3', handle: 'b', createdAt: NOW - HOUR, views: 3_000 }, NOW);
    store.recordTweet(
      { postId: 'old', handle: 'b', createdAt: NOW - HOUR, views: 9 },
      NOW - HOT_WINDOW_MS - 1,
    );
    const brief = store.brief(NOW);
    expect(brief.seen).toBe(3);
    expect(brief.authors).toBe(2);
    expect(brief.hot).toBe(2); // 5万浏览、3千浏览发出 1 小时：都 ≥ 1000/h
    expect(brief.tiers).toEqual({ 1: 0, 2: 1, 3: 0, 4: 0, 5: 0, 6: 1, 7: 0, 8: 0, 9: 0, 10: 0 });
    expect(brief.topBreakout?.postId).toBe('2'); // 5万 ÷ max(500,100) = ×100
    expect(brief.medianVelocity).not.toBeNull();
  });

  it('is empty without data', () => {
    const brief = createTweetStatsStore().brief(NOW);
    expect(brief).toMatchObject({ seen: 0, hot: 0, medianVelocity: null, topBreakout: null });
  });
});

describe('hot threshold', () => {
  it('keeps the default bar unless almost nothing clears it', () => {
    const quiet = Array.from({ length: 40 }, (_, i) => (i + 1) * 20); // 20 … 800 /h
    // 样本不够：照旧 1000
    expect(hotThreshold(quiet.slice(0, 10), 1_000)).toBe(1_000);
    // 够热的有 5 条以上：照旧 1000
    expect(hotThreshold([...quiet, 1_200, 1_500, 2_000, 3_000, 9_000], 1_000)).toBe(1_000);
    // 普遍冷清：取前 10% 的那条线
    expect(hotThreshold(quiet, 1_000)).toBe(740);
    // 但不低于 300
    expect(
      hotThreshold(
        quiet.map((v) => v / 10),
        1_000,
      ),
    ).toBe(300);
  });

  it('lets a quiet feed still show its warmest posts', () => {
    const store = createTweetStatsStore();
    // 30 条发出 1 小时、浏览 20…600：推算流速都不到 1000/h
    for (let i = 1; i <= 30; i += 1) {
      store.recordTweet(
        { postId: String(i), handle: `u${i}`, createdAt: NOW - HOUR, views: i * 20 },
        NOW,
      );
    }
    const brief = store.brief(NOW);
    expect(brief.threshold).toBeLessThan(1_000);
    expect(brief.threshold).toBeGreaterThanOrEqual(300);
    const list = store.hotList(NOW);
    expect(list.length).toBeGreaterThan(0);
    expect(list.length).toBe(brief.hot);
    expect(list[0]!.postId).toBe('30');
  });

  it('keeps a listed post until it falls well below the bar', () => {
    const store = createTweetStatsStore();
    const createdAt = NOW - HOUR;
    const MIN = 60_000;
    // 两个观测点相隔 30 分钟：涨了 600 → 1200/h，进列表
    store.recordTweet({ postId: 'p', handle: 'a', createdAt, views: 10_000 }, NOW - 30 * MIN);
    store.recordTweet({ postId: 'p', handle: 'a', createdAt, views: 10_600 }, NOW);
    expect(store.hotList(NOW).map((item) => item.postId)).toEqual(['p']);
    // 回落到 900/h（还在 70% 以上）：留在列表里
    store.recordTweet({ postId: 'p', handle: 'a', createdAt, views: 10_900 }, NOW + 30 * MIN);
    expect(store.insight('p', NOW + 30 * MIN)?.velocity).toBeGreaterThan(1_000 * HOT_EXIT_RATIO);
    expect(store.insight('p', NOW + 30 * MIN)?.velocity).toBeLessThan(1_000);
    expect(store.hotList(NOW + 30 * MIN).map((item) => item.postId)).toEqual(['p']);
    // 没在列表里的帖子，同样 900/h 进不来
    const fresh = createTweetStatsStore();
    fresh.importState(JSON.parse(JSON.stringify({ ...store.exportState(), hotMembers: [] })));
    expect(fresh.hotList(NOW + 30 * MIN)).toEqual([]);
    // 成员跟着状态存：重启后照样留着
    const restored = createTweetStatsStore();
    restored.importState(JSON.parse(JSON.stringify(store.exportState())));
    expect(restored.hotList(NOW + 30 * MIN).map((item) => item.postId)).toEqual(['p']);
  });
});
