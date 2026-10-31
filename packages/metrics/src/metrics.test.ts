import { describe, expect, it } from 'vitest';
import {
  HOUR_MS,
  DAY_MS,
  accountFlags,
  accountTier,
  ageHours,
  breakoutRatio,
  engagementRate,
  followRatio,
  formatCountZh,
  heatScore,
  isColdStartWindow,
  projectedViews,
  TIER_NAMES,
  replyOpportunity,
  viralScore,
  shouldShowBreakout,
  shouldShowVelocity,
  velocityLevel,
  velocityPerHour,
} from './index';

const NOW = Date.parse('2026-10-29T12:00:00Z');

// X 热门帖子同款衰减模型：λ = ln2/8h，t 下限 0.5h
const LAMBDA = Math.LN2 / 8;
function modelRate(views: number, age: number): number {
  const t = Math.max(age, 0.5);
  return (views / (1 - Math.exp(-LAMBDA * t))) * LAMBDA * Math.exp(-LAMBDA * t);
}

describe('velocityPerHour', () => {
  it('uses the decay model with a single observation', () => {
    expect(velocityPerHour({ createdAt: NOW - 2 * HOUR_MS, views: 10_000, now: NOW })).toBeCloseTo(
      modelRate(10_000, 2),
    );
  });

  it('is close to the plain average for fresh posts but much lower for old ones', () => {
    const fresh = velocityPerHour({ createdAt: NOW - HOUR_MS, views: 1_000, now: NOW })!;
    expect(fresh / 1_000).toBeGreaterThan(0.9);
    const old = velocityPerHour({ createdAt: NOW - 30 * HOUR_MS, views: 30_000, now: NOW })!;
    expect(old).toBeLessThan(1_000 / 3); // 全程平均是 1000/h，此刻已经衰减到三分之一以下
  });

  it('floors the age so a brand-new post does not explode', () => {
    expect(velocityPerHour({ createdAt: NOW - 60_000, views: 600, now: NOW })).toBeCloseTo(
      modelRate(600, 0.5),
    );
  });

  it('uses the delta between observations when they are far enough apart', () => {
    const v = velocityPerHour({
      createdAt: NOW - 10 * HOUR_MS,
      views: 30_000,
      now: NOW,
      previous: { views: 20_000, at: NOW - 30 * 60_000 },
    });
    expect(v).toBe(20_000);
  });

  it('falls back to the model when observations are too close or views went backwards', () => {
    const base = { createdAt: NOW - 10 * HOUR_MS, views: 30_000, now: NOW };
    const expected = modelRate(30_000, 10);
    expect(
      velocityPerHour({ ...base, previous: { views: 29_000, at: NOW - 5 * 60_000 } }),
    ).toBeCloseTo(expected);
    expect(
      velocityPerHour({ ...base, previous: { views: 40_000, at: NOW - HOUR_MS } }),
    ).toBeCloseTo(expected);
  });

  it('returns null after 48 hours (X stops recommending), and for bad input', () => {
    expect(velocityPerHour({ createdAt: NOW - 49 * HOUR_MS, views: 1, now: NOW })).toBeNull();
    expect(velocityPerHour({ views: 1, now: NOW })).toBeNull();
    expect(velocityPerHour({ createdAt: NOW - HOUR_MS, now: NOW })).toBeNull();
    expect(velocityPerHour({ createdAt: NOW + HOUR_MS, views: 1, now: NOW })).toBeNull();
  });

  it('accepts config overrides', () => {
    expect(
      velocityPerHour(
        { createdAt: NOW - 73 * HOUR_MS, views: 73, now: NOW },
        { velocityMaxAgeHours: 100 },
      ),
    ).not.toBeNull();
  });
});

describe('projectedViews', () => {
  it('matches X popular-posts quality: views × (1 − e^(−24λ)) / (1 − e^(−λt))', () => {
    const expected = (10_000 * (1 - Math.exp(-LAMBDA * 24))) / (1 - Math.exp(-LAMBDA * 2));
    expect(projectedViews(10_000, 2)).toBeCloseTo(expected);
  });

  it('never projects below actual views and returns actual views after 24h', () => {
    expect(projectedViews(5_000, 23.9)).toBeGreaterThanOrEqual(5_000);
    expect(projectedViews(5_000, 30)).toBe(5_000);
    expect(projectedViews(undefined, 1)).toBeNull();
    expect(projectedViews(1, null)).toBeNull();
  });
});

