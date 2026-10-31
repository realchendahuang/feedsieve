// fixtures/x/graphql 是 2026-10-29 真实抓包后裁剪脱敏的响应（scripts/prune-x-fixture.mjs）。
// 这里锁定解析契约：X 改响应形状时，这组测试应先挂。
import { describe, expect, it } from 'vitest';
import { mayMatchEndpoint, parseXApiResponse } from './parse';
import homeTimeline from '../../../../fixtures/x/graphql/home-timeline.json';
import tweetDetail from '../../../../fixtures/x/graphql/tweet-detail.json';
import userByScreenName from '../../../../fixtures/x/graphql/user-by-screen-name.json';
import userOriginalsTimeline from '../../../../fixtures/x/graphql/user-originals-timeline.json';

const GQL = 'https://x.com/i/api/graphql/abc123';

describe('parseXApiResponse on captured responses', () => {
  it('reads tweet metrics, timestamps and the new user stats shape from HomeTimeline', () => {
    const parsed = parseXApiResponse(`${GQL}/HomeTimeline?variables=`, homeTimeline);
    expect(parsed.matchedEndpoints).toEqual(['HomeTimeline']);
    expect(parsed.tweets.length).toBeGreaterThan(3);

    for (const tweet of parsed.tweets) {
      expect(tweet.postId).toMatch(/^\d+$/);
      expect(typeof tweet.createdAt).toBe('number');
      expect(typeof tweet.metrics.likes).toBe('number');
      // 2026-09 起 user.legacy 消失，粉丝数只在 relationship_counts 里
      expect(typeof tweet.author.stats?.followers).toBe('number');
      expect(typeof tweet.author.stats?.createdAt).toBe('number');
    }
    // 至少有一条带浏览量（views.count 是字符串，必须转成数字）
    expect(parsed.tweets.some((t) => typeof t.metrics.views === 'number')).toBe(true);
  });

  it('parses UserOriginalsTimeline across instructions, including the pinned entry', () => {
    const parsed = parseXApiResponse(
      `${GQL}/UserOriginalsTimeline?variables=`,
      userOriginalsTimeline,
    );
    expect(parsed.matchedEndpoints).toEqual(['UserTimeline']);
    // 第一条 instruction 是 TimelineClearCache；只读 instructions[0] 会得到 0 条
    expect(parsed.tweets.length).toBeGreaterThan(3);
    expect(parsed.tweets.filter((t) => t.isPinned)).toHaveLength(1);
    // who-to-follow 用户模块不应被当成推文
    const handles = new Set(parsed.tweets.map((t) => t.author.handle));
    expect(handles.size).toBe(1);
  });

  it('parses UserByScreenName into a profile user with stats', () => {
    const parsed = parseXApiResponse(`${GQL}/UserByScreenName?variables=`, userByScreenName);
    expect(parsed.matchedEndpoints).toEqual(['UserByScreenName']);
    expect(parsed.users).toEqual([
      {
        handle: 'sample_user_1',
        xUserId: '1000000000000000001',
        displayName: '样本昵称 sample_user_1',
        bio: '样本简介',
        following: true,
        blocking: false,
        stats: {
          followers: 2893,
          followingCount: 210,
          tweets: 13367,
          createdAt: Date.parse('2025-01-16T13:51:46Z'),
          isProtected: false,
          isBlueVerified: true,
        },
      },
    ]);
  });

  it('parses TweetDetail entries that come after TimelineClearCache', () => {
    const parsed = parseXApiResponse(`${GQL}/TweetDetail?variables=`, tweetDetail);
    expect(parsed.tweets.length).toBeGreaterThan(1);
    expect(parsed.tweets.some((t) => t.isReply)).toBe(true);
  });

  it('routes profile endpoints through the bridge URL prefilter', () => {
    for (const op of [
      'UserOriginalsTimeline',
      'UserRepliesTimeline',
      'UserRepostsTimeline',
      'UserVideoTimeline',
      'UserArticlesTweets',
      'UserHighlightsTweets',
      'UserSuperFollowTweets',
      'UserTweets',
      'UserTweetsAndReplies',
      'UserMedia',
      'UserByScreenName',
    ]) {
      expect(mayMatchEndpoint(`${GQL}/${op}?variables=`)).toBe(true);
    }
  });

  it('parses every profile tab endpoint with the shared timeline shape', () => {
    // 各 Tab 的响应形状相同（2026-10-31 真实主页抓包确认），用帖子 Tab 的样本按各端点名解析
    const expected = parseXApiResponse(
      `${GQL}/UserOriginalsTimeline?variables=`,
      userOriginalsTimeline,
    );
    expect(expected.tweets.length).toBeGreaterThan(0);
    for (const op of [
      'UserRepliesTimeline',
      'UserRepostsTimeline',
      'UserVideoTimeline',
      'UserArticlesTweets',
      'UserHighlightsTweets',
      'UserSuperFollowTweets',
    ]) {
      const parsed = parseXApiResponse(`${GQL}/${op}?variables=`, userOriginalsTimeline);
      expect(parsed.matchedEndpoints).toEqual(['UserTimeline']);
      expect(parsed.tweets.map((t) => t.postId)).toEqual(expected.tweets.map((t) => t.postId));
    }
  });
});

