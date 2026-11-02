import { describe, expect, it } from 'vitest';
import {
  analyzeProfile,
  highLikesThreshold,
  outlierMultiple,
  profileBaseline,
  snowflakeTime,
  type ProfilePost,
} from './profile';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 9, 30, 12);

/** 12 条成熟的普通帖子：浏览 1000…2100，中位数 1550。 */
function ordinary(count = 12): ProfilePost[] {
  return Array.from({ length: count }, (_, i) => ({
    postId: String(100 + i),
    createdAt: NOW - (i + 2) * DAY,
    views: 1_000 + i * 100,
    likes: 20 + i,
    replies: 2,
    retweets: 1,
    kind: 'original' as const,
    media: 'none' as const,
  }));
}

describe('profileBaseline', () => {
  it('uses the median of mature originals and quotes only', () => {
    const posts: ProfilePost[] = [
      ...ordinary(),
      // 回复、刚发的帖子不算进基线
      { postId: '1', createdAt: NOW - 3 * DAY, views: 5, kind: 'reply' },
      { postId: '2', createdAt: NOW - HOUR, views: 900_000, kind: 'original' },
    ];
    expect(profileBaseline(posts, NOW)).toEqual({
      medianViews: 1_550,
      medianLikes: 25.5,
      sample: 12,
    });
  });

  it('needs at least 10 mature posts', () => {
    expect(profileBaseline(ordinary(9), NOW)).toBeNull();
    expect(profileBaseline(ordinary(10), NOW)).not.toBeNull();
  });
});

describe('outlierMultiple', () => {
  const baseline = { medianViews: 1_000, medianLikes: 10, sample: 20 };

  it('divides mature posts by the median and projects young ones', () => {
    expect(outlierMultiple({ views: 4_000, createdAt: NOW - 2 * DAY }, baseline, NOW)).toEqual({
      value: 4,
      estimated: false,
    });
    const young = outlierMultiple({ views: 1_000, createdAt: NOW - 2 * HOUR }, baseline, NOW)!;
    expect(young.estimated).toBe(true);
    // 发出 2 小时就有中位数的浏览：预计 24 小时会远超中位数
    expect(young.value).toBeGreaterThan(2);
    expect(outlierMultiple({ views: 4_000, createdAt: NOW - 2 * DAY }, null, NOW)).toBeNull();
  });
});

describe('analyzeProfile', () => {
  it('flags outliers and compares formats', () => {
    const posts: ProfilePost[] = [
      ...ordinary(),
      // 有机爆款：浏览 6 倍，互动正常
      {
        postId: '900',
        createdAt: NOW - 3 * DAY,
        views: 9_300,
        likes: 400,
        replies: 30,
        kind: 'original',
        media: 'photo',
      },
    ];
    // 帖子分散在周二到周五晚上（20–24 点那一段）
    const analysis = analyzeProfile(posts, NOW, {
      localParts: (ts) => ({ day: 2 + (Math.floor(ts / DAY) % 4), hour: 21 }),
    });
    expect(analysis.baseline?.sample).toBe(13);
    expect(analysis.scores.get('900')).toMatchObject({ estimated: false });
    expect(analysis.scores.get('900')!.multiple).toBeGreaterThan(5);
    // 13 条成熟帖子里 1 条爆款
    expect(analysis.outlierRate).toBeCloseTo(1 / 13);
    // 纯文字 12 条够了；图片只有 1 条不显示
    expect(analysis.formats.map((item) => item.format)).toEqual(['text']);
    // 4 小时一格：21 点落在第 6 段（20–24 点）
    const evenings = analysis.heatmap!.counts.map((row) => row[5]);
    expect(evenings.reduce((a, b) => a! + b!, 0)).toBe(13);
    expect(analysis.heatmap!.cells[0]![0]).toBeNull();
    // 全挤在一个格子里：着色的格子太少，不出图
    const single = analyzeProfile(posts, NOW, { localParts: () => ({ day: 2, hour: 21 }) });
    expect(single.heatmap).toBeNull();
  });

  it('returns scores without multiples when the sample is too small', () => {
    const analysis = analyzeProfile(ordinary(3), NOW);
    expect(analysis.baseline).toBeNull();
    expect(analysis.scores.get('100')).toEqual({
      multiple: null,
      estimated: false,
    });
    expect(analysis.formats).toEqual([]);
    expect(analysis.heatmap).toBeNull();
  });
});

describe('helpers', () => {
  it('picks a round min_faves around 5× the median likes', () => {
    expect(highLikesThreshold(null)).toBe(10);
    expect(highLikesThreshold({ medianViews: 1, medianLikes: 1, sample: 10 })).toBe(10);
    expect(highLikesThreshold({ medianViews: 1, medianLikes: 47, sample: 10 })).toBe(200);
    expect(highLikesThreshold({ medianViews: 1, medianLikes: 3_100, sample: 10 })).toBe(20_000);
  });

  it('reads the post time out of a snowflake id', () => {
    // 帖子 ID = (毫秒时间 − X 纪元 1288834974657) << 22，低 22 位是机器号和序号
    const at = Date.UTC(2026, 9, 30, 8, 51, 18, 765);
    const id = ((BigInt(at - 1288834974657) << 22n) | 0x2a5n).toString();
    expect(snowflakeTime(id)).toBe(at);
    expect(snowflakeTime('not-an-id')).toBeNull();
  });
});
