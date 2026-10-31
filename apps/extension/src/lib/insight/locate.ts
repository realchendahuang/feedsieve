/**
 * 热帖定位：推文还在当前页面上时，滚动过去并短暂高亮；不在页面上返回 false，
 * 由弹窗改为新开标签页。思路参考 X Viral Monitor 的浮动流速榜。
 */
import { extractTweetIdentity, tweetSelectors } from '@feedsieve/x-adapter';

export const FLASH_ATTRIBUTE = 'data-fs-flash';
const FLASH_MS = 1_600;

export function findArticleByPostId(postId: string): Element | null {
  for (const article of document.querySelectorAll(tweetSelectors.article)) {
    if (extractTweetIdentity(article)?.postId === postId) return article;
  }
  return null;
}

export function scrollToPost(postId: string): boolean {
  const article = findArticleByPostId(postId);
  if (!article) return false;
  const cell = (article.closest(tweetSelectors.timelineCell) ?? article) as HTMLElement;
  cell.scrollIntoView({ behavior: 'smooth', block: 'center' });
  cell.setAttribute(FLASH_ATTRIBUTE, '');
  window.setTimeout(() => cell.removeAttribute(FLASH_ATTRIBUTE), FLASH_MS);
  return true;
}
