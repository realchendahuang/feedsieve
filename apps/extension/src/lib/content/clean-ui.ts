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
import {
  extractHandleFromPath,
  extractTweetIdentity,
  findTweetAuthorArea,
  findTweetOwnTextElements,
  menuSelectors,
  QUOTE_CARD_SELECTOR,
  tweetSelectors,
} from '@feedsieve/x-adapter';
import { getUiSettings, subscribeUiSettings, type UiSettings } from '../settings/ui-settings';

const STYLE_ID = 'feedsieve-clean-ui-styles';
const MARK_ATTR = 'data-fs-clean';
const FOR_YOU = ['为你推荐', 'For you'];
const FOLLOWING = ['正在关注', 'Following'];
const WHO_TO_FOLLOW = ['推荐关注', 'Who to follow'];
const TRENDS_PREFIXES = [
  '当前趋势',
  '有什么新鲜事',
  'What’s happening',
  "What's happening",
  'Trending now',
  'Trending',
];
const TRENDS_HEADINGS = new Set(TRENDS_PREFIXES);
const SIDEBAR_NON_CARD_SELECTOR =
  'form, [role="search"], [role="radiogroup"], [data-testid="SearchBox_Search_Input"], input, select, textarea, a[href*="/tos"], a[href*="/privacy"], a[href*="/i/premium_sign_up"], a[href*="/i/verified-choose"]';
