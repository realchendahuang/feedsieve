import type { FeedContext, FeedItem } from './types';
import { extractHandleFromPath } from './handle';
import { menuSelectors, QUOTE_CARD_SELECTOR, tweetSelectors } from './selectors/selectors';

const POST_ID_RE = /\/status\/(\d+)/;
const IN_REPLY_TO_RE = /[?&]in_reply_to=(\d+)/;

function statusId(anchor: Element): string | undefined {
  return POST_ID_RE.exec(anchor.getAttribute('href') ?? '')?.[1];
}

/** 只检查 article 内部：新版时间线的可点击外壳也有 role=link，不能视作引用卡。 */
function isQuotedContent(element: Element, article: Element): boolean {
  for (let node: Element | null = element; node && node !== article; node = node.parentElement) {
    if (node.tagName === 'ARTICLE') return true;
    if (node.matches(QUOTE_CARD_SELECTOR) && node.querySelector(tweetSelectors.statusLink))
      return true;
  }
  return false;
}

/** 正文、外链预览卡、社区备注里的 /status/ 链接是用户内容或附加卡，不是本帖自己的状态链接。 */
function isUserContentLink(element: Element, article: Element): boolean {
  if (isQuotedContent(element, article)) return true;
  for (let node: Element | null = element; node && node !== article; node = node.parentElement) {
    if (
      node.matches(
        `${tweetSelectors.text}, [data-testid="card.wrapper"], [data-testid="birdwatch-pivot"], blockquote`,
      )
    ) {
      return true;
    }
  }
  return false;
}

/**
 * 本推文 id。优先级：
 * 1. 包着 <time> 的时间戳链接，且不在引用卡片/正文里（X 每条推文的固定结构）；
 * 2. 引用卡片与正文之外的固定链接（新版时间戳是纯文本，且详情页主帖固定链接在正文下方）；
 * 3. 引用卡片与正文之外的第一个 /status/ 链接；
 * 4. 新版推广帖去掉 /status/ 时间戳链接时，底部回复动作里的 in_reply_to=<本帖id>。
 *
 * 不能直接取第一个链接：详情页主推文引用了带图帖子或正文提及别的推文链接时，
 * DOM 里最先出现的是其它推文的链接。
 */
