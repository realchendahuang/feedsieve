// @vitest-environment happy-dom
// 主页洞察：跟随标签页、账号卡与基线、排序筛选、搜高赞帖、导出。
import React, { act } from 'react';
import ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analyzeProfile } from '@feedsieve/metrics';
import ProfileView from './ProfileView';
import {
  asCatalogEntry,
  googleSearchUrl,
  handleFromUrl,
  isProfileUrl,
  outliersMarkdown,
  postsCsv,
} from './profile-model';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();

const mounted: Array<{ unmount: () => void }> = [];
let tabUrl: string;
let entry: unknown;
let tabsCreate: ReturnType<typeof vi.fn>;
let updatedListeners: Array<
  (id: number, change: { url?: string }, tab: { active?: boolean }) => void
>;
let clipboard: string | null;

function post(id: string, views: number, extra: Record<string, unknown> = {}) {
  return {
    postId: id,
    createdAt: NOW - 3 * DAY,
    views,
    likes: Math.round(views / 100),
    bookmarks: Math.round(views / 1_000),
    replies: 3,
    kind: 'original',
    media: 'none',
    snippet: `帖子 ${id}`,
    firstSeenAt: NOW,
    updatedAt: NOW,
    ...extra,
  };
}

function catalog(posts: ReturnType<typeof post>[]) {
  return {
    account: {
      handle: 'alice',
      displayName: 'Alice',
      followers: 32_000,
      followingCount: 1_600,
      tweets: 8_200,
      createdAt: NOW - 6.5 * 365 * DAY,
    },
    posts: Object.fromEntries(posts.map((p) => [p.postId, p])),
    firstVisitAt: NOW - 10 * DAY,
    lastVisitAt: NOW,
  };
}

/** 12 条普通帖子（浏览 1 万左右）+ 一条 8 倍的爆款 + 一条回复。 */
function typical() {
  return catalog([
    ...Array.from({ length: 12 }, (_, i) =>
      post(`18500000000000001${String(i).padStart(2, '0')}`, 10_000 + i * 100),
    ),
    post('1850000000000000900', 82_000, { bookmarks: 4_000 }),
    post('1850000000000000901', 500_000, { kind: 'reply' }),
  ]);
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.body.replaceChildren();
  tabUrl = 'https://x.com/alice';
  entry = typical();
  clipboard = null;
  updatedListeners = [];
  tabsCreate = vi.fn().mockResolvedValue({ id: 9 });
  const stored: Record<string, unknown> = {};
  vi.stubGlobal('browser', {
    storage: {
      local: {
        get: vi.fn(async () => ({ ...stored })),
        set: vi.fn(async (items: Record<string, unknown>) => Object.assign(stored, items)),
      },
    },
    tabs: {
      query: vi.fn(async () => [{ id: 3, index: 4, active: true, url: tabUrl }]),
      create: tabsCreate,
      onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
      onUpdated: {
        addListener: (fn: (typeof updatedListeners)[number]) => updatedListeners.push(fn),
        removeListener: vi.fn(),
      },
    },
    runtime: {
      sendMessage: vi.fn(async (message: { type: string; handle?: string }) =>
        message.type === 'feedsieve:profile-get' && message.handle === 'alice' ? entry : null,
      ),
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  });
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn(async (text: string) => void (clipboard = text)) },
  });
});

afterEach(() => {
  for (const root of mounted.splice(0)) act(() => root.unmount());
});

