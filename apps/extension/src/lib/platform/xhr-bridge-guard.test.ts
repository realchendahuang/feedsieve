import { describe, expect, it } from 'vitest';
import { normalizeStrictHandle, sanitizeBridgePayload, sanitizeXUserId } from './xhr-bridge-guard';

/** 构造一个最小合法 payload，单个测试只覆盖需要伪造的字段。 */
function validPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    matchedEndpoints: ['HomeTimeline'],
    tweets: [
      {
        author: { handle: 'alice', xUserId: '101', bio: 'hi' },
        text: 't',
      },
    ],
    listMembers: [],
    following: [],
    ...overrides,
  };
}

describe('normalizeStrictHandle', () => {
  it('接受合法 handle（去 @ / 小写化 / 1-15 位）', () => {
    expect(normalizeStrictHandle('@Alice_01')).toBe('alice_01');
    expect(normalizeStrictHandle('bob')).toBe('bob');
    expect(normalizeStrictHandle('  carl ')).toBe('carl');
    expect(normalizeStrictHandle('a'.repeat(15))).toBe('a'.repeat(15));
  });

  it('拒绝非法形态（16+ 位 / 非法字符 / 非字符串）', () => {
    expect(normalizeStrictHandle('a'.repeat(16))).toBeNull();
    expect(normalizeStrictHandle('bad name')).toBeNull();
    expect(normalizeStrictHandle('中文')).toBeNull();
    expect(normalizeStrictHandle(123)).toBeNull();
    expect(normalizeStrictHandle('')).toBeNull();
    expect(normalizeStrictHandle(undefined)).toBeNull();
  });
});

describe('sanitizeXUserId', () => {
  it('只接受 1-20 位纯数字字符串', () => {
    expect(sanitizeXUserId('12345')).toBe('12345');
    expect(sanitizeXUserId('1')).toBe('1');
    expect(sanitizeXUserId('1'.repeat(20))).toBe('1'.repeat(20));
    expect(sanitizeXUserId('1'.repeat(21))).toBeUndefined();
    expect(sanitizeXUserId('abc')).toBeUndefined();
    expect(sanitizeXUserId(' 123 ')).toBeUndefined();
    expect(sanitizeXUserId(123)).toBeUndefined();
    expect(sanitizeXUserId(null)).toBeUndefined();
  });
});

