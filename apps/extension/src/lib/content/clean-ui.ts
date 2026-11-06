/**
 * 界面净化：按设置隐藏 X 的推荐模块、换字体、给纯回复位的蓝标回复降透明度。
 *
 * 只改 X 自己的 DOM / CSS，不碰内容；总开关在设置里，默认关闭。
 * 选择器按 2026-11-06 的真实 DOM 写，X 改版后在这里补。
 *
 * 隐藏任何东西之前先问一句：这个 [data-testid] 在 X 里是不是只服务于这一个用途？
 * 0.17.1 的事故就是这么来的：`placementTracking` 看着像广告位，其实 X 也拿它
 * 包推文里的视频/GIF 播放器，隐藏它等于把所有视频和 GIF 一起藏掉。认不准的标记
 * 就别拿来当判据，宁可改成认文案再打自己的标记。
 */
import { getUiSettings, subscribeUiSettings, type UiSettings } from '../settings/ui-settings';

const STYLE_ID = 'feedsieve-clean-ui-styles';
const MARK_ATTR = 'data-fs-clean';
const FOR_YOU = ['为你推荐', 'For you'];
const FOLLOWING = ['正在关注', 'Following'];
const WHO_TO_FOLLOW = ['推荐关注', 'Who to follow'];
/** X 给付费推广帖打的标签（贴在作者名那一行，取代发布时间） */
const PROMOTED_LABELS = new Set(['推广', 'Promoted']);
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
  /* 推广帖整条隐藏：标记由 isPromotedArticle() 认「推广」标签后打上。
     别改成隐藏 X 自己的容器标记，那些标记常被普通内容复用（见文件头注释）。 */
  html[data-fs-clean-promoted] article[data-fs-clean="promoted"] { display: none !important; }
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

/**
 * 「推荐关注」标题所属的模块卡片：从标题上溯到「只含这一个标题」的最大容器。
 *
 * 只看文案前缀不够：侧栏第一块模块前面没有文字（搜索框只有 placeholder），
 * 一路上去会把整个侧栏包裹层都选中，一次 display:none 就是整栏空白。
 * 多出一个标题就说明已经跨到别的模块了，停在前一层。
 */
export function whoToFollowCard(heading: Element): Element | null {
  const column = heading.closest('[data-testid="sidebarColumn"]');
  if (!column) return null;
  const headingCount = (el: Element) => el.querySelectorAll('h2, [role="heading"]').length;
  let node: Element | null = heading;
  let best: Element | null = null;
  while (node && node !== column) {
    const text = textOf(node);
    if (!text.startsWith('推荐关注') && !text.startsWith('Who to follow')) break;
    if (headingCount(node) > 1) break;
    // 侧栏顶部的搜索框没有文字，会被包裹层吞进来：见到搜索框就说明这一层不是卡片
    if (node.querySelector('form[role="search"], [data-testid="SearchBox_Search_Input"]')) break;
    best = node;
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

/**
 * 这条推文是不是标着「推广」的付费帖。
 *
 * 只认 X 贴在作者名那一行的「推广 / Promoted」标签：昵称、正文、链接卡片里
 * 出现同样的字不算。不要改用 X 自己的容器标记（例如 placementTracking）来判断，
 * 那个标记连推文里的视频/GIF 播放器一起包着，隐藏它会在时间线上留下空白媒体框。
 */
export function isPromotedArticle(article: Element): boolean {
  if (!article.querySelector('[data-testid="User-Name"]')) return false;
  for (const el of article.querySelectorAll('span')) {
    if (el.childElementCount > 0) continue;
    if (!PROMOTED_LABELS.has(textOf(el))) continue;
    if (el.closest('[data-testid="User-Name"]')) continue;
    if (el.closest('[data-testid="tweetText"]')) continue;
    if (el.closest('[data-testid="card.wrapper"]')) continue;
    // 下拉菜单里的「推广 / 推广此帖」是操作文案，不是帖子的推广标签
    if (el.closest('[role="menu"], [data-testid="Dropdown"]')) continue;
    // 话题、提及、正文里的链接都是 <a>，里面的「推广」是用户写的内容
    if (el.closest('a')) continue;
    return true;
  }
  return false;
}

export function createCleanUi() {
  let settings: UiSettings | null = null;
  let observer: MutationObserver | null = null;
  let timer: number | undefined;
  let initialTimer: number | undefined;
  let switchedToFollowing = false;
  let lastPath = location.pathname;
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
    // 换了页面（SPA 路由）就重新给「为你推荐」一次自动切换的机会
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      switchedToFollowing = false;
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
      // 当前选中的 Tab 绝不隐藏：藏掉的是自己正在看的那个，标签栏会像 X 坏了。
      // 停在「为你推荐」时先切到「正在关注」，切过去之后下一轮扫描再隐藏。
      if (forYou?.getAttribute('aria-selected') === 'true') {
        if (!switchedToFollowing) {
          switchedToFollowing = true;
          (following as HTMLElement | null)?.click();
        }
      } else {
        mark(forYou, 'foryou');
      }
    }

    if (settings.hideTrends) {
      // 设置文案是「隐藏右侧栏的趋势模块」，就只动侧栏：探索页主栏也有一模一样的
      // [data-testid="trend"]，跟着 section[role=region] 上溯会把主页内容整块藏掉。
      const sidebar = document.querySelector('[data-testid="sidebarColumn"]');
      for (const trend of sidebar?.querySelectorAll('[data-testid="trend"]') ?? []) {
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

    if (settings.hidePromoted) {
      // 详情页的主帖是用户自己点进来的，藏掉等于把整页清空：只处理时间线里的推广帖
      const focal = /\/status\/\d+/.test(location.pathname) ? document.querySelector('article') : null;
      for (const article of document.querySelectorAll('article')) {
        if (article === focal) continue;
        if (isPromotedArticle(article)) mark(article, 'promoted');
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