async function render() {
  const el = document.createElement('div');
  el.className = 'popup-content';
  document.body.append(el);
  const root = ReactDOM.createRoot(el);
  mounted.push(root);
  const notify = vi.fn();
  await act(async () => {
    root.render(
      React.createElement(ProfileView, {
        language: 'zh' as const,
        notify,
        sendToXPage: async () => ({ found: false }),
      }),
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return { el, notify };
}

const texts = (el: HTMLElement) =>
  [...el.querySelectorAll('.profile-post .post-text')].map((node) => node.textContent);

describe('ProfileView', () => {
  it('shows the account, the baseline and outliers first', async () => {
    const { el } = await render();
    expect(el.querySelector('.profile-card .post-name')?.textContent).toBe('Alice');
    expect(el.querySelector('.profile-card .post-meta')?.textContent).toBe('注册 6 年');
    const kpis = [...el.querySelectorAll('.kpi-card dd')].map((n) => n.textContent);
    // 中位浏览 10600、爆款率（13 条里 1 条）、已收 14 条
    expect(kpis).toEqual(['1万', '8%', '14条']);
    // 账号资料一行写完；量级是文字标签，不再重复粉丝数
    expect(el.querySelector('.profile-stats')?.textContent).toBe(
      '3.2万 粉丝1600 关注关注比 0.058200 发帖',
    );
    expect(el.querySelector('.profile-card .tier-tag')?.textContent).toBe('达人');
    // 默认按倍数，回复默认不显示
    expect(texts(el)[0]).toBe('帖子 1850000000000000900');
    expect(texts(el)).not.toContain('帖子 1850000000000000901');
    const first = el.querySelector('.profile-post .multiple-tag')!;
    expect(first.textContent).toBe('7.7×');
    expect(first.classList.contains('is-outlier')).toBe(true);
  });

  it('sorts, includes replies on request and remembers the choices', async () => {
    const { el } = await render();
    const select = el.querySelector<HTMLSelectElement>('select.sort-select')!;
    await act(async () => {
      select.value = 'recent';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(browser.storage.local.set).toHaveBeenCalledWith({ profileSortV1: 'recent' });
    const chip = [...el.querySelectorAll<HTMLButtonElement>('.chip')].find(
      (b) => b.textContent === '含回复',
    )!;
    await act(async () => chip.click());
    expect(texts(el)).toContain('帖子 1850000000000000901');
    expect(el.querySelector('.kind-tag')?.textContent).toBe('回复');
  });

  it('follows the active tab, and keeps the last creator on other pages', async () => {
    const { el } = await render();
    entry = { ...catalog([]), account: { handle: 'bob' } };
    // 收到地址变化时面板重新查本窗口的激活标签页，所以先改激活标签页的地址再发事件
    const navigate = async (url: string) => {
      tabUrl = url;
      await act(async () => {
        for (const listener of updatedListeners) listener(3, { url }, { active: true });
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    };
    await navigate('https://x.com/alice/status/1');
    // 帖子详情页：还是 alice
    expect(el.querySelector('.profile-card .post-name')?.textContent).toBe('Alice');
    await navigate('https://x.com/bob');
    // bob 还没有帖子库
    expect(el.textContent).toContain('往下滚动主页');
  });

  it('opens an X search for their most-liked posts', async () => {
    const { el } = await render();
    const button = el.querySelector<HTMLButtonElement>('button[aria-label="在 X 搜高赞帖"]')!;
    await act(async () => button.click());
    const url = new URL(tabsCreate.mock.calls[0]![0].url as string);
    expect(url.pathname).toBe('/search');
    // 中位点赞约 106 → 5 倍取整 500
    expect(url.searchParams.get('q')).toBe('from:alice min_faves:500');
    expect(tabsCreate.mock.calls[0]![0]).toMatchObject({ active: true, index: 5 });
  });

  it('copies the top outliers as Markdown for AI', async () => {
    const { el, notify } = await render();
    const button = el.querySelector<HTMLButtonElement>('button[aria-label="复制 Top 20 给 AI"]')!;
    await act(async () => button.click());
    expect(clipboard).toContain('# @alice 的爆款帖');
    expect(clipboard).toContain('## 1. 7.7×');
    expect(clipboard).toContain('https://x.com/alice/status/1850000000000000900');
    // 回复不进 Top
    expect(clipboard).not.toContain('1850000000000000901');
    expect(notify).toHaveBeenCalledWith('已复制');
  });

  it('explains the multiple on hover', async () => {
    const { el } = await render();
    const badge = el.querySelector<HTMLElement>('.profile-post .multiple-tag')!;
    await act(async () => {
      badge.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    const tip = document.querySelector('.help-tooltip')!;
    expect(tip.textContent).toBe('浏览 8.2万，是他中位浏览 1万 的 7.7×\n3 倍以上算爆款');
  });

  it('searches their posts on Google with keywords and a date range', async () => {
    const { el } = await render();
    await act(async () =>
      el.querySelector<HTMLButtonElement>('button[aria-label="用 Google 搜他的帖子"]')!.click(),
    );
    const form = el.querySelector<HTMLFormElement>('.google-search')!;
    const input = form.querySelector('input')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'Claude 插件');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const select = form.querySelector('select')!;
      select.value = 'y';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const url = new URL(tabsCreate.mock.calls[0]![0].url as string);
    expect(url.hostname).toBe('www.google.com');
    expect(url.searchParams.get('q')).toBe(
      '(site:x.com/alice/status OR site:twitter.com/alice/status) Claude 插件',
    );
    expect(url.searchParams.get('tbs')).toBe('qdr:y');
    expect(el.querySelector('.google-search')).toBeNull();
  });

  it('keeps only the search icons when nothing is collected yet', async () => {
    entry = catalog([]);
    const { el } = await render();
    expect(el.textContent).toContain('往下滚动主页');
    const labels = [...el.querySelectorAll('.profile-tools button')].map((b) =>
      b.getAttribute('aria-label'),
    );
    expect(labels).toEqual(['在 X 搜高赞帖', '用 Google 搜他的帖子']);
    // 没有赤裸裸的大按钮
    expect(el.querySelector('.secondary-button')).toBeNull();
  });

  it('asks to open a profile when the tab is not one', async () => {
    tabUrl = 'https://x.com/home';
    const { el } = await render();
    expect(el.textContent).toContain('打开一个博主的主页');
  });
});

describe('profile-model', () => {
  it('builds a Google site search and tells profile pages apart', () => {
    expect(googleSearchUrl('alice', '  ', 'any')).toBe(
      'https://www.google.com/search?q=%28site%3Ax.com%2Falice%2Fstatus+OR+site%3Atwitter.com%2Falice%2Fstatus%29',
    );
    expect(isProfileUrl('https://x.com/alice')).toBe(true);
    expect(isProfileUrl('https://x.com/search?q=from%3Aalice')).toBe(false);
    expect(isProfileUrl('https://x.com/home')).toBe(false);
  });

  it('finds the creator from profile and from:handle search urls', () => {
    expect(handleFromUrl('https://x.com/Alice/with_replies')).toBe('alice');
    expect(handleFromUrl('https://x.com/search?q=from%3AAlice%20min_faves%3A500&f=top')).toBe(
      'alice',
    );
    expect(handleFromUrl('https://x.com/search?q=hello')).toBeNull();
    expect(handleFromUrl('https://x.com/alice/status/1')).toBeNull();
    expect(handleFromUrl('https://evil.example/alice')).toBeNull();
    expect(handleFromUrl(undefined)).toBeNull();
  });

  it('rejects a catalog for a different creator and drops bad posts', () => {
    expect(asCatalogEntry(typical(), 'bob')).toBeNull();
    const cleaned = asCatalogEntry(
      { ...catalog([post('1', 10), { ...post('x', 10), postId: 'evil' }]) },
      'alice',
    )!;
    expect(Object.keys(cleaned.posts)).toEqual(['1']);
  });

  it('escapes CSV cells and neutralises formulas', () => {
    const data = catalog([
      post('1', 10, { snippet: '=HYPERLINK("http://evil")' }),
      post('2', 20, { snippet: 'a,"b"\nc' }),
    ]);
    const clean = asCatalogEntry(data, 'alice')!;
    const posts = Object.values(clean.posts);
    const csv = postsCsv('alice', posts, analyzeProfile(posts, NOW));
    expect(csv.startsWith('\uFEFFpost_id,url,')).toBe(true);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv).toContain('"a,""b""\nc"');
  });

  it('writes a header and an empty list when there are no outliers yet', () => {
    const md = outliersMarkdown(
      'alice',
      [],
      analyzeProfile([], NOW),
      {
        header: (h) => `# ${h}`,
        meta: () => 'meta',
        ask: 'ask',
        item: () => 'item',
      },
      { now: NOW, formatNumber: String },
    );
    expect(md).toBe('# alice\n\nask\n');
  });
});
