// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createShareMenu, isShareButton, SHARE_ITEM_ATTRIBUTE } from './share-menu';
import { scrollToPost } from './locate';
import { REDESIGN_TWEET_HTML } from '../../../../../fixtures/x/timeline/redesign';

describe('redesign action classification', () => {
  it('recognizes only share, not like/repost/bookmark or analytics, without testids', () => {
    document.body.innerHTML = REDESIGN_TWEET_HTML;
    const article = document.querySelector('article')!;
    for (const button of article.querySelectorAll('[role="group"] button, [role="group"] a')) {
      expect(isShareButton(button)).toBe(button.getAttribute('data-engagement-action') === 'share');
    }
    document.body.replaceChildren();
  });
});

// 结构仿 2026-10-30 真机：动作栏里分享按钮没有 data-testid；菜单是 Dropdown 里的 menuitem
function renderTweet(handle: string, postId: string): HTMLElement {
  const cell = document.createElement('div');
  cell.setAttribute('data-testid', 'cellInnerDiv');
  cell.innerHTML = `
    <article data-testid="tweet">
      <div data-testid="User-Name"><a href="/${handle}">Name ${handle}</a></div>
      <a href="/${handle}/status/${postId}"><time datetime="2026-10-29T15:04:00.000Z">1h</time></a>
      <div data-testid="tweetText">text of ${postId}</div>
      <div role="group">
        <button data-testid="reply"></button>
        <button data-testid="like"></button>
        <button aria-label="分享帖子" class="share"></button>
      </div>
    </article>`;
  document.body.appendChild(cell);
  return cell.querySelector('article')!;
}

function renderMenu(): HTMLElement {
  const menu = document.createElement('div');
  menu.setAttribute('role', 'menu');
  menu.innerHTML = `
    <div data-testid="Dropdown">
      <div role="menuitem" class="x-item"><div><svg><path d="native"></path></svg></div>
        <div><span><span>复制链接</span></span></div></div>
    </div>`;
  document.body.appendChild(menu);
  return menu.querySelector('[data-testid="Dropdown"]')!;
}

describe('isShareButton', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('accepts only the action-bar button without a known test id', () => {
    const article = renderTweet('alice', '1');
    expect(isShareButton(article.querySelector('.share')!)).toBe(true);
    expect(isShareButton(article.querySelector('[data-testid="like"]')!)).toBe(false);
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    expect(isShareButton(outside)).toBe(false);
  });

  it('不把自己注入的动作按钮当成分享按钮', () => {
    const article = renderTweet('alice', '1');
    const group = article.querySelector('[role="group"]')!;
    // AI 检测格子：外层带 data-fs-action，克隆出来的按钮本身也可能就带这个属性
    const ai = document.createElement('button');
    ai.setAttribute('data-fs-action', 'ai');
    group.appendChild(ai);
    // 手动拉黑按钮
    const manual = document.createElement('button');
    manual.setAttribute('data-fs-manual-action', 'true');
    manual.setAttribute('data-fs-action', 'block');
    group.appendChild(manual);
    // 热帖速度胶囊
    const velocity = document.createElement('div');
    velocity.className = 'fs-velocity';
    group.appendChild(velocity);

    expect(isShareButton(ai)).toBe(false);
    expect(isShareButton(manual)).toBe(false);
    expect(isShareButton(velocity)).toBe(false);
    // 原生分享按钮仍然认得出来（回归：别一起排除了）
    expect(isShareButton(article.querySelector('.share')!)).toBe(true);
  });
});

