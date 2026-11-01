/**
 * 在 X 的分享菜单顶部加两项：「复制为 Markdown」，以及详情页主推文的「复制推文与评论」。
 *
 * 流程：捕获分享按钮的点击 → 记下所在推文 → 1.5 秒内出现的 Dropdown 菜单视为它的分享菜单
 * → 复制 X 原生菜单项的节点结构（沿用 X 的样式类，不复制 React 事件）并换掉图标和文字。
 * ... 菜单（caret）也用 Dropdown，但不是由分享按钮触发，所以不会被注入。
 *
 * 所有文字走 textContent，图标是写死的 SVG path，不拼接任何页面数据进 HTML。
 */
import {
  extractFeedItem,
  extractTweetIdentity,
  extractTweetTime,
  KNOWN_ACTION_TEST_IDS,
  menuSelectors,
  tweetSelectors,
} from '@feedsieve/x-adapter';
import type { UiLanguage } from '../platform/i18n';
import { threadToMarkdown, tweetToMarkdown, type MarkdownTweet } from './markdown';

export const SHARE_ITEM_ATTRIBUTE = 'data-fs-share-item';
export const TOAST_CLASS = 'fs-toast';
const MENU_WAIT_MS = 1_500;
const MAX_REPLIES = 100;
const SVG_NS = 'http://www.w3.org/2000/svg';
/** Markdown 标志（M↓）。 */
const MARKDOWN_ICON =
  'M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm2 3v8h2v-5l2 3 2-3v5h2V8H9.5L8 10.5 6.5 8H5zm11 0v4h-2l3 4 3-4h-2V8h-2z';
/** 对话气泡。 */
const THREAD_ICON =
  'M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H9l-5 4v-4H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm1 2v9h1.5v2l2.5-2h10V6H5zm2 2h10v1.5H7V8zm0 3h7v1.5H7V11z';

/** 动作栏里没有 data-testid 的按钮就是分享按钮（见 KNOWN_ACTION_TEST_IDS）。 */
export function isShareButton(button: Element): boolean {
  if (!button.closest(tweetSelectors.actionGroup)) return false;
  if (button.closest('[data-fs-manual-action], .fs-velocity')) return false;
  const testId = button.getAttribute('data-testid');
  return !testId || !(KNOWN_ACTION_TEST_IDS as readonly string[]).includes(testId);
}

function readTweet(article: Element): MarkdownTweet | null {
  const item = extractFeedItem(article);
  if (!item) return null;
  const createdAt = extractTweetTime(article);
  return {
    handle: item.author.handle,
    ...(item.author.displayName ? { displayName: item.author.displayName } : {}),
    ...(item.postId ? { postId: item.postId } : {}),
    text: item.text,
    ...(createdAt !== undefined ? { createdAt } : {}),
  };
}

/** 当前是这条推文的详情页：URL 里的 status id 等于它的 postId。 */
function isFocalTweet(article: Element): boolean {
  const postId = extractTweetIdentity(article)?.postId;
  return !!postId && new RegExp(`/status/${postId}(?:$|[/?#])`).test(location.pathname);
}

function collectReplies(main: Element): MarkdownTweet[] {
  const replies: MarkdownTweet[] = [];
  let afterMain = false;
  for (const article of document.querySelectorAll(tweetSelectors.article)) {
    if (article === main) {
      afterMain = true;
      continue;
    }
    if (!afterMain) continue;
    const tweet = readTweet(article);
    if (tweet && tweet.text.trim()) replies.push(tweet);
    if (replies.length >= MAX_REPLIES) break;
  }
  return replies;
}

