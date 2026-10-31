import type { FeedContext, FeedItem } from './types';
import { extractHandleFromPath } from './handle';
import { QUOTE_CARD_SELECTOR, tweetSelectors } from './selectors/selectors';

const POST_ID_RE = /\/status\/(\d+)/;

function statusId(anchor: Element): string | undefined {
  return POST_ID_RE.exec(anchor.getAttribute('href') ?? '')?.[1];
}

/**
 * 本推文 id。优先级：
 * 1. 包着 <time> 的时间戳链接，且不在引用卡片里（X 每条推文的固定结构）；
 * 2. 引用卡片之外的第一个 /status/ 链接；
 * 3. 任意第一个 /status/ 链接（旧行为兜底）。
 *
 * 不能直接取第一个链接：详情页主推文引用了带图帖子时，DOM 里最先出现的是
 * 被引用帖子的图片链接（/other/status/<引用帖>/photo/1），2026-10-30 真机发现。
 */
function extractPostId(article: Element): string | undefined {
  const anchors = [...article.querySelectorAll('a[href*="/status/"]')];
  const outsideQuote = anchors.filter((anchor) => !anchor.closest(QUOTE_CARD_SELECTOR));
  const timestamp = outsideQuote.find((anchor) => anchor.querySelector('time'));
  for (const anchor of [timestamp, ...outsideQuote, ...anchors]) {
    const id = anchor ? statusId(anchor) : undefined;
    if (id) return id;
  }
  return undefined;
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

function extractOwnText(article: Element, postId?: string): string {
  const parts: string[] = [];
  for (const textEl of article.querySelectorAll(tweetSelectors.text)) {
    if (!isInsideQuotedPost(textEl, article, postId)) {
      const text = visibleText(textEl);
      if (text) {
        parts.push(text);
      }
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
    if (isInsideQuotedPost(anchor, article, postId)) {
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
  const authorAnchor = article.querySelector<HTMLAnchorElement>(tweetSelectors.authorLink);
  const handle = authorAnchor ? extractHandleFromPath(authorAnchor.pathname) : null;
  if (!handle) return null;
  const postId = extractPostId(article);
  return { ...(postId ? { postId } : {}), author: { handle } };
}

/** 本推文的发布时间（Unix 毫秒）：取引用卡片之外的 <time datetime>。 */
export function extractTweetTime(article: Element): number | undefined {
  for (const time of article.querySelectorAll('time[datetime]')) {
    if (time.closest(QUOTE_CARD_SELECTOR)) continue;
    const ms = Date.parse(time.getAttribute('datetime') ?? '');
    if (Number.isFinite(ms)) return ms;
  }
  return undefined;
}

export function extractFeedItem(article: Element, context: FeedContext = 'other'): FeedItem | null {
  const authorAnchor = article.querySelector<HTMLAnchorElement>(tweetSelectors.authorLink);
  const handle = authorAnchor ? extractHandleFromPath(authorAnchor.pathname) : null;
  if (!handle) {
    return null;
  }

  const nameArea = article.querySelector(tweetSelectors.authorNameArea);
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
