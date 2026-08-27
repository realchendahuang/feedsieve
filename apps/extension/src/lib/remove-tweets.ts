/**
 * 拉黑成功后的推文清理（对齐 X 原生拉黑行为：拉黑即刻生效，推文不再可见）。
 *
 * 我们走原生 API 拉黑，X 不会自己移除 DOM 里的推文；
 * 这里在确认成功后按 handle 扫掉页面上该账号的所有推文格子，
 * 让「已拉黑」立刻有可见效果，而不是等刷新。
 */

import { contextFromPath, extractFeedItem, tweetSelectors } from '@feedsieve/x-adapter';

/**
 * 收集页面上某个 handle 的所有推文外层格子。
 *
 * 对齐 X 原生行为：同一账号的多条推文（刷屏集群常见）一次性全部移除。
 * 格子取 `cellInnerDiv`（标注同款目标层）；页面结构异常取不到时退回 article。
 */
export function collectCellsByHandle(handle: string): Element[] {
  const cells: Element[] = [];
  const seen = new Set<Element>();
  const context = contextFromPath(location.pathname);
  for (const article of document.querySelectorAll(tweetSelectors.article)) {
    if (extractFeedItem(article, context)?.author.handle !== handle) {
      continue;
    }
    const cell = article.closest(tweetSelectors.timelineCell) ?? article;
    if (!seen.has(cell)) {
      seen.add(cell);
      cells.push(cell);
    }
  }
  return cells;
}

/**
 * 延迟后逐个移除：先让「已拉黑 ✓」反馈停留一拍，再让推文消失。
 * 只移除仍在文档中的节点（期间 X 可能已整棵重渲染）。
 */
export function removeCellsSoon(targets: Element[], delayMs = 650): void {
  window.setTimeout(() => {
    for (const cell of targets) {
      if (cell.isConnected) {
        cell.remove();
      }
    }
  }, delayMs);
}