export function createShareMenu(deps: {
  getLanguage: () => UiLanguage;
  /** 模块总开关：关掉后不再接管分享按钮 */
  isEnabled?: () => boolean;
}) {
  let pendingArticle: Element | null = null;
  let observer: MutationObserver | null = null;
  let waitTimer: number | undefined;
  let toastTimer: number | undefined;

  function toast(text: string): void {
    let element = document.querySelector<HTMLElement>(`.${TOAST_CLASS}`);
    if (!element) {
      element = document.createElement('div');
      element.className = TOAST_CLASS;
      element.setAttribute('role', 'status');
      document.body.appendChild(element);
    }
    element.textContent = text;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => element?.remove(), 2_000);
  }

  function closeMenu(): void {
    // X 的菜单监听 Escape 关闭
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }

  async function copy(markdown: string): Promise<void> {
    const zh = deps.getLanguage() === 'zh';
    try {
      await navigator.clipboard.writeText(markdown);
      toast(zh ? '已复制' : 'Copied');
    } catch {
      toast(zh ? '复制失败' : 'Copy failed');
    }
  }

  function buildItem(template: Element, label: string, iconPath: string, onClick: () => void) {
    const item = template.cloneNode(true) as HTMLElement;
    item.setAttribute(SHARE_ITEM_ATTRIBUTE, '');
    const svg = item.querySelector('svg');
    if (svg) {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', iconPath);
      svg.replaceChildren(path);
    }
    // 文字放进第一个 span；同层的其他文本节点清空（X 的原生项只有一行文字）
    const spans = [...item.querySelectorAll('span')];
    const target = spans.find((span) => span.textContent?.trim()) ?? spans[0];
    if (target) {
      target.textContent = label;
      for (const span of spans) {
        if (span !== target && !span.contains(target) && !target.contains(span)) span.remove();
      }
    } else {
      item.textContent = label;
    }
    item.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick();
      closeMenu();
    });
    return item;
  }

  function inject(dropdown: Element, article: Element): void {
    if (dropdown.querySelector(`[${SHARE_ITEM_ATTRIBUTE}]`)) return;
    const template = dropdown.querySelector(menuSelectors.menuItem);
    if (!template?.parentElement) return;
    const zh = deps.getLanguage() === 'zh';
    const items: HTMLElement[] = [
      buildItem(template, zh ? '复制为 Markdown' : 'Copy as Markdown', MARKDOWN_ICON, () => {
        const tweet = readTweet(article);
        if (tweet) void copy(tweetToMarkdown(tweet, deps.getLanguage()));
      }),
    ];
    if (isFocalTweet(article)) {
      items.push(
        buildItem(template, zh ? '复制推文与评论' : 'Copy post and replies', THREAD_ICON, () => {
          const tweet = readTweet(article);
          if (tweet) {
            void copy(threadToMarkdown(tweet, collectReplies(article), deps.getLanguage()));
          }
        }),
      );
    }
    template.parentElement.insertBefore(items[0]!, template);
    if (items[1]) template.parentElement.insertBefore(items[1], template);
  }

  function stopWaiting(): void {
    observer?.disconnect();
    observer = null;
    window.clearTimeout(waitTimer);
    pendingArticle = null;
  }

  function waitForMenu(article: Element): void {
    stopWaiting();
    pendingArticle = article;
    const tryInject = (): boolean => {
      // 菜单出现前模块被关掉：别把「复制为 Markdown」留在半路上
      if (deps.isEnabled?.() === false) {
        stopWaiting();
        return true;
      }
      const dropdown = document.querySelector(menuSelectors.dropdown);
      if (!dropdown || !pendingArticle) return false;
      inject(dropdown, pendingArticle);
      stopWaiting();
      return true;
    };
    if (tryInject()) return;
    observer = new MutationObserver(() => void tryInject());
    observer.observe(document.body, { childList: true, subtree: true });
    waitTimer = window.setTimeout(stopWaiting, MENU_WAIT_MS);
  }

  function onClick(event: MouseEvent): void {
    if (deps.isEnabled?.() === false) return;
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest('button, [role="button"]');
    if (!button || !isShareButton(button)) return;
    const article = button.closest(tweetSelectors.article);
    if (article) waitForMenu(article);
  }

  let listening = false;

  function listen(): void {
    if (listening) return;
    listening = true;
    // 捕获阶段：X 的 React 处理器可能阻止冒泡
    document.addEventListener('click', onClick, true);
  }

  function dispose(): void {
    stopWaiting();
    if (!listening) return;
    listening = false;
    document.removeEventListener('click', onClick, true);
  }

  return { listen, inject, dispose };
}