describe('sanitizeBridgePayload', () => {
  it('合法 payload：字段逐项收敛，id/followed/bio/self 全部通过严格校验', () => {
    const out = sanitizeBridgePayload(
      validPayload({
        selfHandle: '@Me',
        following: [{ handle: 'friend', xUserId: '55' }],
      }),
    );
    expect(out).not.toBeNull();
    expect(out?.idEntries).toEqual([
      { handle: 'alice', xUserId: '101' },
      { handle: 'friend', xUserId: '55' },
    ]);
    expect(out?.followedEntries).toEqual([{ handle: 'friend', xUserId: '55' }]);
    expect(out?.bios).toEqual([{ handle: 'alice', bio: 'hi' }]);
    expect(out?.selfHandle).toBe('me');
    expect(out?.isFollowingPage).toBe(false);
  });

  it('整体形态非法（非对象 / matchedEndpoints 缺失）返回 null', () => {
    expect(sanitizeBridgePayload(null)).toBeNull();
    expect(sanitizeBridgePayload('junk')).toBeNull();
    expect(sanitizeBridgePayload({})).toBeNull();
    expect(sanitizeBridgePayload({ matchedEndpoints: 'HomeTimeline' })).toBeNull();
  });

  it('伪造 handle：非法形态整条丢弃，合法条目不受影响', () => {
    const out = sanitizeBridgePayload(
      validPayload({
        tweets: [
          { author: { handle: 'good_user', xUserId: '1' } },
          { author: { handle: 'a'.repeat(16), xUserId: '2' } },
          { author: { handle: 'evil name!', xUserId: '3' } },
          { author: { handle: 42, xUserId: '4' } },
        ],
      }),
    );
    expect(out?.idEntries).toEqual([{ handle: 'good_user', xUserId: '1' }]);
  });

  it('伪造 xUserId：非数字 / 超长 / 注入串一律丢弃，绝不入库', () => {
    const out = sanitizeBridgePayload(
      validPayload({
        tweets: [
          { author: { handle: 'alice', xUserId: "'; DROP TABLE users;--" } },
          { author: { handle: 'alice', xUserId: 123 } },
          { author: { handle: 'alice', xUserId: '1'.repeat(21) } },
        ],
      }),
    );
    expect(out?.idEntries).toEqual([]);
  });

  it('listMembers：id 必需，缺失/非法成员整条丢弃', () => {
    const out = sanitizeBridgePayload(
      validPayload({
        tweets: [],
        listMembers: [
          { handle: 'member1', xUserId: '11' },
          { handle: 'member2' },
          { handle: 'member3', xUserId: 'not-a-number' },
        ],
      }),
    );
    expect(out?.idEntries).toEqual([{ handle: 'member1', xUserId: '11' }]);
  });

  it('following 页：cursor/sourceUrl 只收非空字符串，非法静默置空', () => {
    const out = sanitizeBridgePayload(
      validPayload({
        matchedEndpoints: ['Following'],
        followingCursor: { evil: true },
        sourceUrl: 42,
        following: [{ handle: 'a', xUserId: '9' }],
      }),
    );
    expect(out?.isFollowingPage).toBe(true);
    expect(out?.followingCursor).toBeUndefined();
    expect(out?.sourceUrl).toBeUndefined();
    expect(out?.following).toEqual([{ handle: 'a', xUserId: '9' }]);
  });

  it('Following 页 sourceUrl/cursor 合法时保留（分页同步依赖）', () => {
    const out = sanitizeBridgePayload(
      validPayload({
        matchedEndpoints: ['Following'],
        followingCursor: 'cursor-1',
        sourceUrl: 'https://x.com/i/api/graphql/abc/Following?variables=x',
        following: [{ handle: 'a' }],
      }),
    );
    expect(out?.followingCursor).toBe('cursor-1');
    expect(out?.sourceUrl).toBe('https://x.com/i/api/graphql/abc/Following?variables=x');
  });

  it('bio 非字符串丢弃；following !== true 不进保护名单', () => {
    const out = sanitizeBridgePayload(
      validPayload({
        tweets: [
          { author: { handle: 'a', bio: 42, following: 'yes' } },
          { author: { handle: 'b', following: false } },
        ],
      }),
    );
    expect(out?.bios).toEqual([]);
    expect(out?.followedEntries).toEqual([]);
  });
});

// ---------- 时间线解析节流 ----------

import {
  createParseThrottle,
  TIMELINE_PARSE_THROTTLE_MS,
  timelineParseThrottleKey,
} from './xhr-bridge-guard';

describe('主页洞察需要的字段', () => {
  it('保留帖子类型、置顶和媒体类型；非法值丢掉', () => {
    const tweet = (postId: string, extra: Record<string, unknown>) => ({
      postId,
      author: { handle: 'alice' },
      text: 't',
      metrics: { views: 10 },
      isReply: false,
      isQuote: false,
      ...extra,
    });
    const out = sanitizeBridgePayload(
      validPayload({
        matchedEndpoints: ['UserTimeline'],
        tweets: [
          tweet('1', { media: 'photo' }),
          tweet('2', { isReply: true, isPinned: true, media: 'video' }),
          tweet('3', { isQuote: true, media: 'hologram' }),
          { postId: '4', author: { handle: 'alice' }, text: 't' },
        ],
      }),
    );
    expect(
      out?.tweetStats.map(({ postId, kind, pinned, media }) => ({ postId, kind, pinned, media })),
    ).toEqual([
      { postId: '1', kind: 'original', pinned: undefined, media: 'photo' },
      { postId: '2', kind: 'reply', pinned: true, media: 'video' },
      { postId: '3', kind: 'quote', pinned: undefined, media: undefined },
      // 没有类型标记的旧响应：不猜
      { postId: '4', kind: undefined, pinned: undefined, media: undefined },
    ]);
  });

  it('资料端点保留名字、头像和蓝标；头像只认 X 图床', () => {
    const out = sanitizeBridgePayload(
      validPayload({
        matchedEndpoints: ['UserByScreenName'],
        tweets: [],
        users: [
          {
            handle: 'Alice',
            displayName: '  Alice  ',
            avatarUrl: 'https://pbs.twimg.com/profile_images/1/a_normal.jpg',
            stats: { followers: 12_000, isBlueVerified: true },
          },
          {
            handle: 'bob',
            avatarUrl: 'https://evil.example/a.jpg',
            stats: { followers: 5 },
          },
        ],
      }),
    );
    expect(out?.authorStats).toEqual([
      {
        handle: 'alice',
        followers: 12_000,
        displayName: 'Alice',
        avatarUrl: 'https://pbs.twimg.com/profile_images/1/a_normal.jpg',
        verified: true,
      },
      { handle: 'bob', followers: 5 },
    ]);
  });
});