describe('createShareMenu', () => {
  let writeText: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    document.body.innerHTML = '';
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('injects a Markdown item that reuses the native item and copies the tweet', async () => {
    const article = renderTweet('alice', '111');
    const dropdown = renderMenu();
    const menu = createShareMenu({ getLanguage: () => 'zh' });
    menu.inject(dropdown, article);
    menu.inject(dropdown, article); // 幂等

    const items = dropdown.querySelectorAll(`[${SHARE_ITEM_ATTRIBUTE}]`);
    expect(items).toHaveLength(1); // 不是详情页：没有「复制推文与评论」
    const item = items[0] as HTMLElement;
    expect(item.className).toBe('x-item');
    expect(item.textContent?.trim()).toBe('复制为 Markdown');
    expect(item.querySelector('path')?.getAttribute('d')).not.toBe('native');
    expect(dropdown.firstElementChild).toBe(item);

    item.click();
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining('text of 111\n\n[原帖](https://x.com/alice/status/111)'),
    );
  });

  it('点击我们的菜单项只撤掉自己插入的项，不合成 Escape 去关 X 的其它浮层', async () => {
    const article = renderTweet('alice', '111');
    const dropdown = renderMenu();
    const menu = createShareMenu({ getLanguage: () => 'zh' });
    menu.inject(dropdown, article);
    const onKeyDown = vi.fn();
    document.addEventListener('keydown', onKeyDown);
    try {
      dropdown.querySelector<HTMLElement>(`[${SHARE_ITEM_ATTRIBUTE}]`)!.click();
      await Promise.resolve();
      expect(onKeyDown).not.toHaveBeenCalled();
      expect(dropdown.querySelector(`[${SHARE_ITEM_ATTRIBUTE}]`)).toBeNull();
      // X 自己的原生项还在，菜单不会被我们弄坏
      expect(dropdown.querySelector('[role="menuitem"]')).not.toBeNull();
    } finally {
      document.removeEventListener('keydown', onKeyDown);
    }
  });

  it('adds the thread item on the focal tweet and includes replies below it', async () => {
    history.replaceState(null, '', '/alice/status/111');
    const main = renderTweet('alice', '111');
    renderTweet('bob', '222');
    const dropdown = renderMenu();
    createShareMenu({ getLanguage: () => 'zh' }).inject(dropdown, main);
    const items = dropdown.querySelectorAll<HTMLElement>(`[${SHARE_ITEM_ATTRIBUTE}]`);
    expect(items).toHaveLength(2);
    items[1]!.click();
    await Promise.resolve();
    expect(writeText.mock.calls[0]![0]).toContain('## 评论（1）');
    expect(writeText.mock.calls[0]![0]).toContain('@bob');
    history.replaceState(null, '', '/');
  });

  it('only injects into a menu opened right after a share click', async () => {
    const article = renderTweet('alice', '111');
    const menu = createShareMenu({ getLanguage: () => 'zh' });
    menu.listen();
    // 点「喜欢」后出现的菜单不注入
    (article.querySelector('[data-testid="like"]') as HTMLElement).click();
    const first = renderMenu();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(first.querySelector(`[${SHARE_ITEM_ATTRIBUTE}]`)).toBeNull();
    first.parentElement!.remove();

    (article.querySelector('.share') as HTMLElement).click();
    const second = renderMenu();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(second.querySelector(`[${SHARE_ITEM_ATTRIBUTE}]`)).not.toBeNull();
    menu.dispose();
  });

  it('模块关掉后不接管分享按钮', async () => {
    const article = renderTweet('alice', '333');
    const menu = createShareMenu({ getLanguage: () => 'zh', isEnabled: () => false });
    menu.listen();
    (article.querySelector('.share') as HTMLElement).click();
    const dropdown = renderMenu();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(dropdown.querySelector(`[${SHARE_ITEM_ATTRIBUTE}]`)).toBeNull();
    menu.dispose();
  });

  it('新版无 data-testid 与无 time 元素时：支持 XDS 菜单注入、去重 id 并从 Snowflake 还原日期', async () => {
    document.body.innerHTML = REDESIGN_TWEET_HTML;
    const menu = createShareMenu({ getLanguage: () => 'zh' });
    menu.listen();
    const shareBtn = document.querySelector<HTMLElement>('[data-engagement-action="share"]')!;
    shareBtn.click();

    const xdsMenu = document.createElement('div');
    xdsMenu.setAttribute('data-slot', 'xds-menu-content');
    xdsMenu.innerHTML = `
      <div role="menuitem" id="radix-item-1" class="xds-item">
        <svg id="radix-icon-1"><path d="native"></path></svg>
        <span id="radix-label-1">复制链接</span>
      </div>`;
    document.body.appendChild(xdsMenu);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const injected = xdsMenu.querySelector<HTMLElement>(`[${SHARE_ITEM_ATTRIBUTE}]`)!;
    expect(injected).not.toBeNull();
    expect(injected.hasAttribute('id')).toBe(false);
    expect(injected.querySelector('[id]')).toBeNull();
    injected.click();
    await Promise.resolve();

    const md = writeText.mock.calls[0]![0] as string;
    expect(md).toContain('**Sample Author** (@sample_user)');
    expect(md).toContain('Sample post body.');
    // 1800000000000000001 的 Snowflake 时间是 2024-06-10
    expect(md).toContain('2024-06-10');
    menu.dispose();
  });
});

describe('scrollToPost', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('scrolls and flashes the cell when the post is on the page', () => {
    const article = renderTweet('alice', '111');
    const cell = article.parentElement!;
    const scroll = vi.fn();
    cell.scrollIntoView = scroll;
    expect(scrollToPost('111')).toBe(true);
    expect(scroll).toHaveBeenCalled();
    expect(cell.hasAttribute('data-fs-flash')).toBe(true);
    expect(scrollToPost('999')).toBe(false);
  });
});