describe('parseXApiResponse field details', () => {
  const user = {
    __typename: 'User',
    rest_id: '42',
    core: { screen_name: 'someone', name: 'Someone', created_at: 'Thu Jan 16 13:51:46 +0000 2025' },
    relationship_counts: { followers: 10, following: 5 },
  };
  const tweet = (legacy: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    data: {
      home: {
        home_timeline_urt: {
          instructions: [
            {
              type: 'TimelineAddEntries',
              entries: [
                {
                  entryId: 'tweet-1',
                  content: {
                    itemContent: {
                      tweet_results: {
                        result: {
                          __typename: 'Tweet',
                          rest_id: '1',
                          core: { user_results: { result: user } },
                          legacy: { full_text: 'x', ...legacy },
                          ...extra,
                        },
                      },
                    },
                  },
                },
              ],
            },
          ],
        },
      },
    },
  });

  it('classifies media and leaves missing metrics undefined instead of zero', () => {
    const mixed = parseXApiResponse(
      `${GQL}/HomeTimeline`,
      tweet({ extended_entities: { media: [{ type: 'photo' }, { type: 'video' }] } }),
    ).tweets[0];
    expect(mixed?.media).toBe('mixed');
    expect(mixed?.metrics).toEqual({});

    const gif = parseXApiResponse(
      `${GQL}/HomeTimeline`,
      tweet(
        { extended_entities: { media: [{ type: 'animated_gif' }] }, favorite_count: 3 },
        {
          views: { count: '1200', state: 'EnabledWithCount' },
        },
      ),
    ).tweets[0];
    expect(gif?.media).toBe('gif');
    expect(gif?.metrics).toEqual({ likes: 3, views: 1200 });
  });

  it('marks replies and quotes', () => {
    const parsed = parseXApiResponse(
      `${GQL}/HomeTimeline`,
      tweet({ in_reply_to_status_id_str: '9', is_quote_status: true }),
    ).tweets[0];
    expect(parsed?.isReply).toBe(true);
    expect(parsed?.isQuote).toBe(true);
  });

  it('still reads stats from the legacy user shape', () => {
    const parsed = parseXApiResponse(`${GQL}/UserByScreenName`, {
      data: {
        user: {
          result: {
            rest_id: '7',
            legacy: {
              screen_name: 'oldshape',
              followers_count: 99,
              friends_count: 3,
              statuses_count: 12,
              created_at: 'Thu Jan 16 13:51:46 +0000 2025',
              protected: true,
            },
          },
        },
      },
    });
    expect(parsed.users[0]?.stats).toEqual({
      followers: 99,
      followingCount: 3,
      tweets: 12,
      createdAt: Date.parse('2025-01-16T13:51:46Z'),
      isProtected: true,
    });
  });

  it('does not leak results between calls', () => {
    const first = parseXApiResponse(`${GQL}/UserByScreenName`, userByScreenName);
    expect(first.users).toHaveLength(1);
    expect(parseXApiResponse(`${GQL}/unknown`, {}).users).toEqual([]);
    expect(parseXApiResponse(`${GQL}/UserByScreenName`, { data: {} }).users).toEqual([]);
  });
});
