/**
 * 拉黑成功后的推文隐藏。
 *
 * X 的时间线 DOM 由 React/虚拟列表持有。直接 `remove()` 一个 cell 会同时改变
 * 列表高度和滚动锚点，导致浏览器补偿 scrollTop、视口向上跳。这里保留 X 持有的
 * 节点，只用属性/CSS 隐藏，并在布局变化前后锁定实际滚动容器的位置。
 */

import { contextFromPath, extractFeedItem, tweetSelectors } from '@feedsieve/x-adapter';

/** X cell 已被 FeedSieve 隐藏；由 content script 的注入样式折叠高度。 */
export const HIDDEN_TWEET_CELL_ATTRIBUTE = 'data-fs-hidden';

interface ScrollSnapshot {
  element: HTMLElement;
  top: number;
  left: number;
  overflowAnchor: string;
  overflowAnchorPriority: string;
}

/**
 * 收集页面上某个 handle 的所有推文外层格子。
 *
 * 对齐 X 原生行为：同一账号的多条推文（刷屏集群常见）一次性全部隐藏。
 * 格子取 `cellInnerDiv`（标注同款目标层）；页面结构异常取不到时退回 article。
 */
export function collectCellsByHandle(handle: string): Element[] {
  const normalizedHandle = normalizeHandle(handle);
  if (!normalizedHandle) return [];

  const cells: Element[] = [];
  const seen = new Set<Element>();
  const context = contextFromPath(location.pathname);
  for (const article of document.querySelectorAll(tweetSelectors.article)) {
    if (extractFeedItem(article, context)?.author.handle.toLowerCase() !== normalizedHandle) {
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
 * 延迟后批量隐藏：先让「已拉黑 ✓」反馈停留一拍，再让推文消失。
 *
 * 不能直接删除 React/虚拟列表拥有的 cell。CSS 折叠高度仍会触发浏览器的
 * scroll anchoring，所以整个属性变化被包在 `mutateWithStableViewport` 中。
 */
export function hideCellsSoon(targets: Iterable<Element>, delayMs = 650): void {
  // 调用点通常来自实时 DOM 查询；在等待成功反馈期间保留当时的目标集合，避免
  // 外部可变数组或一次性 iterator 让这次隐藏意外指向其它 cell。
  const targetSnapshot = [...targets];
  window.setTimeout(() => {
    const cells = connectedUniqueCells(targetSnapshot).filter(
      (cell) => !cell.hasAttribute(HIDDEN_TWEET_CELL_ATTRIBUTE),
    );
    if (cells.length === 0) return;

    mutateWithStableViewport(cells, () => {
      blurFocusInside(cells);
      for (const cell of cells) {
        cell.setAttribute(HIDDEN_TWEET_CELL_ATTRIBUTE, 'true');
      }
    });
  }, delayMs);
}

/**
 * 让一次会改变时间线高度的同步 DOM 更新不改变用户的滚动位置。
 *
 * X 主时间线通常滚动 document，但评论抽屉/未来布局也可能使用嵌套 scroller；
 * 因此同时快照 document.scrollingElement 和目标节点的可滚动祖先。临时关闭
 * scroll anchoring，变更后立即恢复坐标，并在两个绘制帧内再次校准，以覆盖
 * Chrome 的异步锚点结算与 X 的同步虚拟列表重排。
 */
export function mutateWithStableViewport<T>(targets: Iterable<Element>, mutate: () => T): T {
  const cells = connectedUniqueCells(targets);
  if (cells.length === 0) return mutate();

  const snapshots = captureScrollSnapshots(cells);
  disableScrollAnchoring(snapshots);
  try {
    const result = mutate();
    restoreScrollPositions(snapshots);
    restoreAfterLayout(snapshots);
    return result;
  } catch (error) {
    restoreScrollPositions(snapshots);
    restoreScrollAnchoring(snapshots);
    throw error;
  }
}

function normalizeHandle(handle: string): string {
  return handle.trim().replace(/^@+/, '').toLowerCase();
}

function connectedUniqueCells(targets: Iterable<Element>): Element[] {
  const cells = new Set<Element>();
  for (const target of targets) {
    if (target.isConnected) cells.add(target);
  }
  return [...cells];
}

function captureScrollSnapshots(targets: readonly Element[]): ScrollSnapshot[] {
  const containers = new Set<HTMLElement>();
  const scrollingElement = document.scrollingElement;
  if (scrollingElement instanceof HTMLElement) {
    containers.add(scrollingElement);
  } else {
    containers.add(document.documentElement);
  }

  for (const target of targets) {
    for (let parent = target.parentElement; parent; parent = parent.parentElement) {
      if (isScrollableContainer(parent)) containers.add(parent);
    }
  }

  return [...containers].map((element) => ({
    element,
    top: element.scrollTop,
    left: element.scrollLeft,
    overflowAnchor: element.style.getPropertyValue('overflow-anchor'),
    overflowAnchorPriority: element.style.getPropertyPriority('overflow-anchor'),
  }));
}

function isScrollableContainer(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  return /(?:auto|scroll|overlay)/.test(`${style.overflow} ${style.overflowY}`);
}

function disableScrollAnchoring(snapshots: readonly ScrollSnapshot[]): void {
  for (const snapshot of snapshots) {
    snapshot.element.style.setProperty('overflow-anchor', 'none', 'important');
  }
}

function restoreScrollPositions(snapshots: readonly ScrollSnapshot[]): void {
  for (const snapshot of snapshots) {
    if (snapshot.element.scrollTop !== snapshot.top) {
      snapshot.element.scrollTop = snapshot.top;
    }
    if (snapshot.element.scrollLeft !== snapshot.left) {
      snapshot.element.scrollLeft = snapshot.left;
    }
  }
}

function restoreScrollAnchoring(snapshots: readonly ScrollSnapshot[]): void {
  for (const snapshot of snapshots) {
    if (snapshot.overflowAnchor) {
      snapshot.element.style.setProperty(
        'overflow-anchor',
        snapshot.overflowAnchor,
        snapshot.overflowAnchorPriority,
      );
    } else {
      snapshot.element.style.removeProperty('overflow-anchor');
    }
  }
}

function restoreAfterLayout(snapshots: readonly ScrollSnapshot[]): void {
  afterNextPaint(() => {
    restoreScrollPositions(snapshots);
    restoreScrollAnchoring(snapshots);
    afterNextPaint(() => restoreScrollPositions(snapshots));
  });
}

function afterNextPaint(callback: () => void): void {
  if (typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(() => callback());
    return;
  }
  window.setTimeout(callback, 0);
}

function blurFocusInside(targets: readonly Element[]): void {
  const activeElement = document.activeElement;
  if (!(activeElement instanceof HTMLElement)) return;
  if (targets.some((target) => target.contains(activeElement))) {
    activeElement.blur();
  }
}
