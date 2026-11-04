// @vitest-environment happy-dom
// 热帖：X 推文样式的渲染、后台打开、自动刷新，以及来自后台的回复必须过形态校验。
import React, { act } from 'react';
import ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HotView, { groupByAuthor } from './HotView';
import { asHotPostList } from './shared';

const mountedRoots: Array<{ unmount: () => void }> = [];

let tabsCreate: ReturnType<typeof vi.fn>;
let runtimeSend: ReturnType<typeof vi.fn>;
let runtimeListeners: Array<(message: unknown) => void>;
let stored: Record<string, unknown>;
let sessionStored: Record<string, unknown>;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.body.replaceChildren();
  tabsCreate = vi.fn().mockResolvedValue({ id: 9 });
  runtimeSend = vi.fn().mockResolvedValue([]);
  runtimeListeners = [];
  stored = {};
  sessionStored = {};
  vi.stubGlobal('browser', {
    storage: {
      session: {
        get: vi.fn(async () => ({ ...sessionStored })),
        set: vi.fn(async (items: Record<string, unknown>) => Object.assign(sessionStored, items)),
      },
      local: {
        get: vi.fn(async () => ({ ...stored })),
        set: vi.fn(async (items: Record<string, unknown>) => Object.assign(stored, items)),
      },
    },
    tabs: {
      query: vi.fn().mockResolvedValue([{ id: 3, index: 4, active: true }]),
      create: tabsCreate,
    },
    runtime: {
      sendMessage: runtimeSend,
      onMessage: {
        addListener: (listener: (message: unknown) => void) => runtimeListeners.push(listener),
        removeListener: (listener: (message: unknown) => void) => {
          runtimeListeners = runtimeListeners.filter((item) => item !== listener);
        },
      },
    },
  });
});

afterEach(() => {
  for (const root of mountedRoots.splice(0)) act(() => root.unmount());
  vi.useRealTimers();
});

/** send 同时当作后台（热帖数据）和当前 X 标签页（定位帖子）的回复。 */
async function renderHotView(send: (message: { type: string }) => Promise<unknown>) {
  runtimeSend.mockImplementation(send);
  const sendToXPage = send;
  const rootEl = document.createElement('div');
  document.body.append(rootEl);
  const root = ReactDOM.createRoot(rootEl);
  mountedRoots.push(root);
  await act(async () => {
    root.render(React.createElement(HotView, { language: 'zh' as const, sendToXPage, onOpenSettings: vi.fn() }));
  });
  return rootEl;
}

/** 鼠标移进 / 移出热帖页（React 用 pointerover / pointerout 合成 enter / leave）。 */
async function pointer(root: HTMLElement, inside: boolean) {
  const view = root.querySelector('.hot-view')!;
  await act(async () => {
    view.dispatchEvent(
      inside
        ? new PointerEvent('pointerover', { bubbles: true, relatedTarget: document.body })
        : new PointerEvent('pointerout', { bubbles: true, relatedTarget: document.body }),
    );
  });
}

