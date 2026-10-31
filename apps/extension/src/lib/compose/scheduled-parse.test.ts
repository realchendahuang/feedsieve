import { describe, expect, it } from 'vitest';
import {
  asScheduledEvent,
  graphqlOperation,
  parseScheduledList,
  parseScheduledMutation,
  requestVariables,
} from './scheduled-parse';
import { reduceScheduledCache, upcomingTimes, EMPTY_SCHEDULED_CACHE } from './schedule-store';

describe('X 预排期接口解析', () => {
  it('从 URL 取操作名', () => {
    expect(
      graphqlOperation(
        'https://x.com/i/api/graphql/H2elmT2R9DLhWoo0DZFNkA/FetchScheduledTweets?variables=%7B%7D',
      ),
    ).toBe('FetchScheduledTweets');
    expect(graphqlOperation('https://x.com/home')).toBeNull();
  });

  it('列表：秒和毫秒都认，坏条目丢掉，按时间排序', () => {
    const posts = parseScheduledList({
      data: {
        viewer: {
          scheduled_tweet_list: [
            {
              rest_id: '2',
              scheduling_info: { execute_at: 1793500000, state: 'Scheduled' },
              tweet_create_request: {
                type: 'PostTweetRequest',
                status: '第二条',
                media_ids: ['1', '2'],
              },
            },
            {
              rest_id: '1',
              scheduling_info: { execute_at: 1793400000000 },
              tweet_create_request: { status: '第一条' },
              media_entities: [{}],
            },
            { rest_id: 'bad', scheduling_info: { execute_at: 1 } },
          ],
        },
      },
    });
    expect(posts).toEqual([
      { id: '1', executeAt: 1793400000000, text: '第一条', media: 1 },
      { id: '2', executeAt: 1793500000000, text: '第二条', media: 2 },
    ]);
    expect(parseScheduledList({ data: { viewer: { scheduled_tweet_list: [] } } })).toEqual([]);
    expect(parseScheduledList({ errors: [] })).toBeNull();
  });

  it('新建：时间正文来自请求体，ID 来自响应', () => {
    const vars = requestVariables(
      'https://x.com/i/api/graphql/abc/CreateScheduledTweet',
      JSON.stringify({
        variables: {
          post_tweet_request: { status: 'hello', media_ids: [] },
          execute_at: 1793500000,
        },
      }),
    );
    expect(
      parseScheduledMutation('CreateScheduledTweet', vars, { data: { tweet: { rest_id: '99' } } }),
    ).toEqual({
      kind: 'upsert',
      post: { id: '99', executeAt: 1793500000000, text: 'hello', media: 0 },
    });
    expect(parseScheduledMutation('CreateScheduledTweet', vars, { errors: [{}] })).toBeNull();
  });

  it('修改和删除用请求里的 scheduled_tweet_id', () => {
    expect(
      parseScheduledMutation(
        'EditScheduledTweet',
        { scheduled_tweet_id: '7', execute_at: 1793600000, post_tweet_request: { status: 'x' } },
        { data: {} },
      ),
    ).toEqual({ kind: 'upsert', post: { id: '7', executeAt: 1793600000000, text: 'x', media: 0 } });
    expect(parseScheduledMutation('DeleteScheduledTweet', { scheduled_tweet_id: '7' }, {})).toEqual(
      {
        kind: 'delete',
        id: '7',
      },
    );
  });

  it('内容脚本侧再校验一遍', () => {
    expect(asScheduledEvent({ kind: 'delete', id: '<x>' })).toBeNull();
    expect(
      asScheduledEvent({
        kind: 'upsert',
        post: { id: '1', executeAt: 1793500000000, text: 't', media: 9 },
      }),
    ).toEqual({ kind: 'upsert', post: { id: '1', executeAt: 1793500000000, text: 't', media: 0 } });
  });
});

describe('缓存合并', () => {
  const now = 1793400000000;
  const post = (id: string, executeAt: number) => ({ id, executeAt, text: id, media: 0 });

  it('列表整体替换并记下同步时间；增量按 ID 合并；过期的拿掉', () => {
    let cache = reduceScheduledCache(
      EMPTY_SCHEDULED_CACHE,
      { kind: 'list', posts: [post('a', now + 3e6), post('old', now - 3e6)] },
      'me',
      now,
    );
    expect(cache).toEqual({ account: 'me', syncedAt: now, posts: [post('a', now + 3e6)] });
    cache = reduceScheduledCache(cache, { kind: 'upsert', post: post('b', now + 1e6) }, 'me', now);
    expect(cache.posts.map((p) => p.id)).toEqual(['b', 'a']);
    cache = reduceScheduledCache(cache, { kind: 'delete', id: 'a' }, 'me', now);
    expect(cache.posts.map((p) => p.id)).toEqual(['b']);
    expect(upcomingTimes(cache, now)).toEqual([now + 1e6]);
  });

  it('换了账号从空开始', () => {
    const mine = reduceScheduledCache(
      EMPTY_SCHEDULED_CACHE,
      { kind: 'list', posts: [post('a', now + 1e6)] },
      'me',
      now,
    );
    const other = reduceScheduledCache(
      mine,
      { kind: 'upsert', post: post('b', now + 2e6) },
      'alt',
      now,
    );
    expect(other).toEqual({ account: 'alt', syncedAt: null, posts: [post('b', now + 2e6)] });
  });
});
