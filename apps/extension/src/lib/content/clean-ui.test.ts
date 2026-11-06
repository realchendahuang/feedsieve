// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_UI_SETTINGS } from '../settings/ui-settings';
import {
  createCleanUi,
  isFollowingTab,
  isForYouTab,
  isPromotedArticle,
  isThinPremiumReply,
  isWhoToFollowHeading,
  moduleRoot,
  PREMIUM_REPLY_MAX_CHARS,
  whoToFollowCard,
} from './clean-ui';

afterEach(() => {
  document.body.innerHTML = '';
  window.history.replaceState({}, '', '/');
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** 模拟设置已就绪：界面净化打开，其余用默认值（含隐藏付费推广）。 */
function stubBrowser(): void {
  vi.stubGlobal('browser', {
    storage: {
      local: {
        get: vi.fn(async () => ({ uiSettingsV1: { ...DEFAULT_UI_SETTINGS, cleanUi: true } })),
        set: vi.fn(async () => undefined),
      },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  });
}

function tab(text: string): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('role', 'tab');
  el.textContent = text;
  return el;
}

function article(options: { text: string; verified: boolean }): HTMLElement {
  const el = document.createElement('article');
  const name = document.createElement('div');
  name.setAttribute('data-testid', 'User-Name');
  name.textContent = 'someone';
  if (options.verified) {
    const icon = document.createElement('span');
    icon.setAttribute('data-testid', 'icon-verified');
    name.appendChild(icon);
  }
  const text = document.createElement('div');
  text.setAttribute('data-testid', 'tweetText');
  text.textContent = options.text;
  el.append(name, text);
  return el;
}

/** 按 X 的真实结构拼一条推文：作者名一行 + 元信息行（标签 / 时间）+ 正文。 */
function tweet(options: { name?: string; text?: string; meta?: string; media?: boolean }): HTMLElement {
  const el = document.createElement('article');
  const header = document.createElement('div');
  const name = document.createElement('div');
  name.setAttribute('data-testid', 'User-Name');
  name.innerHTML = `<a href="/someone"><span>${options.name ?? 'someone'}</span></a>`;
  const meta = document.createElement('div');
  meta.innerHTML = `<div><span>${options.meta ?? '· 1小时'}</span></div>`;
  header.append(name, meta);
  const text = document.createElement('div');
  text.setAttribute('data-testid', 'tweetText');
  text.textContent = options.text ?? '一条正常的帖子';
  el.append(header, text);
  if (options.media) {
    el.insertAdjacentHTML(
      'beforeend',
      '<div data-testid="tweetPhoto"><div data-testid="placementTracking"><div data-testid="videoPlayer"><video></video></div></div></div>',
    );
  }
  return el;
}

describe('clean-ui 选择器', () => {
  it('认出首页的「为你推荐」和「正在关注」标签', () => {
    expect(isForYouTab(tab('为你推荐'))).toBe(true);
    expect(isForYouTab(tab('For you'))).toBe(true);
    expect(isForYouTab(tab('正在关注'))).toBe(false);
    expect(isFollowingTab(tab('正在关注'))).toBe(true);
    expect(isFollowingTab(tab('Following'))).toBe(true);
    expect(isFollowingTab(tab('AI'))).toBe(false);
    expect(isForYouTab(document.createElement('div'))).toBe(false);
  });

  it('认出「推荐关注」标题（中英）', () => {
    expect(isWhoToFollowHeading(tab('推荐关注'))).toBe(true);
    expect(isWhoToFollowHeading(tab('Who to follow'))).toBe(true);
    expect(isWhoToFollowHeading(tab('X 上的直播'))).toBe(false);
  });

  it('上溯到侧栏模块根，而不是整个侧栏', () => {
    document.body.innerHTML = `
      <div data-testid="sidebarColumn">
        <div id="module-a"><div><span data-testid="trend">趋势</span></div></div>
        <div id="module-b"><div>别的模块</div></div>
      </div>`;
    const trend = document.querySelector('[data-testid="trend"]')!;
    expect(moduleRoot(trend)?.id).toBe('module-a');
    expect(moduleRoot(document.body)).toBeNull();
  });

  it('推荐关注只隐藏自己的卡片，不连坐前面的模块', () => {
    document.body.innerHTML = `
      <div data-testid="sidebarColumn">
        <div id="wrap">
          <div id="nfl"><h2 role="heading">NFL</h2><span>Browns</span></div>
          <div id="card"><h2 role="heading">推荐关注</h2><span>Qwas</span></div>
        </div>
      </div>`;
    const heading = document.querySelector('#card h2')!;
    expect(whoToFollowCard(heading)?.id).toBe('card');
  });

  it('推荐关注卡片不把侧栏包裹层当成自己：跨到搜索框或别的模块就停', () => {
    document.body.innerHTML = `
      <div data-testid="sidebarColumn">
        <div id="wrap">
          <form role="search"><input placeholder="搜索"></form>
          <div id="card"><h2 role="heading">推荐关注</h2><span>Qwas</span></div>
        </div>
      </div>`;
    const heading = document.querySelector('#card h2')!;
    expect(whoToFollowCard(heading)?.id).toBe('card');
  });

  it('「为你推荐」当前选中时不隐藏，先切到「正在关注」', async () => {
    vi.useFakeTimers();
    stubBrowser();
    document.body.innerHTML = `
      <div role="tablist">
        <div role="tab" id="foryou" aria-selected="true">为你推荐</div>
        <div role="tab" id="following" aria-selected="false">正在关注</div>
      </div>`;
    const clicked = vi.fn();
    document.querySelector('#following')!.addEventListener('click', clicked);
    const clean = createCleanUi();
    clean.start();
    try {
      await vi.advanceTimersByTimeAsync(2_000);
      expect(document.querySelector('#foryou')!.hasAttribute('data-fs-clean')).toBe(false);
      expect(clicked).toHaveBeenCalledTimes(1);
    } finally {
      clean.stop();
    }
  });

  it('「为你推荐」没被选中时照常隐藏', async () => {
    vi.useFakeTimers();
    stubBrowser();
    document.body.innerHTML = `
      <div role="tablist">
        <div role="tab" id="foryou" aria-selected="false">为你推荐</div>
        <div role="tab" id="following" aria-selected="true">正在关注</div>
      </div>`;
    const clean = createCleanUi();
    clean.start();
    try {
      await vi.advanceTimersByTimeAsync(2_000);
      expect(document.querySelector('#foryou')!.getAttribute('data-fs-clean')).toBe('foryou');
    } finally {
      clean.stop();
    }
  });

  it('只淡化评论区里蓝标作者的短回复', () => {
    const short = article({ text: '同意', verified: true });
    const long = article({ text: '这是一条足够长的正常回复，用来验证不会被误伤', verified: true });
    const unverified = article({ text: '同意', verified: false });
    expect(isThinPremiumReply(short, 1)).toBe(true);
    expect(isThinPremiumReply(short, 0)).toBe(false);
    expect(isThinPremiumReply(long, 1)).toBe(false);
    expect(isThinPremiumReply(unverified, 1)).toBe(false);
    const border = 'x'.repeat(PREMIUM_REPLY_MAX_CHARS);
    expect(isThinPremiumReply(article({ text: border, verified: true }), 1)).toBe(false);
  });

  it('只认推文头部的「推广」标签，昵称、正文、话题里的同名文字不算', () => {
    expect(isPromotedArticle(tweet({ meta: '推广' }))).toBe(true);
    expect(isPromotedArticle(tweet({ meta: 'Promoted' }))).toBe(true);
    expect(isPromotedArticle(tweet({ name: '推广' }))).toBe(false);
    expect(isPromotedArticle(tweet({ text: '推广' }))).toBe(false);
    const withTag = tweet({});
    withTag.querySelector('[data-testid="tweetText"]')!.innerHTML =
      '<a href="/hashtag/%E6%8E%A8%E5%B9%BF"><span>#推广</span></a>';
    expect(isPromotedArticle(withTag)).toBe(false);
    // 普通视频帖：X 一样用 placementTracking 包播放器，不能当成推广帖
    expect(isPromotedArticle(tweet({ media: true }))).toBe(false);
    // 下拉菜单里的「推广」是 X 的操作文案，不是这条帖子的推广标签
    const withMenu = tweet({});
    withMenu.insertAdjacentHTML('beforeend', '<div role="menu"><div><span>推广</span></div></div>');
    expect(isPromotedArticle(withMenu)).toBe(false);
    expect(isPromotedArticle(document.createElement('article'))).toBe(false);
  });

  it('隐藏付费推广只藏整条推广帖，不碰视频/GIF 的容器标记', async () => {
    vi.useFakeTimers();
    stubBrowser();
    const ad = tweet({ meta: '推广' });
    const video = tweet({ media: true });
    document.body.append(ad, video);
    const clean = createCleanUi();
    clean.start();
    try {
      await vi.advanceTimersByTimeAsync(2_000);
      const css = document.getElementById('feedsieve-clean-ui-styles')?.textContent ?? '';
      expect(css).toContain('article[data-fs-clean="promoted"]');
      expect(css).not.toContain('[data-testid="placementTracking"]');
      expect(ad.getAttribute('data-fs-clean')).toBe('promoted');
      expect(video.hasAttribute('data-fs-clean')).toBe(false);
    } finally {
      clean.stop();
    }
  });

  it('趋势只藏右侧栏模块，探索页主栏的同一套结构不动', async () => {
    vi.useFakeTimers();
    stubBrowser();
    document.body.innerHTML = `
      <div data-testid="primaryColumn">
        <section role="region" id="explore"><div data-testid="trend">主栏趋势</div></section>
      </div>
      <div data-testid="sidebarColumn">
        <section role="region" id="side"><div data-testid="trend">侧栏趋势</div></section>
      </div>`;
    const clean = createCleanUi();
    clean.start();
    try {
      await vi.advanceTimersByTimeAsync(2_000);
      expect(document.querySelector('#side')!.getAttribute('data-fs-clean')).toBe('trends');
      expect(
        document.querySelector('[data-testid="primaryColumn"] section')!.hasAttribute('data-fs-clean'),
      ).toBe(false);
    } finally {
      clean.stop();
    }
  });

  it('详情页的主帖即使是推广帖也不藏，只藏时间线里的推广帖', async () => {
    vi.useFakeTimers();
    stubBrowser();
    window.history.pushState({}, '', '/someone/status/2118366625804202080');
    const focal = tweet({ meta: '推广' });
    const promotedReply = tweet({ meta: '推广' });
    document.body.append(focal, promotedReply);
    const clean = createCleanUi();
    clean.start();
    try {
      await vi.advanceTimersByTimeAsync(2_000);
      expect(focal.hasAttribute('data-fs-clean')).toBe(false);
      expect(promotedReply.getAttribute('data-fs-clean')).toBe('promoted');
    } finally {
      clean.stop();
    }
  });

  it('stop 之后清干净，迟到的设置不会再改页面', async () => {
    vi.useFakeTimers();
    const listeners: Array<(changes: Record<string, unknown>, area: string) => void> = [];
    vi.stubGlobal('browser', {
      storage: {
        local: {
          get: vi.fn(async () => ({
            uiSettingsV1: { ...DEFAULT_UI_SETTINGS, cleanUi: true },
          })),
          set: vi.fn(async () => undefined),
        },
        onChanged: {
          addListener: (fn: (typeof listeners)[number]) => listeners.push(fn),
          removeListener: vi.fn(),
        },
      },
    });
    document.body.innerHTML = '<a href="/i/grok">Grok</a>';
    const clean = createCleanUi();
    clean.start();
    // 让设置读完、首屏补扫跑完
    await vi.advanceTimersByTimeAsync(2_000);
    expect(document.getElementById('feedsieve-clean-ui-styles')).toBeTruthy();
    expect(document.querySelector('a')?.getAttribute('data-fs-clean')).toBe('grok');

    clean.stop();
    expect(document.getElementById('feedsieve-clean-ui-styles')).toBeNull();
    expect(document.querySelector('a')?.hasAttribute('data-fs-clean')).toBe(false);
    expect(document.documentElement.hasAttribute('data-fs-clean-grok')).toBe(false);

    // stop 之后才送达的 storage 变化（比如读设置有延迟）不能再把页面改回去
    for (const listener of listeners) {
      listener({ uiSettingsV1: { newValue: { ...DEFAULT_UI_SETTINGS, cleanUi: true } } }, 'local');
    }
    await vi.advanceTimersByTimeAsync(2_000);
    expect(document.getElementById('feedsieve-clean-ui-styles')).toBeNull();
    expect(document.querySelector('a')?.hasAttribute('data-fs-clean')).toBe(false);
  });
});