const SIDEBAR_HEADING_SELECTOR = 'h1, h2, h3, [role="heading"]';
/** 新版无 data-testid 时间线里，帖子右上角 Grok 按钮的无障碍文案（2026-11-16 现场样本确认） */
const GROK_POST_LABELS = new Set(['解释这个帖子', 'Explain this post']);
/** X 给付费推广帖打的标签（贴在作者名那一行，取代发布时间） */
const PROMOTED_LABELS = new Set(['推广', 'Promoted']);
/** 帖子右上角「推广」按钮的文案：X 给作者本人看的 Promote 入口（2026-11-09 真机确认） */
const PROMOTE_BUTTON_LABELS = new Set(['推广', 'Promote']);
/** 正文少于这么多字的蓝标回复，按「只为回复位买蓝 V」处理 */
export const PREMIUM_REPLY_MAX_CHARS = 20;
const SCAN_DEBOUNCE_MS = 400;
/** 推文状态链接（.../status/123）里的 id：详情页的 URL 和推文里的时间戳链接用同一套格式 */
const STATUS_ID = /\/status\/(\d+)/;
/** 新版推文底部回复动作链接里的本帖 id（推广帖无 /status/ 时间戳链接时仍带此链接） */
const IN_REPLY_TO_ID = /[?&]in_reply_to=(\d+)/;

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
  /* 帖子右上角的「推广」按钮：X 只给作者本人看，认文案打标记。
     这个按钮没有 data-testid / aria-label，不能按 X 的 class 找。 */
  html[data-fs-clean-promote-btn] [data-fs-clean="promote-btn"] { display: none !important; }
  html[data-fs-clean-grok] [data-fs-clean="grok"] { display: none !important; }
  html[data-fs-clean-foryou] [data-fs-clean="foryou"] { display: none !important; }
  html[data-fs-clean-trends] [data-fs-clean="trends"] { display: none !important; }
  html[data-fs-clean-follow] [data-fs-clean="follow"] { display: none !important; }
  /* 只淡化真正的推文：页面里还有别的 <article>（长文卡片、模块容器），
     那些不是推文，不该被压暗。 */
  html[data-fs-clean-premium] article[data-testid="tweet"][data-fs-clean="premium"],
  html[data-fs-clean-premium] article:not([data-testid="twitterArticleReadView"]):has([data-engagement-action="like"], [data-engagement-action="unlike"])[data-fs-clean="premium"] {
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

export function isTrendHeading(el: Element): boolean {
  return TRENDS_HEADINGS.has(textOf(el));
}

function isSingleSidebarCard(
  node: Element,
  heading: Element,
  isOwnHeading: (el: Element) => boolean,
  prefixes: readonly string[],
): boolean {
  if (
    node.matches('article, main, nav, header, footer') ||
    node.querySelector('article, main, nav, header, footer')
  ) {
    return false;
  }
  // 侧栏搜索框、筛选单选组、Premium 引导和页脚链接绝不会出现在趋势或推荐关注卡片内：见到即停止上溯
  if (node.matches(SIDEBAR_NON_CARD_SELECTOR) || node.querySelector(SIDEBAR_NON_CARD_SELECTOR)) {
    return false;
  }
  for (const landmark of node.querySelectorAll('section, aside')) {
    if (!landmark.contains(heading)) return false;
  }
  const headings = [
    ...(node.matches(SIDEBAR_HEADING_SELECTOR) ? [node] : []),
    ...node.querySelectorAll(SIDEBAR_HEADING_SELECTOR),
  ];
  if (headings.length === 0 || !headings.every(isOwnHeading)) return false;
  const text = textOf(node);
  return prefixes.some((prefix) => text.startsWith(prefix));
}

function climbSidebarCard(
  heading: Element,
  isOwnHeading: (el: Element) => boolean,
  prefixes: readonly string[],
): Element | null {
  const column = heading.closest('[data-testid="sidebarColumn"]');
  if (!column && !heading.closest('aside')) return null;
  let node: Element | null = heading;
  let best: Element | null = null;
  while (node && (column ? node !== column : Boolean(node.closest('aside')))) {
    if (!isSingleSidebarCard(node, heading, isOwnHeading, prefixes)) break;
    best = node;
    node = node.parentElement;
  }
  return best && best !== heading ? best : null;
}

/**
 * 「推荐关注」标题所属的模块卡片：从标题上溯到「只含这一类标题且不含搜索框/其它模块」的最大容器。
 *
 * 兼容旧版 [data-testid="sidebarColumn"] 与新版右侧栏 <aside>（无论单模块独立 <aside>
 * 还是整栏共用单个外层 <aside>），防止把顶部搜索框或相邻模块连坐隐藏。
 */
export function whoToFollowCard(heading: Element): Element | null {
  return climbSidebarCard(heading, isWhoToFollowHeading, WHO_TO_FOLLOW);
}

/** 「有什么新鲜事 / 当前趋势」标题所属的侧栏模块卡片，不连坐共用 <aside> 内的搜索框或其它模块。 */
export function trendsCard(heading: Element): Element | null {
  const column = heading.closest('[data-testid="sidebarColumn"]');
  if (!column && !heading.closest('aside')) return null;
  const section = heading.closest('section[role="region"]');
  if (
    section &&
    (column ? column.contains(section) : Boolean(section.closest('aside'))) &&
    isSingleSidebarCard(section, heading, isTrendHeading, TRENDS_PREFIXES)
  ) {
    return section;
  }
  return climbSidebarCard(heading, isTrendHeading, TRENDS_PREFIXES);
}

/** 从侧栏里的一个节点上溯到它所属的模块根（[data-testid="sidebarColumn"] 的直接子级）。 */
export function moduleRoot(el: Element): Element | null {
  const column = el.closest('[data-testid="sidebarColumn"]');
  if (!column) return null;
  let node: Element = el;
  while (node.parentElement && node.parentElement !== column) node = node.parentElement;
  return node.parentElement === column ? node : null;
}

/** 详情页 URL 里的主帖 id（/user/status/123、/i/web/status/123 都算）；其它页面为 null。 */
export function focalStatusId(pathname: string = location.pathname): string | null {
  return STATUS_ID.exec(pathname)?.[1] ?? null;
}

function statusIdOf(href: string): string | null {
  return STATUS_ID.exec(href)?.[1] ?? null;
}

function isQuoted(element: Element, article: Element): boolean {
  for (let node: Element | null = element; node && node !== article; node = node.parentElement) {
    if (node.tagName === 'ARTICLE') return true;
    if (node.matches(QUOTE_CARD_SELECTOR) && node.querySelector(tweetSelectors.statusLink))
      return true;
  }
  return false;
}

function isEmbeddedOrBodyNode(element: Element, article: Element): boolean {
  if (isQuoted(element, article)) return true;
  for (let node: Element | null = element; node && node !== article; node = node.parentElement) {
    if (
      node.matches(
        `${tweetSelectors.text}, [data-testid="card.wrapper"], [data-testid="birdwatch-pivot"], [role="link"], [role="radiogroup"], blockquote`,
      )
    ) {
      return true;
    }
  }
  return false;
}

function ownPostIdOf(article: Element): string | null {
  const identityId = extractTweetIdentity(article)?.postId;
  if (identityId) return identityId;
  const ownStatusLinks = [...article.querySelectorAll('a[href*="/status/"]')].filter(
    (link) => !isEmbeddedOrBodyNode(link, article),
  );
  const timestamp = ownStatusLinks.find((link) => link.querySelector('time'));
  const permalink = ownStatusLinks.find((link) =>
    /\/status\/\d+\/?(?:[?#].*)?$/.test(link.getAttribute('href') ?? ''),
  );
  for (const link of [timestamp, permalink, ...ownStatusLinks]) {
    const id = link ? statusIdOf(link.getAttribute('href') ?? '') : null;
    if (id) return id;
  }
  for (const link of article.querySelectorAll(
    '[data-engagement-action="reply"] a[href*="in_reply_to="]',
  )) {
    if (isEmbeddedOrBodyNode(link, article)) continue;
    const id = IN_REPLY_TO_ID.exec(link.getAttribute('href') ?? '')?.[1] ?? null;
    if (id) return id;
  }
  return null;
}

function articleAuthorHandle(article: Element): string | null {
  const identityHandle = extractTweetIdentity(article)?.author.handle;
  if (identityHandle) return identityHandle.toLowerCase();
  const legacyLink = article.querySelector<HTMLAnchorElement>(
    '[data-testid="User-Name"] a[href^="/"]',
  );
  const handle = legacyLink ? extractHandleFromPath(legacyLink.getAttribute('href') ?? '') : null;
  return handle ? handle.toLowerCase() : null;
}

/**
 * 这条推文是不是 URL 指向的主帖。
 *
 * 不能靠「详情页第一条 article 就是主帖」：X 会先渲染置顶推文、父帖、广告或其它
 * article，主帖未必排在第一；按顺序猜会把主帖当回复压暗或当广告藏掉。
 * 这里认推文自己带的状态链接 id（及新版无时间戳链接时的回复动作 in_reply_to id）。
 * 默认引用卡片里指向主帖的链接也算（宁可少淡化一条回复）；推广帖豁免传 includeQuoted=false。
 */
export function isFocalTweet(
  article: Element,
  focalId: string | null = focalStatusId(),
  options?: { includeQuoted?: boolean },
): boolean {
  if (!focalId) return false;
  if (ownPostIdOf(article) === focalId) return true;
  const includeQuoted = options?.includeQuoted ?? true;
  if (!includeQuoted) return false;
  for (const link of article.querySelectorAll('a[href*="/status/"]')) {
    if (statusIdOf(link.getAttribute('href') ?? '') === focalId) return true;
  }
  return false;
}

/**
 * 只对评论区（详情页）里蓝标作者、正文很短的回复降透明度。
 * 主帖由 isFocalTweet 按 status id 认，不靠 DOM 顺序；不是推文的 <article> 不碰。
 * 没有正文（纯媒体/纯转发）也不动。
 */
export function isThinPremiumReply(
  article: Element,
  focalId: string | null = focalStatusId(),
): boolean {
  if (!article.matches(tweetSelectors.article)) return false;
  if (isFocalTweet(article, focalId)) return false;
  const name = findTweetAuthorArea(article);
  const texts = findTweetOwnTextElements(article);
  if (!name || texts.length === 0) return false;
  if (!name.querySelector(tweetSelectors.verifiedBadge)) return false;
  const combined = texts
    .map((el) => textOf(el))
    .filter(Boolean)
    .join(' ');
  return combined.length < PREMIUM_REPLY_MAX_CHARS;
}

/**
 * 这条推文是不是标着「推广」的付费帖。
 *
 * 只认 X 贴在作者名那一行的「推广 / Promoted」标签：昵称、正文、链接卡片里
 * 出现同样的字不算。不要改用 X 自己的容器标记（例如 placementTracking）来判断，
 * 那个标记连推文里的视频/GIF 播放器一起包着，隐藏它会在时间线上留下空白媒体框。
 */
export function isPromotedArticle(article: Element): boolean {
  if (
    !article.querySelector('[data-testid="User-Name"]') &&
    !article.matches(tweetSelectors.article)
  ) {
    return false;
  }
  for (const el of article.querySelectorAll('span')) {
    if (el.childElementCount > 0) continue;
    if (!PROMOTED_LABELS.has(textOf(el))) continue;
    if (el.closest('[data-testid="User-Name"]')) continue;
    if (isEmbeddedOrBodyNode(el, article)) continue;
    // 下拉菜单里的「推广 / 推广此帖」是操作文案，不是帖子的推广标签
    if (el.closest(`[role="menu"], ${menuSelectors.dropdown}`)) continue;
    // 话题、提及、正文里的链接都是 <a>；作者自己的「推广」按钮是 button，都不是广告标签
    if (el.closest('a, button, [role="button"]')) continue;
    return true;
  }
  return false;
}

/**
 * 帖子右上角的「推广」按钮（X 给作者本人看的 Promote 入口，点了进广告投放）。
 *
 * 这个按钮没有 data-testid / aria-label，只能认文案：中文「推广」、英文「Promote」。
 * 只认按钮本身；正文、引用卡片、下拉菜单里出现同样的字样不算——那要么是用户
 * 写的内容，要么是 X 的菜单项。
 */
export function isPromoteButton(el: Element): boolean {
  if (!el.matches('button, [role="button"]')) return false;
  if (!PROMOTE_BUTTON_LABELS.has(textOf(el))) return false;
  const article = el.closest('article');
  if (article && isQuoted(el, article)) return false;
  if (
    el.closest(
      `${tweetSelectors.text}, [data-testid="card.wrapper"], [role="menu"], ${menuSelectors.dropdown}`,
    )
  ) {
    return false;
  }
  return true;
}

export function createCleanUi() {
  let settings: UiSettings | null = null;
  let observer: MutationObserver | null = null;
  let observing = false;
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

  /**
   * 观察器跟着总开关走：默认关闭时不该常驻监听整页 DOM，设置关掉后也不该继续跑，
   * 所以只在 cleanUi 为 true 时挂上、关掉就断开；start 后第一条设置到达时再决定。
   */
  function syncObserver(on: boolean): void {
    if (on && active) {
      if (observing) return;
      // 懒创建：没打开过界面净化就一个观察器都不建
      observer ??= new MutationObserver(schedule);
      observer.observe(document.documentElement, { childList: true, subtree: true });
      observing = true;
      return;
    }
    if (!observing) return;
    observer?.disconnect();
    observing = false;
  }

  function clearMarks(): void {
    for (const el of document.querySelectorAll(`[${MARK_ATTR}]`)) el.removeAttribute(MARK_ATTR);
  }

  function applyFlags(next: UiSettings): void {
    const root = document.documentElement;
    const on = next.cleanUi;
    root.toggleAttribute('data-fs-clean-font', on && next.systemFont);
    root.toggleAttribute('data-fs-clean-promoted', on && next.hidePromoted);
    root.toggleAttribute('data-fs-clean-promote-btn', on && next.hidePromoteButton);
    root.toggleAttribute('data-fs-clean-grok', on && next.hideGrok);
    root.toggleAttribute('data-fs-clean-foryou', on && next.hideForYou);
    root.toggleAttribute('data-fs-clean-trends', on && next.hideTrends);
    root.toggleAttribute('data-fs-clean-follow', on && next.hideWhoToFollow);
    root.toggleAttribute('data-fs-clean-premium', on && next.dimPremiumReplies);
  }

  function scan(): void {
    timer = undefined;
    if (!settings?.cleanUi) {
      // 总开关关闭：没有观察的必要，顺手断开
      syncObserver(false);
      clearMarks();
      return;
    }
    syncObserver(true);
    // 换了页面（SPA 路由）就重新给「为你推荐」一次自动切换的机会
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      switchedToFollowing = false;
    }
    ensureStyle();
    clearMarks();

    if (settings.hideGrok) {
      // 只藏左侧导航里的入口（整行 50px）。全页匹配 a[href="/i/grok"] 会连推文、
      // 引用卡片、下拉菜单里同 href 的链接一起藏掉——那些是用户内容。
      // 导航外层是整个左侧 NAV，不能连坐，所以只标记 <a> 本身。
      for (const link of document.querySelectorAll('nav a[href="/i/grok"]')) {
        mark(link, 'grok');
      }
      // 帖子头部的 Grok 操作按钮：旧版挂 aria-label="Grok 操作"，新版挂 aria-label="解释这个帖子"。
      // 正文、引用卡片、底部动作栏和菜单里的同名字样不碰。
      for (const article of document.querySelectorAll(tweetSelectors.article)) {
        for (const button of article.querySelectorAll('button[aria-label]')) {
          const label = button.getAttribute('aria-label') ?? '';
          if (!label.includes('Grok') && !GROK_POST_LABELS.has(label)) continue;
          if (isQuoted(button, article)) continue;
          if (
            button.closest(
              `${tweetSelectors.text}, [data-testid="card.wrapper"], ${tweetSelectors.actionGroup}, [role="menu"], ${menuSelectors.dropdown}`,
            )
          ) {
            continue;
          }
          mark(button, 'grok');
        }
      }
    }

    if (settings.hideForYou) {
      const tabs = [
        ...document.querySelectorAll(
          '#ScrollSnap-List [role="tab"], [role="tablist"] [role="tab"]',
        ),
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
      if (sidebar) {
        const trends = sidebar.querySelectorAll('[data-testid="trend"]');
        if (trends.length > 0) {
          for (const trend of trends) {
            mark(trend.closest('section[role="region"]') ?? trend.parentElement, 'trends');
          }
        } else {
          for (const heading of sidebar.querySelectorAll(SIDEBAR_HEADING_SELECTOR)) {
            if (!isTrendHeading(heading)) continue;
            mark(trendsCard(heading), 'trends');
          }
        }
      } else {
        for (const heading of document.querySelectorAll(
          'aside h1, aside h2, aside h3, aside [role="heading"]',
        )) {
          if (!isTrendHeading(heading) || heading.closest('[data-testid="primaryColumn"], article'))
            continue;
          mark(trendsCard(heading), 'trends');
        }
      }
    }

    if (settings.hideWhoToFollow) {
      const sidebar = document.querySelector('[data-testid="sidebarColumn"]');
      const headings = sidebar
        ? sidebar.querySelectorAll(SIDEBAR_HEADING_SELECTOR)
        : document.querySelectorAll('aside h1, aside h2, aside h3, aside [role="heading"]');
      for (const heading of headings) {
        if (
          !isWhoToFollowHeading(heading) ||
          heading.closest('[data-testid="primaryColumn"], article')
        ) {
          continue;
        }
        mark(whoToFollowCard(heading), 'follow');
      }
    }

    if (settings.hidePromoted) {
      // 详情页的主帖是用户自己点进来的，藏掉等于把整页清空：优先按 URL 的 status id
      // 认主帖（兼容前面渲染了父帖、置顶帖或广告的线程详情页）；若旧版推广主帖完全不带
      // 本帖状态 id，排除已知属于其它 id 的推文后优先匹配 URL 作者 handle 的推文豁免。
      const focalId = focalStatusId();
      const focalHandle = focalId ? extractHandleFromPath(location.pathname) : null;
      const articles = [...document.querySelectorAll('article')];
      const isOwnFocal = (article: Element) =>
        isFocalTweet(article, focalId, { includeQuoted: false });
      const hasMatchedFocal = focalId !== null && articles.some(isOwnFocal);
      let fallbackFocal: Element | null = null;
      if (focalId !== null && !hasMatchedFocal) {
        const statusless = articles.filter((article) => ownPostIdOf(article) === null);
        const tweetCandidates = statusless.filter(
          (article) =>
            article.matches(tweetSelectors.article) ||
            Boolean(article.querySelector('[data-testid="User-Name"]')),
        );
        const pool = tweetCandidates.length > 0 ? tweetCandidates : statusless;
        fallbackFocal =
          (focalHandle
            ? pool.find((article) => articleAuthorHandle(article) === focalHandle)
            : undefined) ??
          pool[0] ??
          null;
      }
      for (const article of articles) {
        if (hasMatchedFocal ? isOwnFocal(article) : article === fallbackFocal) continue;
        if (isPromotedArticle(article)) mark(article, 'promoted');
      }
    }

    if (settings.hidePromoteButton) {
      // 按钮挂在帖子头部右侧，和 Grok、浏览速度同一行；只藏按钮本身。
      // 不限定详情页：X 以后在时间线里给作者显示时也一起处理。
      for (const article of document.querySelectorAll(tweetSelectors.article)) {
        for (const el of article.querySelectorAll('button, [role="button"]')) {
          if (isPromoteButton(el)) mark(el, 'promote-btn');
        }
      }
    }

    if (settings.dimPremiumReplies) {
      const focalId = focalStatusId();
      // 只在详情页淡化回复：主帖是用户自己点进来的，不能压暗
      if (focalId) {
        const tweets = [...document.querySelectorAll(tweetSelectors.article)];
        // 认不出主帖（比如 X 没给时间戳挂状态链接）就整页不淡化：
        // 宁可不生效，也不能靠顺序猜、把主帖当回复一起压暗。
        if (tweets.some((article) => isFocalTweet(article, focalId))) {
          for (const article of tweets) {
            if (article.getAttribute(MARK_ATTR) === 'promoted') continue;
            if (isThinPremiumReply(article, focalId)) mark(article, 'premium');
          }
        }
      }
    }
  }

  function mark(el: Element | null, kind: string): void {
    el?.setAttribute(MARK_ATTR, kind);
  }

  function schedule(): void {
    // 固定节奏，不跟着每次 mutation 重置：X 播放视频、输入时 DOM 一直在变，
    // 每来一次改动就 clearTimeout 会把 scan 无限往后推，用户改了设置像没生效。
    // 已经排队就等它跑完（最多 SCAN_DEBOUNCE_MS 一轮），不做尾随重置。
    if (timer !== undefined) return;
    timer = window.setTimeout(scan, SCAN_DEBOUNCE_MS);
  }

  function apply(next: UiSettings): void {
    // stop 之后到达的异步结果不能再改页面
    if (!active) return;
    settings = next;
    applyFlags(next);
    syncObserver(next.cleanUi);
    if (next.cleanUi) ensureStyle();
    schedule();
  }

  function start(): void {
    active = true;
    // 先不观察：等设置读回来、确认总开关打开再挂，默认关闭时别常驻监听整页
    void getUiSettings().then(apply);
    unsubscribe = subscribeUiSettings(apply);
    // X 首屏渲染比 content script 晚，补一次
    initialTimer = window.setTimeout(schedule, 1500);
  }

  function stop(): void {
    active = false;
    syncObserver(false);
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
      'data-fs-clean-promote-btn',
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