/** 在排序下拉里选一项。 */
async function chooseSort(root: HTMLElement, value: string) {
  const select = root.querySelector<HTMLSelectElement>('select.sort-select')!;
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

const HOT = {
  postId: '1850000000000000001',
  handle: 'alice',
  displayName: 'Alice',
  avatarUrl: 'https://pbs.twimg.com/profile_images/1/alice_normal.jpg',
  verified: true,
  mediaUrl: 'https://pbs.twimg.com/media/A.jpg',
  snippet: '一条很热的帖子\n第二行 https://t.co/abc123',
  createdAt: Date.now() - 2 * 60 * 60_000,
  views: 182_000,
  followers: 925,
  replies: 46,
  likes: 3_200,
  retweets: 410,
  bookmarks: 980,
  projected: 2_400_000,
  velocity: 52_300,
  breakout: 196.8,
  tier: 1,
  viral: 82,
  opportunity: { hoursLeft: 22, remainingViews: 575_300, competition: 46 },
};

describe('HotView', () => {
  it('renders each hot post like a post on X', async () => {
    const send = vi.fn().mockResolvedValue([HOT]);
    const root = await renderHotView(send);
    expect(send).toHaveBeenCalledWith({ type: 'feedsieve:hot-posts', sort: 'heat' });
    const post = root.querySelector<HTMLAnchorElement>('.post')!;
    // 1. 头像、名字、蓝标、@handle
    expect(post.querySelector('img.post-avatar')?.getAttribute('src')).toBe(
      'https://pbs.twimg.com/profile_images/1/alice_bigger.jpg',
    );
    expect(post.querySelector('.post-name')?.textContent).toBe('Alice');
    expect(post.querySelector('.post-verified')).not.toBeNull();
    expect(post.querySelector('.post-handle')?.textContent).toBe('@alice');
    const tier = post.querySelector('.tier-pill')!;
    expect(tier.textContent).toBe('925');
    expect(tier.getAttribute('aria-label')).toBe('925 粉丝');
    // 流速在右上角
    expect(post.querySelector('.post-head .velocity-tag')?.textContent).toBe('52.3K/h');
    expect(post.querySelector('.velocity-tag')?.getAttribute('data-fs-level')).toBe('rocket');
    // 2. 正文完整、保留换行，末尾的 t.co 占位链接去掉；配图
    expect(post.querySelector('.post-text')?.textContent).toBe('一条很热的帖子\n第二行');
    expect(post.querySelector('.post-media')?.getAttribute('src')).toBe(
      'https://pbs.twimg.com/media/A.jpg?name=small',
    );
    // 3. X 同款动作栏：回复、转发、喜欢、浏览、收藏
    const stats = [...post.querySelectorAll('.post-actions span')].map((node) => node.textContent);
    expect(stats).toEqual(['46', '410', '3,200', '18.2万', '']);
    // X 的短时间写法
    expect(post.querySelector('.post-meta')?.textContent).toBe('2小时');
    // 热度排序下没有多余的说明行
    expect(post.querySelector('.hot-insight')).toBeNull();
    expect(post.getAttribute('href')).toBe('https://x.com/alice/status/1850000000000000001');
    expect(post.getAttribute('rel')).toContain('noopener');
  });

  it('switches to reply-opportunity sort and swaps the metric line', async () => {
    const send = vi.fn().mockResolvedValue([HOT]);
    const root = await renderHotView(send);
    await chooseSort(root, 'opportunity');
    expect(send).toHaveBeenCalledWith({ type: 'feedsieve:hot-posts', sort: 'opportunity' });
    // 理由和「去回复」在卡片外面一行（卡片本身是链接）
    const insight = root.querySelector('.post-extra .hot-insight')!;
    expect(insight.querySelector('.metric-lead')?.textContent).toBe('+57.5万 浏览');
    expect(insight.textContent).toContain('46 条回复');
    expect(insight.textContent).toContain('剩 22 小时');
    const reply = root.querySelector<HTMLButtonElement>('.reply-button')!;
    await act(async () => reply.click());
    // 直接打开 X 官方回复框，前台打开
    expect(tabsCreate).toHaveBeenCalledWith({
      url: 'https://x.com/intent/post?in_reply_to=1850000000000000001',
      active: true,
    });
    expect(runtimeSend).toHaveBeenCalledWith({
      type: 'feedsieve:insight-read',
      postIds: ['1850000000000000001'],
    });
  });

  it('sorts by followers, bookmarks or just seen and remembers the choice', async () => {
    const send = vi.fn().mockResolvedValue([HOT]);
    const root = await renderHotView(send);
    const options = [...root.querySelectorAll('select.sort-select option')].map(
      (node) => node.textContent,
    );
    expect(options).toEqual(['热度', '回复机会', '粉丝数', '收藏数', '最近刷到']);
    for (const sort of ['followers', 'bookmarks', 'recent']) {
      await chooseSort(root, sort);
      expect(send).toHaveBeenCalledWith({ type: 'feedsieve:hot-posts', sort });
    }
    expect(stored.hotSortV1).toBe('recent');
    // 收藏数排序时动作栏写出收藏数，其他排序和 X 一样只有图标
    const bookmark = () => [...root.querySelectorAll('.post-actions span')].at(-1)?.textContent;
    expect(bookmark()).toBe('');
    await chooseSort(root, 'bookmarks');
    expect(bookmark()).toBe('980');
  });

  it('scrolls to the post when it is on the page, otherwise opens it in a background tab', async () => {
    const send = vi.fn(async (message: { type: string }) =>
      message.type === 'feedsieve:scroll-to-post' ? { found: true } : [HOT],
    );
    const root = await renderHotView(send);
    await act(async () => {
      root.querySelector<HTMLAnchorElement>('.post')!.click();
    });
    expect(send).toHaveBeenCalledWith({ type: 'feedsieve:scroll-to-post', postId: HOT.postId });
    expect(tabsCreate).not.toHaveBeenCalled();
    // 点过的帖子变淡，方便连续往下看
    expect(root.querySelector('.post')?.classList.contains('is-visited')).toBe(true);

    send.mockImplementation(async (message: { type: string }) =>
      message.type === 'feedsieve:scroll-to-post' ? { found: false } : [HOT],
    );
    await act(async () => {
      root.querySelector<HTMLAnchorElement>('.post')!.click();
    });
    // 后台打开、紧挨当前标签页：当前页面不切走，热帖列表不会丢
    expect(tabsCreate).toHaveBeenCalledWith({
      url: 'https://x.com/alice/status/1850000000000000001',
      active: false,
      index: 5,
      openerTabId: 3,
    });
  });

  it('shows distinct empty states', async () => {
    const noData = await renderHotView(vi.fn().mockResolvedValue([]));
    expect(noData.textContent).toContain('刷一会儿 x.com');
    const quietPage = await renderHotView(
      vi.fn(async (message: { type: string }) =>
        message.type === 'feedsieve:hot-brief'
          ? { seen: 3, authors: 2, hot: 0, medianVelocity: 12, topBreakout: null, tiers: [] }
          : [],
      ),
    );
    expect(quietPage.textContent).toContain('刷到 3 条，暂时没有在火的');
    // 后台暂时不可达：按「还没有数据」处理，不报错
    const noBackground = await renderHotView(vi.fn().mockRejectedValue(new Error('no receiver')));
    expect(noBackground.textContent).toContain('刷一会儿 x.com');
  });

  it('reloads when the background announces new data, without a manual refresh', async () => {
    vi.useFakeTimers();
    const send = vi.fn().mockResolvedValue([]);
    await renderHotView(send);
    expect(send).toHaveBeenCalledTimes(3); // 热帖 + 简报 + 已读
    // 快速滚动时连续几次广播，合并成一次重取
    await act(async () => {
      for (const listener of runtimeListeners) listener({ type: 'feedsieve:insight-updated' });
      for (const listener of runtimeListeners) listener({ type: 'feedsieve:insight-updated' });
      for (const listener of runtimeListeners) listener({ type: 'unrelated' });
      vi.advanceTimersByTime(500);
    });
    expect(send).toHaveBeenCalledTimes(6);
    // 没有新数据时每分钟兜底重算一次（流速和相对时间会随时间变化）
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(send).toHaveBeenCalledTimes(9);
    for (const root of mountedRoots.splice(0)) act(() => root.unmount());
    expect(runtimeListeners).toHaveLength(0);
    await act(async () => {
      vi.advanceTimersByTime(120_000);
    });
    expect(send).toHaveBeenCalledTimes(9);
  });
});

describe('reading flow', () => {
  const post = (id: string, extra: Record<string, unknown> = {}) => ({
    ...HOT,
    postId: id,
    handle: `user_${id.slice(-3)}`,
    ...extra,
  });

  it('keeps the list still while the user is looking and shows new posts after the bar is clicked', async () => {
    let current = [post('1850000000000000101'), post('1850000000000000102')];
    const send = vi.fn(async (message: { type: string }) =>
      message.type === 'feedsieve:hot-posts' ? current : null,
    );
    const root = await renderHotView(send);
    await pointer(root, true);
    const handles = () => [...root.querySelectorAll('.post-handle')].map((n) => n.textContent);
    expect(handles()).toEqual(['@user_101', '@user_102']);
    expect(root.querySelector('.new-posts-bar')).toBeNull();

    // 新数据：多了一条、顺序也变了
    current = [
      post('1850000000000000103'),
      post('1850000000000000102'),
      post('1850000000000000101'),
    ];
    await act(async () => {
      for (const listener of runtimeListeners) listener({ type: 'feedsieve:insight-updated' });
      await new Promise((resolve) => setTimeout(resolve, 600));
    });
    // 列表不动，顶部出现提示
    expect(handles()).toEqual(['@user_101', '@user_102']);
    expect(root.querySelector('.new-posts-bar')?.textContent).toBe('有 1 条新热帖');

    await act(async () => root.querySelector<HTMLButtonElement>('.new-posts-bar')!.click());
    expect(handles()).toEqual(['@user_103', '@user_102', '@user_101']);
    expect(root.querySelector('.new-posts-bar')).toBeNull();
    // 新进来的那条带蓝点；鼠标离开后清掉
    const freshHandles = () =>
      [...root.querySelectorAll('.post.is-new .post-handle')].map((n) => n.textContent);
    expect(freshHandles()).toEqual(['@user_103']);
    await pointer(root, false);
    expect(freshHandles()).toEqual([]);
  });

  it('lets new posts straight in while the user is not looking at the list', async () => {
    let current = [post('1850000000000000111')];
    const send = vi.fn(async (message: { type: string }) =>
      message.type === 'feedsieve:hot-posts' ? current : null,
    );
    const root = await renderHotView(send);
    const handles = () => [...root.querySelectorAll('.post-handle')].map((n) => n.textContent);
    const update = async (next: typeof current) => {
      current = next;
      await act(async () => {
        for (const listener of runtimeListeners) listener({ type: 'feedsieve:insight-updated' });
        await new Promise((resolve) => setTimeout(resolve, 600));
      });
    };
    // 侧边栏开着、用户在 X 上滑：列表停在顶部、鼠标不在上面，直接进来，不用点提示条
    await update([post('1850000000000000112'), post('1850000000000000111')]);
    expect(handles()).toEqual(['@user_112', '@user_111']);
    expect(root.querySelector('.new-posts-bar')).toBeNull();
    await update([
      post('1850000000000000113'),
      post('1850000000000000112'),
      post('1850000000000000111'),
    ]);
    // 蓝点一直累积到用户回来看
    const fresh = [...root.querySelectorAll('.post.is-new .post-handle')].map((n) => n.textContent);
    expect(fresh).toEqual(['@user_113', '@user_112']);
  });

  it('shows posts the user stopped on in "just seen", even with hide-read on', async () => {
    const send = vi.fn(async (message: { type: string }) =>
      message.type === 'feedsieve:hot-posts'
        ? [post('1850000000000000121', { read: true }), post('1850000000000000122')]
        : null,
    );
    const root = await renderHotView(send);
    expect(root.querySelectorAll('a.post')).toHaveLength(1);
    await chooseSort(root, 'recent');
    expect(root.querySelectorAll('a.post')).toHaveLength(2);
    expect(root.querySelector('a.post.is-visited')).toBeNull();
    // 这个排序下「隐藏已读」不起作用，开关也不显示
    expect(
      [...root.querySelectorAll('.chip')].some((b) => b.textContent?.startsWith('隐藏已读')),
    ).toBe(false);
  });

  it('hides posts already read and can show them again', async () => {
    const send = vi.fn(async (message: { type: string }) =>
      message.type === 'feedsieve:hot-posts'
        ? [post('1850000000000000201', { read: true }), post('1850000000000000202')]
        : null,
    );
    const root = await renderHotView(send);
    expect(root.querySelectorAll('a.post')).toHaveLength(1);
    const chip = [...root.querySelectorAll<HTMLButtonElement>('.chip')].find((b) =>
      b.textContent?.startsWith('隐藏已读'),
    )!;
    expect(chip.textContent).toBe('隐藏已读1');
    await act(async () => chip.click());
    // 已读的回来了，变淡显示
    expect(root.querySelectorAll('a.post')).toHaveLength(2);
    expect(root.querySelector('a.post.is-visited .post-handle')?.textContent).toBe('@user_201');
    expect(stored.hotHideReadV1).toBe(false);
  });

  it('filters to Chinese posts by default, keeping text-free posts', async () => {
    const send = vi.fn(async (message: { type: string }) =>
      message.type === 'feedsieve:hot-posts'
        ? [
            post('1850000000000000301', { lang: 'zh' }),
            post('1850000000000000302', { lang: 'ar' }),
            post('1850000000000000303', { lang: 'zxx' }),
            post('1850000000000000304'),
          ]
        : null,
    );
    const root = await renderHotView(send);
    const handles = () => [...root.querySelectorAll('.post-handle')].map((n) => n.textContent);
    expect(handles()).toEqual(['@user_301', '@user_303', '@user_304']);
    const chip = [...root.querySelectorAll<HTMLButtonElement>('.chip')].find(
      (b) => b.textContent === '仅中文',
    )!;
    await act(async () => chip.click());
    expect(handles()).toHaveLength(4);
    expect(stored.hotLangV1).toBe('all');
  });
});

describe('long lists', () => {
  // 渲染上百条帖子：全量并发跑测试时偶尔超过默认 5 秒
  it('shows 20 posts first and loads the next page when the bottom scrolls into view', async () => {
    let trigger: (() => void) | null = null;
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) {
          trigger = () => callback([{ isIntersecting: true }]);
        }
        observe() {}
        disconnect() {}
      },
    );
    const many = Array.from({ length: 45 }, (_, i) => ({
      ...HOT,
      postId: String(1850000000000001000 + i),
      handle: `user_${i}`,
    }));
    const root = await renderHotView(
      vi.fn(async (message: { type: string }) =>
        message.type === 'feedsieve:hot-posts' ? many : null,
      ),
    );
    expect(root.querySelectorAll('a.post')).toHaveLength(20);
    await act(async () => trigger!());
    expect(root.querySelectorAll('a.post')).toHaveLength(40);
    await act(async () => trigger!());
    expect(root.querySelectorAll('a.post')).toHaveLength(45);
    // 全部显示完：哨兵撤掉
    expect(root.querySelector('.list-sentinel')).toBeNull();

    // 切换排序回到第一页
    await chooseSort(root, 'opportunity');
    expect(root.querySelectorAll('a.post')).toHaveLength(20);
  }, 20_000);
});