function extractPostId(article: Element): string | undefined {
  const anchors = [...article.querySelectorAll(tweetSelectors.statusLink)];
  const ownStatusLinks = anchors.filter((anchor) => !isUserContentLink(anchor, article));
  const timestamp = ownStatusLinks.find((anchor) => anchor.querySelector('time'));
  const permalink = ownStatusLinks.find((anchor) =>
    /\/status\/\d+\/?(?:[?#].*)?$/.test(anchor.getAttribute('href') ?? ''),
  );
  for (const anchor of [timestamp, permalink, ...ownStatusLinks]) {
    const id = anchor ? statusId(anchor) : undefined;
    if (id) return id;
  }
  for (const replyLink of article.querySelectorAll(
    '[data-engagement-action="reply"] a[href*="in_reply_to="]',
  )) {
    if (isUserContentLink(replyLink, article)) continue;
    const id = IN_REPLY_TO_RE.exec(replyLink.getAttribute('href') ?? '')?.[1];
    if (id) return id;
  }
  return undefined;
}

function postAuthorHandle(article: Element, postId: string | undefined): string | null {
  if (!postId) return null;
  for (const link of article.querySelectorAll<HTMLAnchorElement>(tweetSelectors.statusLink)) {
    if (isUserContentLink(link, article) || statusId(link) !== postId) continue;
    const handle = extractHandleFromPath(link.getAttribute('href') ?? '');
    if (handle && /^[a-z0-9_]{1,15}$/i.test(handle)) return handle.toLowerCase();
  }
  return null;
}

function focalUrlAuthorHandle(postId: string | undefined): string | null {
  if (!postId) return null;
  const pathname = globalThis.location?.pathname ?? '';
  if (POST_ID_RE.exec(pathname)?.[1] !== postId) return null;
  const handle = extractHandleFromPath(pathname);
  return handle && /^[a-z0-9_]{1,15}$/i.test(handle) ? handle.toLowerCase() : null;
}

function isAvatarLink(link: HTMLAnchorElement): boolean {
  if (link.closest(tweetSelectors.avatarContainer)) return true;
  if (
    link.querySelector('.x-avatar, [data-testid="Tweet-User-Avatar"], [data-testid^="UserAvatar"]')
  ) {
    return true;
  }
  const hasNonEmojiImg = link.querySelector('img:not([src*="/emoji/"])') !== null;
  return hasNonEmojiImg && visibleText(link).trim() === '';
}

function middotAuthorHandle(area: Element): string | null {
  for (const anchor of area.querySelectorAll<HTMLAnchorElement>(tweetSelectors.profileLink)) {
    if (isAvatarLink(anchor)) continue;
    const handle = extractHandleFromPath(anchor.getAttribute('href') ?? '');
    if (!handle || !/^[a-z0-9_]{1,15}$/i.test(handle)) continue;
    const lower = handle.toLowerCase();
    const atHandle = `@${lower}`;
    const nameText = visibleText(anchor).trim().toLowerCase();
    if (!nameText || nameText.includes(atHandle)) continue;
    const hasAtHandle = [...area.querySelectorAll('a, span, div')].some(
      (el) =>
        el !== anchor &&
        !anchor.contains(el) &&
        (el.matches('a')
          ? visibleText(el).trim().toLowerCase() === atHandle
          : el.childElementCount === 0 && (el.textContent ?? '').trim().toLowerCase() === atHandle),
    );
    if (hasAtHandle) return lower;
  }
  return null;
}

/**
 * 详情页主帖无 data-testid 时，时间戳在正文下方而不是头部 .x-middot-group 内：
 * 要求本帖固定链接的作者 handle 与头部（非头像、非正文）的昵称链接和 @handle 同时吻合。
 */
function findFocalAuthorArea(article: Element, postId: string | undefined): Element | null {
  const handle = postAuthorHandle(article, postId) ?? focalUrlAuthorHandle(postId);
  if (!handle) return null;
  const expectedPath = `/${handle}`;
  const atHandle = `@${handle}`;
  const matchingProfileLinks = [
    ...article.querySelectorAll<HTMLAnchorElement>(tweetSelectors.profileLink),
  ].filter((link) => {
    if (isQuotedContent(link, article) || link.closest(tweetSelectors.text)) return false;
    try {
      const pathname = new URL(link.getAttribute('href') ?? '', location.origin).pathname;
      return pathname.replace(/\/+$/, '').toLowerCase() === expectedPath;
    } catch {
      return false;
    }
  });
  const avatarLinks = matchingProfileLinks.filter(isAvatarLink);
  const headerLinks = matchingProfileLinks.filter((link) => !isAvatarLink(link));
  const nameLink = headerLinks.find((link) => {
    const text = visibleText(link).trim().toLowerCase();
    return text.length > 0 && !text.includes(atHandle);
  });
  if (!nameLink) return null;
  const handleLink = headerLinks.find(
    (link) => link !== nameLink && visibleText(link).trim().toLowerCase() === atHandle,
  );
  const handleSpan =
    handleLink ??
    [...article.querySelectorAll('span, div')].find(
      (el) =>
        el.childElementCount === 0 &&
        !isQuotedContent(el, article) &&
        !el.closest(tweetSelectors.text) &&
        (el.textContent ?? '').trim().toLowerCase() === atHandle,
    );
  if (!handleSpan) return null;
  for (
    let node: Element | null = nameLink.parentElement;
    node && node !== article;
    node = node.parentElement
  ) {
    if (
      avatarLinks.some((avatar) => node.contains(avatar)) ||
      node.querySelector(
        `.x-avatar, ${tweetSelectors.avatarContainer}, [data-testid^="UserAvatar"], ${tweetSelectors.statusLink}, ${tweetSelectors.actionGroup}`,
      )
    ) {
      return null;
    }
    if (node.contains(handleSpan)) return node;
  }
  return null;
}

/** 新版作者区需同时有本帖固定链接及相同 handle 的用户链接；推广帖无时间戳链接时按昵称+@handle成对校验。 */
export function findTweetAuthorArea(article: Element): Element | null {
  const postId = extractPostId(article);
  const candidates = [...article.querySelectorAll(tweetSelectors.authorNameArea)].filter(
    (area) => !isQuotedContent(area, article),
  );
  if (candidates.length > 0) {
    for (const area of candidates) {
      if (area.matches(tweetSelectors.legacyNameArea)) return area;
      const statusLinks = [...area.querySelectorAll<HTMLAnchorElement>(tweetSelectors.statusLink)];
      if (statusLinks.length > 0) {
        for (const link of statusLinks) {
          if (statusId(link) !== postId) continue;
          const match = /^\/([a-z0-9_]{1,15})\/status\/\d+\/?$/i.exec(link.pathname);
          if (!match) continue;
          const path = `/${match[1]!.toLowerCase()}`;
          if (
            [...area.querySelectorAll<HTMLAnchorElement>(tweetSelectors.profileLink)].some(
              (anchor) => anchor.pathname.replace(/\/+$/, '').toLowerCase() === path,
            )
          )
            return area;
        }
        continue;
      }
      const pairedHandle = middotAuthorHandle(area);
      const expectedHandle = postAuthorHandle(article, postId);
      if (pairedHandle && (!expectedHandle || expectedHandle === pairedHandle)) {
        return area;
      }
    }
    return null;
  }
  return findFocalAuthorArea(article, postId);
}

function authorAnchor(article: Element): HTMLAnchorElement | null {
  const area = findTweetAuthorArea(article);
  if (!area) return null;
  if (area.matches(tweetSelectors.legacyNameArea))
    return area.querySelector(tweetSelectors.profileLink);
  const postId = extractPostId(article);
  const permalink = [...area.querySelectorAll<HTMLAnchorElement>(tweetSelectors.statusLink)].find(
    (anchor) => statusId(anchor) === postId,
  );
  const handle = permalink
    ? extractHandleFromPath(permalink.pathname)
    : (postAuthorHandle(article, postId) ?? middotAuthorHandle(area));
  if (!handle) return null;
  return (
    [...area.querySelectorAll<HTMLAnchorElement>(tweetSelectors.profileLink)].find((anchor) => {
      try {
        const pathname = new URL(anchor.getAttribute('href') ?? '', location.origin).pathname;
        return pathname.replace(/\/+$/, '').toLowerCase() === `/${handle}`;
      } catch {
        return false;
      }
    }) ?? null
  );
}

/** 动作 / 菜单必须属于本帖，不能落在嵌套引用帖上。 */
export function findTweetActionGroup(article: Element): Element | null {
  for (const anchor of article.querySelectorAll(tweetSelectors.actionAnchor)) {
    if (!isQuotedContent(anchor, article)) return anchor.closest(tweetSelectors.actionGroup);
  }
  return null;
}

export function findTweetMenuButton(article: Element): Element | null {
  return (
    [...article.querySelectorAll(menuSelectors.caretButton)].find(
      (button) => !isQuotedContent(button, article),
    ) ?? null
  );
}

/** 本帖作者头像 img（排除引用帖与正文里的表情/配图）。 */
export function findTweetAvatarImg(article: Element): HTMLImageElement | null {
  const legacy = [
    ...article.querySelectorAll<HTMLImageElement>(`${tweetSelectors.avatarContainer} img`),
  ].find((img) => !isQuotedContent(img, article));
  if (legacy) return legacy;
  const anchor = authorAnchor(article);
  const handle = anchor ? extractHandleFromPath(anchor.pathname) : null;
  if (!handle) return null;
  const nameArea = findTweetAuthorArea(article);
  const expectedPath = `/${handle.toLowerCase()}`;
  for (const link of article.querySelectorAll<HTMLAnchorElement>(tweetSelectors.profileLink)) {
    if (isQuotedContent(link, article) || nameArea?.contains(link)) continue;
    let pathname: string;
    try {
      pathname = new URL(link.getAttribute('href') ?? '', location.origin).pathname;
    } catch {
      continue;
    }
    if (pathname.replace(/\/+$/, '').toLowerCase() !== expectedPath) continue;
    const img = link.querySelector<HTMLImageElement>('img');
    if (img) return img;
  }
  return null;
}

/**
 * 收集元素的可见文本。
 * X 把 emoji 渲染成 <img alt="🌸">，textContent 会整段漏掉，导致依赖
 * emoji 的内容信号（擦边 marker、纯 emoji 正文、装饰昵称）拿不到输入；
 * 遍历时必须把 img 的 alt 一并拼回。
 */
function visibleText(el: Element | null): string {
  if (!el) {
    return '';
  }
  let out = '';
  const walker = el.ownerDocument.createTreeWalker(el);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.nodeValue ?? '';
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const e = node as Element;
      if (e.tagName === 'IMG') {
        out += e.getAttribute('alt') ?? '';
      }
    }
  }
  return out.replace(/\s+/g, ' ').trim();
}