describe('timelineParseThrottleKey', () => {
  it('只命中两个首页时间线端点；其它端点（含 Following / TweetDetail）不节流', () => {
    expect(timelineParseThrottleKey('https://x.com/i/api/graphql/x/HomeTimeline?variables=1')).toBe(
      'HomeTimeline',
    );
    expect(
      timelineParseThrottleKey('https://x.com/i/api/graphql/x/HomeLatestTimeline?variables=1'),
    ).toBe('HomeLatestTimeline');
    expect(
      timelineParseThrottleKey('https://x.com/i/api/graphql/x/Following?variables=1'),
    ).toBeNull();
    expect(
      timelineParseThrottleKey('https://x.com/i/api/graphql/x/TweetDetail?variables=1'),
    ).toBeNull();
    expect(
      timelineParseThrottleKey('https://x.com/i/api/graphql/x/UserByScreenName?variables=1'),
    ).toBeNull();
  });
});

describe('createParseThrottle', () => {
  it('同端点窗口内拒绝、窗口外放行；首次恒放行', () => {
    let clock = 0;
    const throttle = createParseThrottle({ now: () => clock });
    const homeUrl = 'https://x.com/i/api/graphql/x/HomeTimeline?variables=a';
    expect(throttle.allow(homeUrl)).toBe(true); // 首次
    throttle.mark(homeUrl);
    clock = TIMELINE_PARSE_THROTTLE_MS - 1;
    expect(throttle.allow(homeUrl)).toBe(false); // 窗口内
    clock = TIMELINE_PARSE_THROTTLE_MS;
    expect(throttle.allow(homeUrl)).toBe(true); // 窗口外
  });

  it('两个端点各自独立计数', () => {
    let clock = 0;
    const throttle = createParseThrottle({ now: () => clock });
    throttle.mark('https://x.com/i/api/graphql/x/HomeTimeline?variables=a');
    clock = TIMELINE_PARSE_THROTTLE_MS - 1;
    // HomeLatestTimeline 从未 mark：独立计数，仍放行
    expect(throttle.allow('https://x.com/i/api/graphql/x/HomeLatestTimeline?variables=a')).toBe(
      true,
    );
    throttle.mark('https://x.com/i/api/graphql/x/HomeLatestTimeline?variables=a');
    expect(throttle.allow('https://x.com/i/api/graphql/x/HomeLatestTimeline?b')).toBe(false);
    expect(throttle.allow('https://x.com/i/api/graphql/x/HomeTimeline?b')).toBe(false);
    clock = TIMELINE_PARSE_THROTTLE_MS * 2; // 两个端点的 mark 时刻（0 与 999）都已过期
    expect(throttle.allow('https://x.com/i/api/graphql/x/HomeLatestTimeline?b')).toBe(true);
    expect(throttle.allow('https://x.com/i/api/graphql/x/HomeTimeline?b')).toBe(true);
  });

  it('非时间线端点恒放行且 mark 不写入', () => {
    const throttle = createParseThrottle({ now: () => 0 });
    const url = 'https://x.com/i/api/graphql/x/Following?variables=a';
    expect(throttle.allow(url)).toBe(true);
    throttle.mark(url);
    expect(throttle.allow(url)).toBe(true);
  });

  it('只有真正解析过才 mark：未 mark 时窗口不推进', () => {
    let clock = 0;
    const throttle = createParseThrottle({ now: () => clock });
    const url = 'https://x.com/i/api/graphql/x/HomeTimeline?variables=a';
    expect(throttle.allow(url)).toBe(true);
    // 没调 mark（比如解析抛错）：时钟推进后仍放行
    clock = TIMELINE_PARSE_THROTTLE_MS - 1;
    expect(throttle.allow(url)).toBe(true);
  });
});