describe('global hot list', () => {
  it('fetches the crowdsourced list only when the user switches to it', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        generated_at: Date.now() - 3 * 60_000,
        window_hours: 2,
        posts: [
          { ...HOT, postId: '9001', handle: 'global_one', velocity: 20_000, replies: 400 },
          { ...HOT, postId: '9002', handle: 'global_two', velocity: 9_000, replies: 2 },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const root = await renderHotView(vi.fn().mockResolvedValue([HOT]));
    expect(fetchMock).not.toHaveBeenCalled();

    const toGlobal = [...root.querySelectorAll('button')].find((b) => b.textContent === '全站')!;
    await act(async () => {
      toGlobal.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/v1\/hot$/), {
      credentials: 'omit',
      cache: 'default',
    });
    expect(root.querySelector('.list-meta')?.textContent).toBe('全站热榜 · 更新于 3分钟前');
    const handles = () => [...root.querySelectorAll('.post-handle')].map((n) => n.textContent);
    // 服务端按热度排好
    expect(handles()).toEqual(['@global_one', '@global_two']);

    // 回复机会在本地按同一公式重排：回复少的排前面
    await chooseSort(root, 'opportunity');
    expect(handles()).toEqual(['@global_two', '@global_one']);
  });

  it('drops posts that are not hot and re-sorts locally', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          generated_at: Date.now(),
          window_hours: 2,
          posts: [
            { ...HOT, postId: '9101', handle: 'big_heat', velocity: 30_000, followers: 500 },
            { ...HOT, postId: '9102', handle: 'cooling', velocity: 400, followers: 9e6 },
            { ...HOT, postId: '9103', handle: 'big_name', velocity: 2_000, followers: 80_000 },
          ],
        }),
      ),
    );
    const root = await renderHotView(vi.fn().mockResolvedValue([]));
    const toGlobal = [...root.querySelectorAll('button')].find((b) => b.textContent === '全站')!;
    await act(async () => {
      toGlobal.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const handles = () => [...root.querySelectorAll('.post-handle')].map((n) => n.textContent);
    // 流速不到 1000/h 的不显示
    expect(handles()).toEqual(['@big_heat', '@big_name']);
    // 「最近刷到」是你自己的滑动记录，全站没有
    expect(
      [...root.querySelectorAll('select.sort-select option')].map((node) => node.textContent),
    ).not.toContain('最近刷到');
    await chooseSort(root, 'followers');
    expect(handles()).toEqual(['@big_name', '@big_heat']);
  });

  it('shows both boards with ranks, new entries and climbers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          generated_at: Date.now(),
          window_hours: 2,
          posts: [
            { ...HOT, postId: '9201', handle: 'r_one', rank: 1, rankDelta: null, velocity: 30_000 },
            { ...HOT, postId: '9202', handle: 'r_two', rank: 2, rankDelta: 5, velocity: 20_000 },
            { ...HOT, postId: '9203', handle: 'r_three', rank: 4, rankDelta: 0, velocity: 9_000 },
          ],
          day: [
            { ...HOT, postId: '9301', handle: 'd_big', rank: 1, rankDelta: 0, velocity: 200 },
            { ...HOT, postId: '9302', handle: 'd_next', rank: 2, rankDelta: 1, velocity: 5_000 },
          ],
        }),
      ),
    );
    const root = await renderHotView(vi.fn().mockResolvedValue([]));
    const toGlobal = [...root.querySelectorAll('button')].find((b) => b.textContent === '全站')!;
    await act(async () => {
      toGlobal.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const options = [...root.querySelectorAll('select.sort-select option')].map(
      (n) => n.textContent,
    );
    expect(options.slice(0, 2)).toEqual(['飙升', '24 小时']);
    const ranks = () => [...root.querySelectorAll('.post-rank')].map((n) => n.textContent);
    // 名次用榜上的（已读隐藏的也占位）
    expect(ranks()).toEqual(['1', '2', '4']);
    expect(root.querySelector('.post-rank')?.classList.contains('is-top')).toBe(true);
    const trends = [...root.querySelectorAll('.rank-trend')].map((n) => n.textContent);
    expect(trends).toEqual(['新', '↑5']);

    // 「24 小时」榜：降温的大帖也在
    await chooseSort(root, 'day');
    const handles = [...root.querySelectorAll('.post-handle')].map((n) => n.textContent);
    expect(handles).toEqual(['@d_big', '@d_next']);
    expect(ranks()).toEqual(['1', '2']);
    expect(root.querySelector('.hot-view .help-icon')).not.toBeNull();
  });

  it('shows the last copy when the server cannot be reached, and refreshes on demand', async () => {
    stored.hotGlobalCacheV1 = {
      generated_at: Date.now() - 20 * 60_000,
      window_hours: 2,
      posts: [{ ...HOT, postId: '9401', handle: 'cached_one', rank: 1, velocity: 30_000 }],
      day: [],
    };
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);
    const root = await renderHotView(vi.fn().mockResolvedValue([]));
    const toGlobal = [...root.querySelectorAll('button')].find((b) => b.textContent === '全站')!;
    await act(async () => {
      toGlobal.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect([...root.querySelectorAll('.post-handle')].map((n) => n.textContent)).toEqual([
      '@cached_one',
    ]);
    expect(root.querySelector('.list-meta')?.classList.contains('is-stale')).toBe(true);

    fetchMock.mockImplementation(async () =>
      Response.json({
        generated_at: Date.now(),
        window_hours: 2,
        posts: [{ ...HOT, postId: '9402', handle: 'fresh_one', rank: 1, velocity: 30_000 }],
        day: [],
      }),
    );
    const refresh = root.querySelector<HTMLButtonElement>('.list-refresh')!;
    await act(async () => {
      refresh.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(fetchMock).toHaveBeenLastCalledWith(expect.stringMatching(/\/v1\/hot$/), {
      credentials: 'omit',
      cache: 'no-cache',
    });
    expect(root.querySelector('.list-meta')?.classList.contains('is-stale')).toBe(false);
    expect((stored.hotGlobalCacheV1 as { posts: Array<{ handle: string }> }).posts[0]?.handle).toBe(
      'fresh_one',
    );
  });

  it('shows a calm message when the global list is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const root = await renderHotView(vi.fn().mockResolvedValue([]));
    const toGlobal = [...root.querySelectorAll('button')].find((b) => b.textContent === '全站')!;
    await act(async () => {
      toGlobal.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(root.textContent).toContain('全站热榜暂时不可用');
  });
});

describe('asHotPostList', () => {
  it('drops malformed entries and clamps fields', () => {
    expect(
      asHotPostList([
        HOT,
        { ...HOT, postId: 'not-digits' },
        { ...HOT, handle: 'bad handle' },
        { ...HOT, postId: '2', tier: 11, views: -5, velocity: 'fast', displayName: '  ' },
        null,
      ]),
    ).toEqual([
      HOT,
      {
        postId: '2',
        handle: 'alice',
        avatarUrl: HOT.avatarUrl,
        verified: true,
        mediaUrl: HOT.mediaUrl,
        snippet: HOT.snippet,
        createdAt: HOT.createdAt,
        followers: 925,
        replies: 46,
        likes: 3_200,
        retweets: 410,
        bookmarks: 980,
        projected: 2_400_000,
        velocity: null,
        breakout: 196.8,
        tier: null,
        viral: 82,
        opportunity: HOT.opportunity,
      },
    ]);
    expect(
      asHotPostList([{ ...HOT, viral: 900, opportunity: { hoursLeft: 'x' } }])[0],
    ).toMatchObject({ viral: null, opportunity: null });
    // 图片只认 X 图床
    const evil = asHotPostList([
      { ...HOT, avatarUrl: 'https://evil.example/a.jpg', mediaUrl: 'javascript:alert(1)' },
    ])[0];
    expect(evil?.avatarUrl).toBeUndefined();
    expect(evil?.mediaUrl).toBeUndefined();
    expect(asHotPostList({ not: 'an array' })).toEqual([]);
  });
});

describe('page brief', () => {
  it('renders one line of three numbers above the list', async () => {
    const send = vi.fn(async (message: { type: string }) => {
      if (message.type === 'feedsieve:hot-brief') {
        return {
          seen: 86,
          authors: 41,
          hot: 7,
          medianVelocity: 312,
          topBreakout: { ratio: 196.8, handle: 'alice', postId: '1850000000000000001' },
          tiers: [9, 16, 10, 4, 1, 1, 0, 0, 0, 0],
        };
      }
      return [HOT];
    });
    const root = await renderHotView(send);
    const values = [...root.querySelectorAll('.brief-line dd')].map((node) => node.textContent);
    expect(values).toEqual(['86', '7', '312/h']);
    const labels = [...root.querySelectorAll('.brief-line dt')].map((node) => node.textContent);
    expect(labels).toEqual(['帖子', '正在升温', '中位流速']);
  });
});

describe('smoother reading', () => {
  const post = (id: string, extra: Record<string, unknown> = {}) => ({
    ...HOT,
    postId: id,
    handle: `user_${id.slice(-3)}`,
    ...extra,
  });
  const handles = (root: HTMLElement) =>
    [...root.querySelectorAll('.post-handle')].map((n) => n.textContent);

  it('shows when a post was seen in "just seen", with the post time on hover', async () => {
    const seenAt = Date.now() - 4 * 60_000;
    const root = await renderHotView(
      vi.fn(async (message: { type: string }) =>
        message.type === 'feedsieve:hot-posts' ? [post('1850000000000000401', { seenAt })] : null,
      ),
    );
    expect(root.querySelector('.post-meta')?.textContent).toBe('2小时');
    await chooseSort(root, 'recent');
    const meta = root.querySelector('.post-meta')!;
    expect(meta.textContent).toBe('4分钟前刷到');
    expect(meta.getAttribute('title')).toBe('发布于 2小时前');
    expect(meta.classList.contains('is-key')).toBe(true);
    // 按粉丝数排时，量级突出
    await chooseSort(root, 'followers');
    expect(root.querySelector('.tier-pill')?.classList.contains('is-key')).toBe(true);
  });

  it('never shows the old order under a new sort while it is loading', async () => {
    const heatOrder = [post('1850000000000000411'), post('1850000000000000412')];
    let release: () => void = () => {};
    const send = vi.fn(async (message: { type: string; sort?: string }) => {
      if (message.type !== 'feedsieve:hot-posts') return null;
      if (message.sort === 'followers') {
        await new Promise<void>((resolve) => (release = resolve));
        return [...heatOrder].reverse();
      }
      return heatOrder;
    });
    const root = await renderHotView(send);
    expect(handles(root)).toEqual(['@user_411', '@user_412']);
    await chooseSort(root, 'followers');
    // 新排序的数据还没回来：显示加载中，不拿热度顺序冒充
    expect(handles(root)).toEqual([]);
    await act(async () => {
      release();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(handles(root)).toEqual(['@user_412', '@user_411']);
  });

  it('tells the user where an opened post went', async () => {
    const send = vi.fn(async (message: { type: string }) =>
      message.type === 'feedsieve:scroll-to-post' ? { found: false } : [HOT],
    );
    const root = await renderHotView(send);
    await act(async () => {
      root.querySelector<HTMLAnchorElement>('.post')!.click();
    });
    expect(root.querySelector('.toast-notice')?.textContent).toBe('已在后台打开');
    // 自动消失
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1_600));
    });
    expect(root.querySelector('.toast-notice')).toBeNull();
  });

  it('hides a post or its author, with undo and a way back', async () => {
    const send = vi.fn(async (message: { type: string }) =>
      message.type === 'feedsieve:hot-posts'
        ? [
            post('1850000000000000421', { handle: 'noisy' }),
            post('1850000000000000422', { handle: 'noisy' }),
            post('1850000000000000423'),
          ]
        : null,
    );
    const root = await renderHotView(send);
    // 同作者两条收成一组
    expect(handles(root)).toEqual(['@noisy', '@user_423']);
    await act(async () => root.querySelector<HTMLButtonElement>('.post-dismiss')!.click());
    expect(handles(root)).toEqual(['@noisy', '@user_423']); // 组里下一条顶上
    expect(stored.hotDismissedV1).toEqual(['1850000000000000421']);
    const toastButtons = () => [...root.querySelectorAll<HTMLButtonElement>('.hot-toast button')];
    expect(toastButtons().map((b) => b.textContent)).toEqual(['撤销', '不看 @noisy']);
    // 顺手不看这个作者
    await act(async () => toastButtons()[1]!.click());
    expect(handles(root)).toEqual(['@user_423']);
    expect(stored.hotMutedV1).toEqual(['noisy']);
    // 撤销不看作者
    await act(async () => toastButtons()[0]!.click());
    expect(handles(root)).toEqual(['@noisy', '@user_423']);
    // 「已隐藏」开关：把隐藏的帖子显示回来，逐条恢复
    const chip = [...root.querySelectorAll<HTMLButtonElement>('.chip')].find((b) =>
      b.textContent?.startsWith('已隐藏'),
    )!;
    expect(chip.textContent).toBe('已隐藏1');
    await act(async () => chip.click());
    const restore = root.querySelector<HTMLButtonElement>('.post-dismiss.is-restore')!;
    expect(restore.getAttribute('aria-label')).toBe('恢复');
    await act(async () => restore.click());
    expect(stored.hotDismissedV1).toEqual([]);
  });

  it('folds several hot posts by one author into one row', async () => {
    const root = await renderHotView(
      vi.fn(async (message: { type: string }) =>
        message.type === 'feedsieve:hot-posts'
          ? [
              post('1850000000000000431', { handle: 'big', snippet: 'first' }),
              post('1850000000000000432'),
              post('1850000000000000433', { handle: 'big', snippet: 'second' }),
              post('1850000000000000434', { handle: 'big', snippet: 'third' }),
            ]
          : null,
      ),
    );
    expect(handles(root)).toEqual(['@big', '@user_432']);
    const more = root.querySelector<HTMLButtonElement>('.post-more')!;
    expect(more.textContent).toBe('还有 2 条 @big 的热帖');
    await act(async () => more.click());
    expect(handles(root)).toEqual(['@big', '@big', '@big', '@user_432']);
    expect(root.querySelector('.post-more')?.textContent).toBe('收起');
    expect(groupByAuthor([], new Set())).toEqual([]);
  });

  it('marks posts that are new since the popup was last opened', async () => {
    sessionStored.hotLastListV1 = { mine: ['1850000000000000441'], global: [] };
    const root = await renderHotView(
      vi.fn(async (message: { type: string }) =>
        message.type === 'feedsieve:hot-posts'
          ? [post('1850000000000000442'), post('1850000000000000441')]
          : null,
      ),
    );
    const fresh = [...root.querySelectorAll('.post.is-new .post-handle')].map((n) => n.textContent);
    expect(fresh).toEqual(['@user_442']);
    // 这次的列表记下来，下次打开再比
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 600));
    });
    expect(sessionStored.hotLastListV1).toEqual({
      mine: ['1850000000000000442', '1850000000000000441'],
      global: [],
    });
  });

  it('does not insert new posts while the keyboard is in the list', async () => {
    let current = [post('1850000000000000451')];
    const send = vi.fn(async (message: { type: string }) =>
      message.type === 'feedsieve:hot-posts' ? current : null,
    );
    const root = await renderHotView(send);
    await act(async () => root.querySelector<HTMLAnchorElement>('a.post')!.focus());
    current = [post('1850000000000000452'), post('1850000000000000451')];
    await act(async () => {
      for (const listener of runtimeListeners) listener({ type: 'feedsieve:insight-updated' });
      await new Promise((resolve) => setTimeout(resolve, 600));
    });
    expect(handles(root)).toEqual(['@user_451']);
    expect(root.querySelector('.new-posts-bar')?.textContent).toBe('有 1 条新热帖');
    // 读屏软件也会听到
    expect(root.querySelector('.sr-only[aria-live]')?.textContent).toBe('新增 1 条热帖');
  });

  it('moves with j / k, replies with r and hides with x', async () => {
    const root = await renderHotView(
      vi.fn(async (message: { type: string }) =>
        message.type === 'feedsieve:hot-posts'
          ? [post('1850000000000000461'), post('1850000000000000462'), post('1850000000000000463')]
          : null,
      ),
    );
    const press = async (key: string) =>
      act(async () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      });
    const focusedId = () => (document.activeElement as HTMLElement | null)?.dataset.postId;
    await press('j');
    expect(focusedId()).toBe('1850000000000000461');
    await press('j');
    await press('j');
    await press('k');
    expect(focusedId()).toBe('1850000000000000462');
    await press('r');
    expect(tabsCreate).toHaveBeenCalledWith({
      url: 'https://x.com/intent/post?in_reply_to=1850000000000000462',
      active: true,
    });
    await press('x');
    expect(stored.hotDismissedV1).toEqual(['1850000000000000462']);
    expect(handles(root)).toEqual(['@user_461', '@user_463']);
    expect(focusedId()).toBe('1850000000000000463');
  });

  it('remembers the scroll position of each sort', async () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      post(String(1850000000000000500n + BigInt(i))),
    );
    const container = document.createElement('div');
    container.className = 'popup-content';
    document.body.append(container);
    runtimeSend.mockImplementation(async (message: { type: string }) =>
      message.type === 'feedsieve:hot-posts' ? many : null,
    );
    const root = ReactDOM.createRoot(container);
    mountedRoots.push(root);
    await act(async () => {
      root.render(
        React.createElement(HotView, {
          language: 'zh' as const,
          sendToXPage: async () => null,
          onOpenSettings: vi.fn(),
        }),
      );
    });
    container.scrollTop = 640;
    await chooseSort(container, 'followers');
    expect(container.scrollTop).toBe(0);
    await chooseSort(container, 'heat');
    expect(container.scrollTop).toBe(640);
  }, 20_000);

  it('restores the scroll position after the view is unmounted', async () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      post(String(1850000000000000600n + BigInt(i))),
    );
    runtimeSend.mockImplementation(async (message: { type: string }) =>
      message.type === 'feedsieve:hot-posts' ? many : null,
    );
    async function mount(): Promise<{ container: HTMLDivElement; root: ReactDOM.Root }> {
      const container = document.createElement('div');
      container.className = 'popup-content';
      document.body.append(container);
      const root = ReactDOM.createRoot(container);
      mountedRoots.push(root);
      await act(async () => {
        root.render(
          React.createElement(HotView, {
            language: 'zh' as const,
            sendToXPage: async () => null,
            onOpenSettings: vi.fn(),
          }),
        );
      });
      return { container, root };
    }

    const first = await mount();
    first.container.scrollTop = 640;
    await act(async () => {
      first.container.dispatchEvent(new Event('scroll'));
    });
    // 立刻切走：此时 DOM 已经换掉、scrollTop 归零，保存要靠滚动时记下的值
    await act(async () => first.root.unmount());
    first.container.remove();

    const second = await mount();
    expect(second.container.scrollTop).toBe(640);
  }, 20_000);
});