function extractDisplayName(area: Element | null, handle: string): string | undefined {
  if (!area) {
    return undefined;
  }
  const expectedPath = `/${handle.toLowerCase()}`;
  for (const anchor of area.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    let pathname: string;
    try {
      pathname = new URL(anchor.getAttribute('href') ?? '', location.origin).pathname;
    } catch {
      continue;
    }
    if (pathname.replace(/\/+$/, '').toLowerCase() !== expectedPath) continue;
    const candidate = visibleText(anchor).trim();
    if (!candidate || candidate.toLowerCase().includes(`@${handle.toLowerCase()}`)) continue;
    return candidate;
  }
  return undefined;
}

/**
 * X 的引用帖嵌在父 article 内。引用卡通常是一个 link/role=link 容器，里面
 * 自带另一个 /status/<id>。Reader 只能把父帖自己的正文与外链交给 Detector，
 * 否则“引用垃圾内容进行评论”的正常账号会被误标成原作者。
 */
function isInsideQuotedPost(element: Element, article: Element, articlePostId?: string): boolean {
  if (!articlePostId) {
    return false;
  }
  let current = element.parentElement;
  while (current && current !== article) {
    if (current.matches('a[href*="/status/"], [role="link"]')) {
      const statusAnchor = current.matches('a[href*="/status/"]')
        ? current
        : current.querySelector('a[href*="/status/"]');
      const nestedId = POST_ID_RE.exec(statusAnchor?.getAttribute('href') ?? '')?.[1];
      if (nestedId && nestedId !== articlePostId) {
        return true;
      }
    }
    current = current.parentElement;
  }
  return false;
}

