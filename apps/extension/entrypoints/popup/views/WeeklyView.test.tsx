// @vitest-environment happy-dom
// 周刊推荐位：封面、最新一期、官网入口；接口/封面失败时都必须有可用的兜底。
import React, { act } from 'react';
import ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WeeklyView from './WeeklyView';

const LATEST = {
  issue: {
    number: 2,
    title: '这一期的标题',
    postCount: 7,
    publishedAt: '2026-11-06T00:00:00.000Z',
    url: 'https://feedsieve.win/weekly/issues/2',
    cover: 'https://feedsieve.win/weekly/og/issue/2.png?v=2',
  },
};

let root: ReactDOM.Root;
let container: HTMLElement;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.body.innerHTML = '<div id="root"></div>';
  container = document.querySelector<HTMLElement>('#root')!;
  root = ReactDOM.createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

function mockFetch(data: unknown, ok = true): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok, json: async () => data })),
  );
}

async function render(language: 'zh' | 'en'): Promise<void> {
  await act(async () => {
    root.render(<WeeklyView language={language} />);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function hrefs(): Array<string | null> {
  return [...container.querySelectorAll('a')].map((anchor) => anchor.getAttribute('href'));
}

describe('周刊推荐位', () => {
  it('展示最新一期：期号、标题、条数、期页和这一期的封面', async () => {
    mockFetch(LATEST);
    await render('zh');

    expect(container.textContent).toContain('小筛子周刊');
    expect(container.textContent).toContain('第 2 期');
    expect(container.textContent).toContain('这一期的标题');
    expect(container.textContent).toContain('7 条');

    const image = container.querySelector<HTMLImageElement>('img');
    expect(image?.getAttribute('src')).toBe('https://feedsieve.win/weekly/og/issue/2.png?v=2');
    expect(hrefs()).toContain('https://feedsieve.win/weekly/issues/2');
    expect(hrefs()).toContain('https://feedsieve.win/weekly');
    expect(hrefs()).toContain('https://feedsieve.win/weekly/feed.xml');
  });

  it('接口不可用时退回站点封面和第 1 期，不显示错误', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    await render('zh');

    expect(container.querySelector('.weekly-issue')).toBeNull();
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      'https://feedsieve.win/weekly/og/site.png?v=2',
    );
    expect(container.textContent).toContain('读第 1 期');
    expect(hrefs()).toContain('https://feedsieve.win/weekly/issues/1');
  });

  it('这一期封面失败先退站点封面，再失败显示品牌兜底', async () => {
    mockFetch(LATEST);
    await render('zh');
    const image = container.querySelector('img')!;
    expect(image.getAttribute('src')).toBe('https://feedsieve.win/weekly/og/issue/2.png?v=2');

    await act(async () => {
      image.dispatchEvent(new Event('error'));
    });
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      'https://feedsieve.win/weekly/og/site.png?v=2',
    );

    await act(async () => {
      container.querySelector('img')!.dispatchEvent(new Event('error'));
    });
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('小筛子周刊');
    expect(container.textContent).toContain('去噪精选社区');
  });

  it('英文界面使用英文文案和期号', async () => {
    mockFetch(LATEST);
    await render('en');
    expect(container.textContent).toContain('FeedSieve Weekly');
    expect(container.textContent).toContain('Issue 2');
    expect(container.textContent).toContain('Read issue 2');
  });
});
