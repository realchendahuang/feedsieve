import type { FeedContext, FeedItem } from './types';
import { extractHandleFromPath } from './handle';
import { tweetSelectors } from './selectors/selectors';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const POST_ID_RE = /\/status\/(\d+)/;

function extractPostId(article: Element): string | undefined {
  // 推文正文/时间戳里第一个 /status/<id> 链接即本推文 id
  for (const anchor of article.querySelectorAll('a[href*="/status/"]')) {
    const match = POST_ID_RE.exec(anchor.getAttribute('href') ?? '');
    const id = match?.[1];
    if (id) {
      return id;
    }
  }
  return undefined;
}

/**
 * User-Name 区的文本形态是「DisplayName @handle」（中间可能有 · 认证标等）。
 * 剥掉 @handle 与残留分隔符，剩余部分即 displayName。
 */
function extractDisplayName(area: Element | null, handle: string): string | undefined {
  if (!area) {
    return undefined;
  }
  const full = area.textContent ?? '';
  // X 的展示名不允许含 @，所以所有 @handle 出现都可以安全剥掉
  const withoutHandle = full.replace(
    new RegExp(`@${escapeRegExp(handle)}\\b`, 'gi'),
    '',
  );
  const cleaned = withoutHandle
    .replace(/[\u00b7\u2022|]/g, ' ')
    .replace(/^[\s\-–—:·@]+|[\s\-–—:·@]+$/g, '');
  return cleaned || undefined;
}

function extractExternalLinks(article: Element): FeedItem['links'] {
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
    // 站内 UI 链接不是 FeedItem 感兴趣的对象；t.co 包装链接保留（Reader 阶段就是它）
    if (url.hostname === 'x.com' || url.hostname === 'twitter.com') {
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
export function extractFeedItem(
  article: Element,
  context: FeedContext = 'other',
): FeedItem | null {
  const authorAnchor =
    article.querySelector<HTMLAnchorElement>(tweetSelectors.authorLink);
  const handle = authorAnchor
    ? extractHandleFromPath(authorAnchor.pathname)
    : null;
  if (!handle) {
    return null;
  }

  const nameArea = article.querySelector(tweetSelectors.authorNameArea);
  const textEl = article.querySelector(tweetSelectors.text);

  return {
    source: 'x',
    postId: extractPostId(article),
    author: {
      handle,
      displayName: extractDisplayName(nameArea, handle),
    },
    text: textEl?.textContent ?? '',
    links: extractExternalLinks(article),
    context,
  };
}