describe('isColdStartWindow', () => {
  it('flags fresh low-impression posts from authors up to 50K followers', () => {
    expect(isColdStartWindow({ followers: 3_000, ageHours: 0.5, views: 120 })).toBe(true);
    expect(isColdStartWindow({ followers: 60_000, ageHours: 0.5, views: 120 })).toBe(false);
    expect(isColdStartWindow({ followers: 3_000, ageHours: 3, views: 120 })).toBe(false);
    expect(isColdStartWindow({ followers: 3_000, ageHours: 0.5, views: 500 })).toBe(false);
  });
});

describe('velocityLevel', () => {
  it('shows velocity only from the display threshold up', () => {
    expect(shouldShowVelocity(null)).toBe(false);
    expect(shouldShowVelocity(9)).toBe(false);
    expect(shouldShowVelocity(10)).toBe(true);
  });

  it('maps to none / hot / rocket at the configured thresholds', () => {
    expect(velocityLevel(null)).toBe('none');
    expect(velocityLevel(999)).toBe('none');
    expect(velocityLevel(1_000)).toBe('hot');
    expect(velocityLevel(10_000)).toBe('rocket');
  });
});

describe('breakoutRatio', () => {
  it('divides views by followers with a floor on followers', () => {
    expect(breakoutRatio(80_000, 10_000)).toBe(8);
    expect(breakoutRatio(500, 3)).toBe(5);
    expect(breakoutRatio(undefined, 10)).toBeNull();
    expect(breakoutRatio(10, undefined)).toBeNull();
  });

  it('is shown only at or above the threshold', () => {
    expect(shouldShowBreakout(2.99)).toBe(false);
    expect(shouldShowBreakout(3)).toBe(true);
    expect(shouldShowBreakout(null)).toBe(false);
  });
});

describe('engagementRate', () => {
  it('uses X ranking weights: replies and quotes are worth far more than likes', () => {
    expect(
      engagementRate({ views: 1_000, likes: 10, retweets: 2, quotes: 1, replies: 3 }),
    ).toBeCloseTo((0.66 * 10 + 1 * 2 + 5 * 1 + 5 * 3) / 1_000);
  });

  it('treats missing interactions as zero but needs views', () => {
    expect(engagementRate({ views: 100, replies: 1 })).toBe(0.05);
    expect(engagementRate({ likes: 5 })).toBeNull();
    expect(engagementRate({ views: 0, likes: 5 })).toBeNull();
  });
});

describe('heatScore', () => {
  it('rewards velocity and breakout, and decays with age', () => {
    const fresh = heatScore({ velocityPerHour: 10_000, breakout: 0, ageHours: 0 });
    const breakout = heatScore({ velocityPerHour: 10_000, breakout: 99, ageHours: 0 });
    const older = heatScore({ velocityPerHour: 10_000, breakout: 0, ageHours: 12 });
    expect(fresh).toBeCloseTo(Math.log10(10_001));
    expect(breakout).toBeCloseTo(Math.log10(10_001) * 2); // log10(100)=2，权重 0.5 → ×2
    expect(older).toBeCloseTo(Math.log10(10_001) / Math.pow(2, 1.5));
  });

  it('caps the breakout bonus and returns null without velocity or age', () => {
    const capped = heatScore({ velocityPerHour: 100, breakout: 1e9, ageHours: 0 });
    expect(capped).toBeCloseTo(Math.log10(101) * 2);
    expect(heatScore({ velocityPerHour: null, breakout: 1, ageHours: 1 })).toBeNull();
    expect(heatScore({ velocityPerHour: 1, breakout: 1, ageHours: null })).toBeNull();
  });
});

describe('ageHours', () => {
  it('returns hours since posting', () => {
    expect(ageHours(NOW - 90 * 60_000, NOW)).toBe(1.5);
    expect(ageHours(undefined, NOW)).toBeNull();
  });
});

describe('accountTier', () => {
  it.each([
    [0, 1],
    [999, 1],
    [1_000, 2],
    [9_999, 2],
    [10_000, 3],
    [49_999, 3],
    [50_000, 4],
    [199_999, 4],
    [200_000, 5],
    [999_999, 5],
    [1_000_000, 6],
  ])('%i followers → L%i', (followers, tier) => {
    expect(accountTier(followers)).toBe(tier);
  });

  it('returns null without a follower count', () => {
    expect(accountTier(undefined)).toBeNull();
    expect(accountTier(-1)).toBeNull();
  });
});

describe('TIER_NAMES', () => {
  it('names every tier in both languages', () => {
    expect(TIER_NAMES[3].zh).toBe('腰部');
    expect(TIER_NAMES[6].en).toBe('Mega');
    expect(Object.keys(TIER_NAMES)).toHaveLength(6);
  });
});

