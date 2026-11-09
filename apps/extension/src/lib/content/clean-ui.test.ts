// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_UI_SETTINGS, type UiSettings } from '../settings/ui-settings';
import {
  createCleanUi,
  isFollowingTab,
  isForYouTab,
  isPromoteButton,
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

/**
 * 界面净化全部打开：扫描类用例的基线。
 * 线上默认值是全部关闭（用户不勾选就不该有东西消失），这里显式打开来测各净化逻辑。
 */
const UI_ALL_ON: UiSettings = {
  ...DEFAULT_UI_SETTINGS,
  cleanUi: true,
  hideForYou: true,
  hideTrends: true,
  hideWhoToFollow: true,
  hidePromoted: true,
  hidePromoteButton: true,
  hideGrok: true,
  dimPremiumReplies: true,
  systemFont: true,
};

/** 模拟设置已读完：界面净化全部打开（真实用户逐项勾选后的状态），并返回 storage 变更监听器。 */
function stubBrowser(
  overrides: Partial<UiSettings> = {},
): Array<(changes: Record<string, unknown>, area: string) => void> {
  const listeners: Array<(changes: Record<string, unknown>, area: string) => void> = [];
  vi.stubGlobal('browser', {
    storage: {
      local: {
        get: vi.fn(async () => ({
          uiSettingsV1: { ...UI_ALL_ON, v: 2, ...overrides },
        })),
        set: vi.fn(async () => undefined),
      },
      onChanged: {
        addListener: (fn: (typeof listeners)[number]) => listeners.push(fn),
        removeListener: vi.fn(),
      },
    },
  });
  return listeners;
}

/** 通过 storage.onChanged 把一份新设置推给页面，模拟用户在设置页改开关。 */
function pushSettings(
  listeners: Array<(changes: Record<string, unknown>, area: string) => void>,
  settings: Partial<UiSettings>,
): void {
  for (const listener of listeners) {
    listener({ uiSettingsV1: { newValue: { ...UI_ALL_ON, v: 2, ...settings } } }, 'local');
  }
}

/**
 * 可控的 MutationObserver 替身：记录 observe/disconnect 次数，并能手动喂一次 mutation。
 * clean-ui 的观察器行为（何时挂、何时断）在 happy-dom 里没法从外部断言，只能这样测。
 */
function fakeObserverClass() {
  class FakeMutationObserver {
    static all: FakeMutationObserver[] = [];
    observe = vi.fn();
    disconnect = vi.fn();
    takeRecords = vi.fn((): MutationRecord[] => []);
    constructor(readonly callback: MutationCallback) {
      FakeMutationObserver.all.push(this);
    }
  }
  return FakeMutationObserver;
}

function tab(text: string): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('role', 'tab');
  el.textContent = text;
  return el;
}

