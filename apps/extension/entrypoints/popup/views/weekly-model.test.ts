import { afterEach, describe, expect, it, vi } from 'vitest';
import { asWeeklyIssue, fetchLatestIssue, WEEKLY_LATEST_API } from './weekly-model';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('asWeeklyIssue', () => {
  it('接受接口返回的完整数据', () => {
    expect(
      asWeeklyIssue({
        number: 2,
        title: ' 这一期的标题 ',
        postCount: 7,
        publishedAt: '2026-11-06T00:00:00.000Z',
        url: 'https://feedsieve.win/weekly/issues/2',
        cover: 'https://feedsieve.win/weekly/og/issue/2.png?v=2',
      }),
    ).toEqual({
      number: 2,
      title: '这一期的标题',
      postCount: 7,
      publishedAt: '2026-11-06T00:00:00.000Z',
      url: 'https://feedsieve.win/weekly/issues/2',
      cover: 'https://feedsieve.win/weekly/og/issue/2.png?v=2',
    });
  });

  it('期号、期页或封面不合法就整条丢弃', () => {
    const base = {
      number: 1,
      title: '标题',
      postCount: 3,
      publishedAt: '2026-10-30T00:00:00.000Z',
      url: 'https://feedsieve.win/weekly/issues/1',
      cover: 'https://feedsieve.win/weekly/og/issue/1.png?v=2',
    };
    expect(asWeeklyIssue({ ...base, number: 0 })).toBeNull();
    expect(asWeeklyIssue({ ...base, number: 1.5 })).toBeNull();
    expect(asWeeklyIssue({ ...base, url: 'https://example.com/x' })).toBeNull();
    expect(asWeeklyIssue({ ...base, cover: 'https://example.com/x.png' })).toBeNull();
    expect(asWeeklyIssue(null)).toBeNull();
  });

  it('标题为空时保留期号，条数非法按 0', () => {
    expect(
      asWeeklyIssue({
        number: 1,
        title: '   ',
        postCount: -3,
        url: 'https://feedsieve.win/weekly/issues/1',
        cover: 'https://feedsieve.win/weekly/og/issue/1.png?v=2',
      }),
    ).toMatchObject({ title: null, postCount: 0 });
  });
});

describe('fetchLatestIssue', () => {
  it('请求公开接口并返回解析后的数据', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        issue: {
          number: 1,
          title: '子代理时代的工作流',
          postCount: 7,
          publishedAt: '2026-10-30T07:53:28.878Z',
          url: 'https://feedsieve.win/weekly/issues/1',
          cover: 'https://feedsieve.win/weekly/og/issue/1.png?v=2',
        },
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const issue = await fetchLatestIssue();

    expect(fetchMock).toHaveBeenCalledWith(WEEKLY_LATEST_API, expect.any(Object));
    expect(issue?.number).toBe(1);
    expect(issue?.title).toBe('子代理时代的工作流');
  });

  it('非 200 或网络错误都返回 null', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, json: async () => ({}) })),
    );
    expect(await fetchLatestIssue()).toBeNull();

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    expect(await fetchLatestIssue()).toBeNull();
  });
});
