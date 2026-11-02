/**
 * 界面净化：按设置隐藏 X 的推荐模块、换字体、给纯回复位的蓝标回复降透明度。
 *
 * 只改 X 自己的 DOM / CSS，不碰内容；总开关在设置里，默认关闭。
 * 选择器按 2026-11-02 的真实 DOM 写，X 改版后在这里补。
 */
import { getUiSettings, subscribeUiSettings, type UiSettings } from '../settings/ui-settings';

const STYLE_ID = 'feedsieve-clean-ui-styles';
const MARK_ATTR = 'data-fs-clean';
const FOR_YOU = ['为你推荐', 'For you'];
const FOLLOWING = ['正在关注', 'Following'];
const WHO_TO_FOLLOW = ['推荐关注', 'Who to follow'];
/** 正文少于这么多字的蓝标回复，按「只为回复位买蓝 V」处理 */
export const PREMIUM_REPLY_MAX_CHARS = 20;
const SCAN_DEBOUNCE_MS = 400;

const CLEAN_UI_CSS = `
  /* Chirp 不含中文字形，中文回退到系统字体 */
  html[data-fs-clean-font] body,
  html[data-fs-clean-font] button,
  html[data-fs-clean-font] input,
  html[data-fs-clean-font] textarea {
    font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB",
      "Microsoft YaHei", "Segoe UI", system-ui, sans-serif !important;
  }
  html[data-fs-clean-promoted] [data-testid="placementTracking"] { display: none !important; }
  html[data-fs-clean-grok] [data-fs-clean="grok"] { display: none !important; }
  html[data-fs-clean-foryou] [data-fs-clean="foryou"] { display: none !important; }
  html[data-fs-clean-trends] [data-fs-clean="trends"] { display: none !important; }
  html[data-fs-clean-follow] [data-fs-clean="follow"] { display: none !important; }
  html[data-fs-clean-premium] article[data-fs-clean="premium"] {
    opacity: .38 !important;
    transition: opacity .15s ease;
  }
`;

function textOf(el: Element | null): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

export function isForYouTab(el: Element): boolean {
  return el.getAttribute('role') === 'tab' && FOR_YOU.includes(textOf(el));
}

export function isFollowingTab(el: Element): boolean {
  return el.getAttribute('role') === 'tab' && FOLLOWING.includes(textOf(el));
}

export function isWhoToFollowHeading(el: Element): boolean {
  return WHO_TO_FOLLOW.includes(textOf(el));
}

/** 「推荐关注」标题所属的模块卡片：从标题上溯，取最后一个仍以这个标题开头的容器。 */
export function whoToFollowCard(heading: Element): Element | null {
  const column = heading.closest('[data-testid="sidebarColumn"]');
  if (!column) return null;
  let node: Element | null = heading;
  let best: Element | null = null;
  while (node && node !== column) {
    const text = textOf(node);
    if (text.startsWith('推荐关注') || text.startsWith('Who to follow')) best = node;
    node = node.parentElement;
  }
  return best ?? heading.closest('aside[role="complementary"]');
}

/** 从侧栏里的一个节点上溯到它所属的模块根（[data-testid="sidebarColumn"] 的直接子级）。 */
export function moduleRoot(el: Element): Element | null {
  const column = el.closest('[data-testid="sidebarColumn"]');
  if (!column) return null;
  let node: Element = el;
  while (node.parentElement && node.parentElement !== column) node = node.parentElement;
  return node.parentElement === column ? node : null;
}

/**
 * 只对评论区（详情页）里蓝标作者、正文很短的回复降透明度。
 * 第 0 条是主帖，不动；没有正文（纯媒体/纯转发）也不动。
 */
export function isThinPremiumReply(article: Element, index: number): boolean {
  if (index === 0) return false;
  const name = article.querySelector('[data-testid="User-Name"]');
  const text = article.querySelector('[data-testid="tweetText"]');
  if (!name || !text) return false;
  if (!name.querySelector('[data-testid="icon-verified"]')) return false;
  return textOf(text).length < PREMIUM_REPLY_MAX_CHARS;
}