/** 按 X 的真实结构拼一条推文：作者名一行 + 元信息行（标签 / 时间 / 状态链接）+ 正文。 */
function tweet(options: {
  name?: string;
  text?: string;
  meta?: string;
  media?: boolean;
  verified?: boolean;
  /** 本推文的状态链接 id；详情页里主帖就是 URL 里那个 id 的那一条 */
  statusId?: string;
}): HTMLElement {
  const el = document.createElement('article');
  el.setAttribute('data-testid', 'tweet');
  const header = document.createElement('div');
  const name = document.createElement('div');
  name.setAttribute('data-testid', 'User-Name');
  name.innerHTML = `<a href="/someone"><span>${options.name ?? 'someone'}</span></a>`;
  if (options.verified) {
    name.insertAdjacentHTML('beforeend', '<span data-testid="icon-verified"></span>');
  }
  const meta = document.createElement('div');
  const stamp = options.statusId
    ? `<a href="/someone/status/${options.statusId}"><time datetime="2026-11-06T00:00:00.000Z">1小时</time></a>`
    : `<span>${options.meta ?? '· 1小时'}</span>`;
  meta.innerHTML = `<div>${stamp}</div>`;
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

/** X 给作者本人看的「推广」按钮：没有 data-testid / aria-label，只有 button 里的一行文案。 */
function promoteButton(label = '推广'): HTMLButtonElement {
  const button = document.createElement('button');
  button.setAttribute('role', 'button');
  button.innerHTML = `<div><span><span>${label}</span></span></div>`;
  return button;
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

  it('只淡化评论区里蓝标作者的短回复，主帖和非推文 article 不动', () => {
    const short = tweet({ text: '同意', verified: true });
    const long = tweet({ text: '这是一条足够长的正常回复，用来验证不会被误伤', verified: true });
    const unverified = tweet({ text: '同意', verified: false });
    expect(isThinPremiumReply(short, null)).toBe(true);
    expect(isThinPremiumReply(long, null)).toBe(false);
    expect(isThinPremiumReply(unverified, null)).toBe(false);
    const border = 'x'.repeat(PREMIUM_REPLY_MAX_CHARS);
    expect(isThinPremiumReply(tweet({ text: border, verified: true }), null)).toBe(false);
    // 主帖（状态链接 id 等于 URL 里的 status id）绝不淡化：它是用户点进来的那条
    expect(
      isThinPremiumReply(tweet({ text: '同意', verified: true, statusId: '111' }), '111'),
    ).toBe(false);
    // 页面里不是推文的 <article>（长文卡片、模块容器）不淡化
    const notTweet = tweet({ text: '同意', verified: true });
    notTweet.removeAttribute('data-testid');
    expect(isThinPremiumReply(notTweet, null)).toBe(false);
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

  it('认出帖子右上角的「推广」按钮，正文、菜单里的同名文字不算', () => {
    expect(isPromoteButton(promoteButton('推广'))).toBe(true);
    expect(isPromoteButton(promoteButton('Promote'))).toBe(true);
    // 正文里的「推广」是用户写的内容
    const article = tweet({ text: '推广' });
    expect(isPromoteButton(article.querySelector('[data-testid="tweetText"]')!)).toBe(false);
    // 下拉菜单里的同名按钮是 X 的操作项，不是帖子上的推广入口
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    menu.append(promoteButton('推广'));
    expect(isPromoteButton(menu.querySelector('button')!)).toBe(false);
    // 不是按钮的同名文字（比如推广帖的标签）
    const label = document.createElement('span');
    label.textContent = '推广';
    expect(isPromoteButton(label)).toBe(false);
  });

  it('隐藏「推广」按钮只标记按钮本身，菜单里的同名项不动', async () => {
    vi.useFakeTimers();
    stubBrowser();
    window.history.pushState({}, '', '/someone/status/2119635077470777768');
    const article = tweet({ text: '一条正常的帖子', statusId: '2119635077470777768' });
    const promote = promoteButton();
    article.querySelector('[data-testid="User-Name"]')!.after(promote);
    article.insertAdjacentHTML('beforeend', '<div role="menu"></div>');
    article.querySelector('[role="menu"]')!.append(promoteButton());
    document.body.append(article);
    const clean = createCleanUi();
    clean.start();
    try {
      await vi.advanceTimersByTimeAsync(2_000);
      expect(promote.getAttribute('data-fs-clean')).toBe('promote-btn');
      const menuButton = article.querySelector('[role="menu"] button')!;
      expect(menuButton.hasAttribute('data-fs-clean')).toBe(false);
      expect(document.documentElement.hasAttribute('data-fs-clean-promote-btn')).toBe(true);
      const css = document.getElementById('feedsieve-clean-ui-styles')?.textContent ?? '';
      expect(css).toContain('[data-fs-clean="promote-btn"]');
    } finally {
      clean.stop();
    }
  });

  it('关掉隐藏「推广」按钮后不再标记，页面属性也不留', async () => {
    vi.useFakeTimers();
    stubBrowser({ hidePromoteButton: false });
    const article = tweet({ text: '一条正常的帖子' });
    const promote = promoteButton();
    article.querySelector('[data-testid="User-Name"]')!.after(promote);
    document.body.append(article);
    const clean = createCleanUi();
    clean.start();
    try {
      await vi.advanceTimersByTimeAsync(2_000);
      expect(promote.hasAttribute('data-fs-clean')).toBe(false);
      expect(document.documentElement.hasAttribute('data-fs-clean-promote-btn')).toBe(false);
    } finally {
      clean.stop();
    }
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

  it('淡化纯回复：主帖按 URL 的 status id 认，不靠第一条 article', async () => {
    vi.useFakeTimers();
    stubBrowser();
    window.history.pushState({}, '', '/someone/status/111');
    // 详情页第一条不是主帖：老实现按 index===0 跳过第一条，反而把第二条真正的
    // 主帖当回复压暗（用户点进来的原帖变灰）
    const pinned = tweet({ text: '一条置顶的普通推文' });
    const focal = tweet({ text: '同意', verified: true, statusId: '111' });
    const reply = tweet({ text: '同意', verified: true, statusId: '222' });
    document.body.append(pinned, focal, reply);
    const clean = createCleanUi();
    clean.start();
    try {
      await vi.advanceTimersByTimeAsync(2_000);
      expect(focal.hasAttribute('data-fs-clean')).toBe(false);
      // 回复认自己的状态链接 id，不靠 DOM 顺序
      expect(reply.getAttribute('data-fs-clean')).toBe('premium');
      expect(pinned.hasAttribute('data-fs-clean')).toBe(false);
      // CSS 也限定在推文 article 上，页面里别的 <article> 不该被压暗
      const css = document.getElementById('feedsieve-clean-ui-styles')?.textContent ?? '';
      expect(css).toContain('article[data-testid="tweet"][data-fs-clean="premium"]');
      expect(css).not.toContain('article[data-fs-clean="premium"]');
    } finally {
      clean.stop();
    }
  });

  it('淡化纯回复：认不出主帖时整页不淡化，不用索引猜', async () => {
    vi.useFakeTimers();
    stubBrowser();
    window.history.pushState({}, '', '/someone/status/111');
    // 两条都没有状态链接（占位/渲染失败等），无法确认哪条是主帖：
    // 老实现会把第二条当回复压暗；新实现宁可不生效，也不能误伤主帖
    const first = tweet({ text: '同意', verified: true });
    const second = tweet({ text: '同意', verified: true });
    document.body.append(first, second);
    const clean = createCleanUi();
    clean.start();
    try {
      await vi.advanceTimersByTimeAsync(2_000);
      expect(first.hasAttribute('data-fs-clean')).toBe(false);
      expect(second.hasAttribute('data-fs-clean')).toBe(false);
    } finally {
      clean.stop();
    }
  });

  it('Grok 只藏左侧导航入口，推文/菜单里同 href 的链接不动', async () => {
    vi.useFakeTimers();
    stubBrowser();
    document.body.innerHTML = `
      <header><nav><a id="nav-grok" href="/i/grok">Grok</a></nav></header>
      <article data-testid="tweet">
        <div data-testid="User-Name"><a href="/someone"><span>someone</span></a></div>
        <div data-testid="tweetText"><a id="tweet-grok" href="/i/grok">/i/grok</a></div>
      </article>
      <div role="menu" data-testid="Dropdown"><a id="menu-grok" href="/i/grok">Grok</a></div>`;
    const clean = createCleanUi();
    clean.start();
    try {
      await vi.advanceTimersByTimeAsync(2_000);
      expect(document.querySelector('#nav-grok')!.getAttribute('data-fs-clean')).toBe('grok');
      // 用户内容里指向同一路径的链接是正文，不是导航入口
      expect(document.querySelector('#tweet-grok')!.hasAttribute('data-fs-clean')).toBe(false);
      expect(document.querySelector('#menu-grok')!.hasAttribute('data-fs-clean')).toBe(false);
    } finally {
      clean.stop();
    }
  });

  it('隐藏 Grok 也藏帖子头部的 Grok 操作按钮，正文和菜单里的同名内容不动', async () => {
    vi.useFakeTimers();
    stubBrowser();
    const article = tweet({ text: '一条正常的帖子' });
    article
      .querySelector('[data-testid="User-Name"]')!
      .insertAdjacentHTML(
        'afterend',
        '<button id="grok-btn" aria-label="Grok 操作"><svg></svg></button>' +
          '<button id="grok-btn-en" aria-label="Grok actions"><svg></svg></button>',
      );
    article.insertAdjacentHTML(
      'beforeend',
      '<div role="menu"><button id="menu-grok-btn" aria-label="Grok 操作"></button></div>',
    );
    document.body.append(article);
    const clean = createCleanUi();
    clean.start();
    try {
      await vi.advanceTimersByTimeAsync(2_000);
      // 帖子头部的 Grok 按钮按 aria-label 认（中英文界面都覆盖），和导航入口同一个标记
      expect(document.querySelector('#grok-btn')!.getAttribute('data-fs-clean')).toBe('grok');
      expect(document.querySelector('#grok-btn-en')!.getAttribute('data-fs-clean')).toBe('grok');
      // 下拉菜单里的同名按钮是操作菜单，不跟着藏
      expect(document.querySelector('#menu-grok-btn')!.hasAttribute('data-fs-clean')).toBe(false);
    } finally {
      clean.stop();
    }
  });

  it('界面净化关着时不观察 DOM；打开才 observe，关掉和 stop 后 disconnect', async () => {
    vi.useFakeTimers();
    const FakeObserver = fakeObserverClass();
    vi.stubGlobal('MutationObserver', FakeObserver);
    const listeners = stubBrowser({ cleanUi: false });
    document.body.innerHTML = '<nav><a id="grok" href="/i/grok">Grok</a></nav>';
    const clean = createCleanUi();
    clean.start();
    try {
      await vi.advanceTimersByTimeAsync(2_000);
      // 总开关关闭：不该常驻监听整页，也不该改页面
      expect(FakeObserver.all).toHaveLength(0);
      expect(document.getElementById('feedsieve-clean-ui-styles')).toBeNull();
      expect(document.querySelector('#grok')!.hasAttribute('data-fs-clean')).toBe(false);

      // 用户打开总开关：立刻开始观察并跑一轮
      pushSettings(listeners, { cleanUi: true });
      await vi.advanceTimersByTimeAsync(500);
      expect(FakeObserver.all).toHaveLength(1);
      const observer = FakeObserver.all[0]!;
      expect(observer.observe).toHaveBeenCalledTimes(1);
      expect(document.querySelector('#grok')!.getAttribute('data-fs-clean')).toBe('grok');

      // 再关掉：立刻断开，观察器不会继续吃 X 的 mutation
      pushSettings(listeners, { cleanUi: false });
      await vi.advanceTimersByTimeAsync(500);
      expect(observer.disconnect).toHaveBeenCalledTimes(1);
      expect(document.querySelector('#grok')!.hasAttribute('data-fs-clean')).toBe(false);
      expect(FakeObserver.all).toHaveLength(1);

      // 再打开：同一个观察器重新挂上
      pushSettings(listeners, { cleanUi: true });
      await vi.advanceTimersByTimeAsync(500);
      expect(observer.observe).toHaveBeenCalledTimes(2);

      clean.stop();
      expect(observer.disconnect).toHaveBeenCalledTimes(2);
      // stop 之后迟到的设置不能把观察器又挂回去
      pushSettings(listeners, { cleanUi: true });
      await vi.advanceTimersByTimeAsync(500);
      expect(observer.observe).toHaveBeenCalledTimes(2);
      expect(document.getElementById('feedsieve-clean-ui-styles')).toBeNull();
    } finally {
      clean.stop();
    }
  });

  it('DOM 一直在变时扫描也按固定节奏跑，不会被无限顺延', async () => {
    vi.useFakeTimers();
    const FakeObserver = fakeObserverClass();
    vi.stubGlobal('MutationObserver', FakeObserver);
    stubBrowser();
    const clean = createCleanUi();
    clean.start();
    try {
      await vi.advanceTimersByTimeAsync(2_000);
      const observer = FakeObserver.all[0]!;
      expect(observer.observe).toHaveBeenCalledTimes(1);
      // 先删掉样式，用「下一轮扫描是否重建」来判断 scan 有没有执行
      document.getElementById('feedsieve-clean-ui-styles')!.remove();

      // 模拟 X 播放视频 / 输入：每 100ms 一次 DOM 变化。老实现每次都重置 400ms
      // 定时器，scan 永远等不到；新实现第一轮 400ms 一到就跑
      for (let i = 0; i < 8; i += 1) {
        observer.callback([], observer as unknown as MutationObserver);
        await vi.advanceTimersByTimeAsync(100);
        if (i === 3) {
          expect(document.getElementById('feedsieve-clean-ui-styles')).toBeTruthy();
        }
      }
      expect(document.getElementById('feedsieve-clean-ui-styles')).toBeTruthy();
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
            uiSettingsV1: { ...UI_ALL_ON, v: 2 },
          })),
          set: vi.fn(async () => undefined),
        },
        onChanged: {
          addListener: (fn: (typeof listeners)[number]) => listeners.push(fn),
          removeListener: vi.fn(),
        },
      },
    });
    document.body.innerHTML = '<nav><a href="/i/grok">Grok</a></nav>';
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
      listener({ uiSettingsV1: { newValue: { ...UI_ALL_ON, v: 2 } } }, 'local');
    }
    await vi.advanceTimersByTimeAsync(2_000);
    expect(document.getElementById('feedsieve-clean-ui-styles')).toBeNull();
    expect(document.querySelector('a')?.hasAttribute('data-fs-clean')).toBe(false);
  });
});