export function findTweetOwnTextElements(
  article: Element,
  postId: string | undefined = extractPostId(article),
): Element[] {
  const out: Element[] = [];
  const nameArea = findTweetAuthorArea(article);
  const isFocalRedesigned =
    !!nameArea &&
    !nameArea.matches(tweetSelectors.legacyNameArea) &&
    !nameArea.matches('.x-middot-group');
  const focalPermalink =
    isFocalRedesigned && postId
      ? [...article.querySelectorAll<HTMLAnchorElement>(tweetSelectors.statusLink)].find(
          (anchor) =>
            !isUserContentLink(anchor, article) &&
            !nameArea.contains(anchor) &&
            /\/status\/\d+\/?(?:[?#].*)?$/.test(anchor.getAttribute('href') ?? '') &&
            statusId(anchor) === postId,
        )
      : undefined;
  for (const textEl of article.querySelectorAll(tweetSelectors.text)) {
    if (!textEl.matches(tweetSelectors.legacyText)) {
      if (isFocalRedesigned) {
        if (
          nameArea.contains(textEl) ||
          textEl.closest(
            'a, button, [role="button"], [role="radiogroup"], [role="link"], [role="group"], [role="menu"], [data-slot="xds-menu-content"], [data-slot="xds-context-menu-trigger"], [data-testid="card.wrapper"], [data-testid="birdwatch-pivot"], aside, blockquote',
          ) ||
          (focalPermalink &&
            Boolean(
              focalPermalink.compareDocumentPosition(textEl) & Node.DOCUMENT_POSITION_FOLLOWING,
            ))
        ) {
          continue;
        }
      } else if (!textEl.parentElement?.contains(nameArea)) {
        continue;
      }
    }
    if (!isQuotedContent(textEl, article) && !isInsideQuotedPost(textEl, article, postId)) {
      out.push(textEl);
    }
  }
  return out;
}

function extractOwnText(article: Element, postId?: string): string {
  const parts: string[] = [];
  for (const textEl of findTweetOwnTextElements(article, postId)) {
    const text = visibleText(textEl);
    if (text) {
      parts.push(text);
    }
  }
  return parts.join(' ');
}

function extractExternalLinks(article: Element, postId?: string): FeedItem['links'] {
  const links = new Map<string, FeedItem['links'][number]>();
  for (const anchor of article.querySelectorAll('a[href]')) {
    const href = anchor.getAttribute('href') ?? '';
    let url: URL;
    try {
      url = new URL(href, location.origin);
    } catch {
      continue;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      continue;
    }
    // 站内 UI 链接不是 FeedItem 感兴趣的对象；t.co 包装链接保留（Reader 阶段就是它）。
    // 必须排在引用卡判断之前：时间戳/提及/话题标签等站内链接占绝大多数，
    // 无论是否在引用卡内都会被跳过，先跳过可省掉每个锚点一次的父链上溯。
    if (url.hostname === 'x.com' || url.hostname === 'twitter.com') {
      continue;
    }
    if (isQuotedContent(anchor, article) || isInsideQuotedPost(anchor, article, postId)) {
      continue;
    }
    if (!links.has(url.href)) {
      const display = (anchor.textContent ?? '').trim();
      links.set(url.href, {
        href: url.href,
        hostname: url.hostname,
        display: display || undefined,
      });
    }
  }
  return [...links.values()];
}

/**
 * 从一条 X 推文的 <article data-testid="tweet"> 提取稳定 FeedItem。
 *
 * - handle 缺失（DOM 不符合预期）时返回 null，调用方安全跳过
 * - 输出是纯数据：Detector 与 UI 永远不直接读 article 内部结构
 */
/**
 * 只读推文身份（postId + 作者 handle），不提取正文和链接。
 * 用于高频刷新（例如流速徽标）：比 extractFeedItem 少两次整棵子树遍历。
 */
export function extractTweetIdentity(
  article: Element,
): { postId?: string; author: { handle: string } } | null {
  const anchor = authorAnchor(article);
  const handle = anchor ? extractHandleFromPath(anchor.pathname) : null;
  if (!handle) return null;
  const postId = extractPostId(article);
  return { ...(postId ? { postId } : {}), author: { handle } };
}

/** 本推文的发布时间（Unix 毫秒）：取引用卡片之外的 <time datetime>。 */
export function extractTweetTime(article: Element): number | undefined {
  for (const time of article.querySelectorAll('time[datetime]')) {
    if (isQuotedContent(time, article)) continue;
    const ms = Date.parse(time.getAttribute('datetime') ?? '');
    if (Number.isFinite(ms)) return ms;
  }
  return undefined;
}

export function extractFeedItem(article: Element, context: FeedContext = 'other'): FeedItem | null {
  const anchor = authorAnchor(article);
  const handle = anchor ? extractHandleFromPath(anchor.pathname) : null;
  if (!handle) {
    return null;
  }

  const nameArea = findTweetAuthorArea(article);
  const postId = extractPostId(article);

  return {
    source: 'x',
    postId,
    author: {
      handle,
      displayName: extractDisplayName(nameArea, handle),
    },
    text: extractOwnText(article, postId),
    links: extractExternalLinks(article, postId),
    context,
  };
}