export function createCleanUi() {
  let settings: UiSettings | null = null;
  let observer: MutationObserver | null = null;
  let timer: number | undefined;
  let initialTimer: number | undefined;
  let switchedToFollowing = false;
  let unsubscribe: (() => void) | null = null;
  let active = false;

  function ensureStyle(): void {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CLEAN_UI_CSS;
    document.documentElement.appendChild(style);
  }

  function clearMarks(): void {
    for (const el of document.querySelectorAll(`[${MARK_ATTR}]`)) el.removeAttribute(MARK_ATTR);
  }

  function applyFlags(next: UiSettings): void {
    const root = document.documentElement;
    const on = next.cleanUi;
    root.toggleAttribute('data-fs-clean-font', on && next.systemFont);
    root.toggleAttribute('data-fs-clean-promoted', on && next.hidePromoted);
    root.toggleAttribute('data-fs-clean-grok', on && next.hideGrok);
    root.toggleAttribute('data-fs-clean-foryou', on && next.hideForYou);
    root.toggleAttribute('data-fs-clean-trends', on && next.hideTrends);
    root.toggleAttribute('data-fs-clean-follow', on && next.hideWhoToFollow);
    root.toggleAttribute('data-fs-clean-premium', on && next.dimPremiumReplies);
  }

  function scan(): void {
    if (!settings?.cleanUi) {
      clearMarks();
      return;
    }
    ensureStyle();
    clearMarks();

    if (settings.hideGrok) {
      // 只隐藏链接本身（整行 50px），它的父级是整个左侧 NAV，不能连坐
      for (const link of document.querySelectorAll('a[href="/i/grok"]')) {
        mark(link, 'grok');
      }
    }

    if (settings.hideForYou) {
      const tabs = [
        ...document.querySelectorAll('#ScrollSnap-List div[role="tab"], [role="tablist"] div[role="tab"]'),
      ];
      const forYou = tabs.find(isForYouTab) ?? null;
      const following = tabs.find(isFollowingTab) ?? null;
      mark(forYou, 'foryou');
      // 当前停在「为你推荐」时切到「正在关注」；每次页面加载只切一次，不跟用户抢
      if (!switchedToFollowing && forYou?.getAttribute('aria-selected') === 'true' && following) {
        switchedToFollowing = true;
        (following as HTMLElement).click();
      }
    }

    if (settings.hideTrends) {
      for (const trend of document.querySelectorAll('[data-testid="trend"]')) {
        // 趋势模块的根是包含它的 section[role=region]；不能上溯到 sidebarColumn，
        // 那一层把搜索框和所有侧栏模块都包在一起。
        mark(trend.closest('section[role="region"]') ?? trend.parentElement, 'trends');
      }
    }

    if (settings.hideWhoToFollow) {
      const headings = document.querySelectorAll(
        '[data-testid="sidebarColumn"] h2, [data-testid="sidebarColumn"] [role="heading"]',
      );
      for (const heading of headings) {
        if (!isWhoToFollowHeading(heading)) continue;
        mark(whoToFollowCard(heading) ?? moduleRoot(heading), 'follow');
      }
    }

    if (settings.dimPremiumReplies && /\/status\/\d+/.test(location.pathname)) {
      [...document.querySelectorAll('article')].forEach((article, index) => {
        if (isThinPremiumReply(article, index)) article.setAttribute(MARK_ATTR, 'premium');
      });
    }
  }

  function mark(el: Element | null, kind: string): void {
    el?.setAttribute(MARK_ATTR, kind);
  }

  function schedule(): void {
    window.clearTimeout(timer);
    timer = window.setTimeout(scan, SCAN_DEBOUNCE_MS);
  }

  function apply(next: UiSettings): void {
    // stop 之后到达的异步结果不能再改页面
    if (!active) return;
    settings = next;
    applyFlags(next);
    if (next.cleanUi) ensureStyle();
    schedule();
  }

  function start(): void {
    active = true;
    observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    void getUiSettings().then(apply);
    unsubscribe = subscribeUiSettings(apply);
    // X 首屏渲染比 content script 晚，补一次
    initialTimer = window.setTimeout(schedule, 1500);
  }

  function stop(): void {
    active = false;
    observer?.disconnect();
    observer = null;
    unsubscribe?.();
    unsubscribe = null;
    window.clearTimeout(timer);
    window.clearTimeout(initialTimer);
    timer = undefined;
    initialTimer = undefined;
    // 置空后，万一还有排队的 scan 也只会清标记，不会重新注入
    settings = null;
    document.getElementById(STYLE_ID)?.remove();
    for (const flag of [
      'data-fs-clean-font',
      'data-fs-clean-promoted',
      'data-fs-clean-grok',
      'data-fs-clean-foryou',
      'data-fs-clean-trends',
      'data-fs-clean-follow',
      'data-fs-clean-premium',
    ]) {
      document.documentElement.removeAttribute(flag);
    }
    clearMarks();
  }

  return { start, stop };
}

export type CleanUi = ReturnType<typeof createCleanUi>;