describe('sanitizeBridgePayload：推文指标与作者统计', () => {
  const createdAt = Date.UTC(2026, 9, 29, 12);

  it('保留合法的推文指标与作者统计', () => {
    const result = sanitizeBridgePayload(
      validPayload({
        tweets: [
          {
            postId: '1850000000000000001',
            text: '  正文  ',
            createdAt,
            metrics: { views: 1200, likes: 30, retweets: 2 },
            author: {
              handle: 'Alice',
              displayName: 'Alice A',
              stats: { followers: 3200, followingCount: 210, createdAt },
            },
          },
        ],
        users: [{ handle: 'bob', stats: { followers: 99, tweets: 5 } }],
      }),
    );
    expect(result?.tweetStats).toEqual([
      {
        postId: '1850000000000000001',
        handle: 'alice',
        displayName: 'Alice A',
        snippet: '正文',
        createdAt,
        views: 1200,
        likes: 30,
        retweets: 2,
      },
    ]);
    expect(result?.authorStats).toEqual([
      { handle: 'alice', followers: 3200, followingCount: 210, createdAt },
      { handle: 'bob', followers: 99, tweets: 5 },
    ]);
  });

  it('丢弃伪造或越界的字段，不丢整条', () => {
    const result = sanitizeBridgePayload(
      validPayload({
        tweets: [
          {
            postId: '1850000000000000002',
            text: 'x'.repeat(3000),
            createdAt: 123, // 早于 2006
            metrics: { views: -1, likes: 1.5, retweets: 1e20, replies: '3', quotes: 4 },
            author: { handle: 'carol', displayName: { evil: true }, stats: { followers: 'many' } },
          },
        ],
      }),
    );
    expect(result?.tweetStats).toEqual([
      { postId: '1850000000000000002', handle: 'carol', snippet: 'x'.repeat(1000), quotes: 4 },
    ]);
    // 统计字段全部非法：不生成空的作者条目
    expect(result?.authorStats).toEqual([]);
  });

  it('头像和媒体只接受 X 图床地址', () => {
    const result = sanitizeBridgePayload(
      validPayload({
        tweets: [
          {
            postId: '1850000000000000003',
            mediaUrl: 'https://pbs.twimg.com/media/A.jpg',
            author: {
              handle: 'erin',
              avatarUrl: 'https://pbs.twimg.com/profile_images/1/a_normal.jpg',
              stats: { isBlueVerified: true },
            },
          },
          {
            postId: '1850000000000000004',
            mediaUrl: 'https://evil.example/x.jpg',
            author: { handle: 'frank', avatarUrl: 'javascript:alert(1)' },
          },
        ],
      }),
    );
    expect(result?.tweetStats).toEqual([
      {
        postId: '1850000000000000003',
        handle: 'erin',
        avatarUrl: 'https://pbs.twimg.com/profile_images/1/a_normal.jpg',
        verified: true,
        mediaUrl: 'https://pbs.twimg.com/media/A.jpg',
      },
      { postId: '1850000000000000004', handle: 'frank' },
    ]);
  });

  it('postId 或 handle 非法时整条推文指标丢弃', () => {
    const result = sanitizeBridgePayload(
      validPayload({
        tweets: [
          { postId: 'abc', metrics: { views: 1 }, author: { handle: 'dave' } },
          { postId: '1', metrics: { views: 1 }, author: { handle: 'bad name' } },
        ],
        users: [{ handle: '<script>', stats: { followers: 1 } }],
      }),
    );
    expect(result?.tweetStats).toEqual([]);
    expect(result?.authorStats).toEqual([]);
  });
});