describe('followRatio and accountFlags', () => {
  it('computes following / followers', () => {
    expect(followRatio(210, 2_893)).toBeCloseTo(0.0726, 3);
    expect(followRatio(5, 0)).toBe(5);
    expect(followRatio(undefined, 1)).toBeNull();
  });

  it('flags mutual-follow farms', () => {
    expect(
      accountFlags({ followers: 3_000, followingCount: 3_100, now: NOW }).mutualFollowFarm,
    ).toBe(true);
    expect(
      accountFlags({ followers: 1_500, followingCount: 1_500, now: NOW }).mutualFollowFarm,
    ).toBe(false);
    expect(
      accountFlags({ followers: 30_000, followingCount: 3_000, now: NOW }).mutualFollowFarm,
    ).toBe(false);
  });

  it('flags new accounts', () => {
    expect(accountFlags({ createdAt: NOW - 89 * DAY_MS, now: NOW }).newAccount).toBe(true);
    expect(accountFlags({ createdAt: NOW - 91 * DAY_MS, now: NOW }).newAccount).toBe(false);
    expect(accountFlags({ now: NOW }).newAccount).toBe(false);
  });

  it('flags small accounts that follow far more than follow them', () => {
    expect(
      accountFlags({ followers: 100, followingCount: 1_500, now: NOW }).abnormalFollowRatio,
    ).toBe(true);
    expect(
      accountFlags({ followers: 600, followingCount: 7_000, now: NOW }).abnormalFollowRatio,
    ).toBe(false);
  });
});

describe('formatCountZh', () => {
  it.each([
    [0, '0'],
    [999, '999'],
    [9_999, '9999'],
    [10_000, '1万'],
    [12_345, '1.2万'],
    [32_000, '3.2万'],
    [999_999, '99.9万'],
    [1_200_000, '120万'],
    [99_996_000, '1亿'],
    [150_000_000, '1.5亿'],
  ])('%i → %s', (value, text) => {
    expect(formatCountZh(value)).toBe(text);
  });

  it('returns an empty string for invalid input', () => {
    expect(formatCountZh(Number.NaN)).toBe('');
    expect(formatCountZh(-1)).toBe('');
  });
});

describe('viralScore', () => {
  it('combines projected 24h views, weighted engagement and breakout', () => {
    // 24h 后实际 10 万浏览（log 刻度 2/3 → 30 分）+ 加权互动率 2.5%（半分 17.5）+ 破圈 ×5（半分 10）
    expect(
      viralScore({
        ageHours: 30,
        views: 100_000,
        likes: 1_000,
        replies: 300,
        retweets: 340,
        quotes: 0,
        followers: 20_000,
      }),
    ).toBe(58);
  });

  it('caps at 100, needs views, and ignores breakout without followers', () => {
    expect(viralScore({ ageHours: 30, views: 2e6, replies: 2e6, followers: 1 })).toBe(100);
    expect(viralScore({ ageHours: 1, likes: 1 })).toBeNull();
    expect(viralScore({ ageHours: 30, views: 1_000 })).toBe(0);
  });

  it('rewards a post that is early but fast via the 24h projection', () => {
    const early = viralScore({ ageHours: 0.5, views: 5_000 })!;
    const late = viralScore({ ageHours: 30, views: 5_000 })!;
    expect(early).toBeGreaterThan(late);
  });
});

describe('replyOpportunity', () => {
  it('integrates the decaying view rate over the remaining window', () => {
    const result = replyOpportunity({ velocityPerHour: 10_000, ageHours: 4, replies: 30 })!;
    const expected = (10_000 / LAMBDA) * (1 - Math.exp(-LAMBDA * 20));
    expect(result.hoursLeft).toBe(20);
    expect(result.remainingViews).toBeCloseTo(expected);
    expect(result.competition).toBe(30);
    expect(result.score).toBeCloseTo(expected / 50);
  });

  it('prefers fewer replies at the same velocity', () => {
    const crowded = replyOpportunity({ velocityPerHour: 5_000, ageHours: 2, replies: 500 })!;
    const quiet = replyOpportunity({ velocityPerHour: 5_000, ageHours: 2, replies: 5 })!;
    expect(quiet.score).toBeGreaterThan(crowded.score);
  });

  it('returns null after the window or without velocity', () => {
    expect(replyOpportunity({ velocityPerHour: 1_000, ageHours: 25, replies: 0 })).toBeNull();
    expect(replyOpportunity({ velocityPerHour: null, ageHours: 1 })).toBeNull();
  });
});
