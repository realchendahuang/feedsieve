import { describe, expect, it } from 'vitest';
import { parseXApiResponse } from './parse';

/**
 * 最小可复现的真实响应形状（路径与 X GraphQL 一致，值已脱敏）。
 * PureTwitter 反解产物中确认的路径：legacy.full_text / core.user_results.result 等。
 */
function tweetResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    __typename: 'Tweet',
    rest_id: '1720000000000000001',
    legacy: {
      full_text: 'free crypto! claim now',
      lang: 'en',
      retweeted_status_result: undefined,
    },
    core: {
      user_results: {
        result: {
          __typename: 'User',
          rest_id: '900000000000000001',
          legacy: {
            screen_name: 'spamking88',
            name: 'King Spam',
            description: 'giveaway expert',
            following: false,
          },
        },
      },
    },
    ...overrides,
  };
}

function entry(id: string, result: unknown): Record<string, unknown> {
  return { entryId: id, content: { itemContent: { tweet_results: { result } } } };
}

describe('parseXApiResponse', () => {
  it('parses TweetDetail including conversation replies', () => {
    const body = {
      data: {
        threaded_conversation_with_injections_v2: {
          instructions: [
            {
              entries: [
                entry('tweet-1720000000000000001', tweetResult()),
                {
                  entryId: 'conversationthread-1720000000000000002',
                  content: {
                    items: [
                      { item: { itemContent: { tweet_results: { result: tweetResult({
                        rest_id: '1720000000000000002',
                        legacy: { full_text: 'reply text', lang: 'en' },
                        core: { user_results: { result: {
                          rest_id: '900000000000000002',
                          legacy: { screen_name: 'replier01', name: 'Replier', description: '', following: false },
                        } } },
                      }) } } } },
                    ],
                  },
                },
              ],
            },
          ],
        },
      },
    };
    const parsed = parseXApiResponse(
      'https://x.com/i/api/graphql/xxx/TweetDetail?variables=',
      body,
    );
    expect(parsed.matchedEndpoints).toEqual(['TweetDetail']);
    expect(parsed.tweets).toHaveLength(2);
    expect(parsed.tweets[0]?.author.handle).toBe('spamking88');
    // rest_id：DOM 拿不到、拉黑 API 必需
    expect(parsed.tweets[0]?.author.xUserId).toBe('900000000000000001');
    expect(parsed.tweets[0]?.author.bio).toBe('giveaway expert');
    expect(parsed.tweets[1]?.author.handle).toBe('replier01');
  });

  it('unwraps retweets and TweetWithVisibilityResults', () => {
    const body = {
      data: {
        home: {
          home_timeline_urt: {
            instructions: [
              {
                entries: [
                  entry('tweet-1', tweetResult({
                    __typename: 'TweetWithVisibilityResults',
                    tweet: tweetResult(),
                    legacy: undefined,
                    core: undefined,
                  })),
                  entry('tweet-2', tweetResult({
                    legacy: {
                      full_text: 'RT @other: hi',
                      lang: 'en',
                      retweeted_status_result: {
                        result: tweetResult({
                          core: { user_results: { result: {
                            rest_id: '900000000000000003',
                            legacy: { screen_name: 'original01', name: 'Orig', description: '', following: false },
                          } } },
                        }),
                      },
                    },
                  })),
                  entry('promoted-tweet-3', tweetResult()),
                ],
              },
            ],
          },
        },
      },
    };
    const parsed = parseXApiResponse('https://x.com/i/api/graphql/xxx/HomeLatestTimeline', body);
    expect(parsed.matchedEndpoints).toEqual(['HomeTimeline']);
    expect(parsed.tweets).toHaveLength(2);
    expect(parsed.promoted).toHaveLength(1);
    expect(parsed.tweets[0]?.author.handle).toBe('spamking88');
    const retweet = parsed.tweets.find((t) => t.isRetweet);
    expect(retweet?.author.handle).toBe('original01');
  });

  it('parses ListMembers with rest_id and blocking state', () => {
    const body = {
      data: {
        list: {
          members_timeline: {
            timeline: {
              instructions: [
                {
                  type: 'TimelineAddEntries',
                  entries: [
                    { entryId: 'user-1', content: { itemContent: { user_results: { result: {
                      rest_id: '900000000000000001',
                      legacy: { screen_name: 'spamking88', blocking: false },
                    } } } } },
                    { entryId: 'user-2', content: { itemContent: { user_results: { result: {
                      rest_id: '900000000000000009',
                      legacy: { screen_name: 'already01', blocking: true },
                    } } } } },
                  ],
                },
              ],
            },
          },
        },
      },
    };
    const parsed = parseXApiResponse('https://x.com/i/api/graphql/xxx/ListMembers?variables=', body);
    expect(parsed.listMembers).toEqual([
      { xUserId: '900000000000000001', handle: 'spamking88', blocking: false },
      { xUserId: '900000000000000009', handle: 'already01', blocking: true },
    ]);
  });

  it('parses self handle from account settings', () => {
    const parsed = parseXApiResponse('https://api.x.com/1.1/account/settings.json', {
      screen_name: 'kim',
    });
    expect(parsed.selfHandle).toBe('kim');
  });

  it('returns empty result for unknown endpoints and garbage', () => {
    expect(parseXApiResponse('https://x.com/i/api/other', {}).matchedEndpoints).toEqual([]);
    expect(parseXApiResponse('https://x.com/i/api/graphql/HomeTimeline', 'not-an-object' as never).tweets).toEqual([]);
    expect(parseXApiResponse('https://x.com/i/api/graphql/HomeTimeline', null).tweets).toEqual([]);
    // 畸形条目安全跳过，不 throw
    const parsed = parseXApiResponse('https://x.com/i/api/graphql/HomeTimeline', {
      data: { home: { home_timeline_urt: { instructions: [{ entries: [entry('tweet-1', { broken: true })] }] } } },
    });
    expect(parsed.tweets).toEqual([]);
  });
});
