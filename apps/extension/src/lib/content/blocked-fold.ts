/**
 * 已拉黑账号推文的页面折叠：
 * - shouldFoldBlockedTweets：折叠与否的页面归属豁免判定
 * - collectCellsForHandle：按 handle 取当前页面 cell（PageScanController 反向索引加速）
 * - hideNewlyBlockedCells：拉黑名单新增后折叠对应账号的 cell
 */

import { contextFromPath, extractHandleFromPath } from '@feedsieve/x-adapter';
import { hideCellsSoon } from '../platform/remove-tweets';
import type { PageScanController } from '../detection/page-scan-controller';

export function createBlockedFold(controller: PageScanController) {
  /**
   * 已拉黑回显折叠的页面归属豁免：用户主动点进被拉黑者的主页 = 明确想看他，
   * X 原生在这种页面也照常显示推文；若整页折叠，时间线可视高度归零，虚拟列表
   * 视口恒空会持续补页，形成「新 cell 挂载 → 去抖后折叠」的自激循环（闪屏）。
   * 只豁免页面归属人本人的推文（按推文作者逐条判断），其主页里其他作者的
   * 推文（with_replies / media tab）照常折叠。
   */
  function shouldFoldBlockedTweets(handle: string): boolean {
    if (contextFromPath(location.pathname) !== 'profile') return true;
    return extractHandleFromPath(location.pathname) !== handle;
  }

  /**
   * 索引优先地收集某账号当前页面的 cell：先查扫描维护的 handle 反向索引，
   * 再补上尚未入索引的 dirty article；候选逐一用 extractFeedItem 复核。
   * 批量拉黑队列每个 handle 都要取一次 cell，全页版会放大成 N 次整页扫描。
   * 索引与脏集合都收敛在 PageScanController，这里只做端口。
   */
  function collectCellsForHandle(handle: string): Element[] {
    return controller.cellsForHandle(handle);
  }

  function hasPendingBlockFeedback(cells: readonly Element[]): boolean {
    return cells.some(
      (cell) => cell.querySelector('.fs-block-now:disabled, .fs-manual-mark:disabled') !== null,
    );
  }

  function hideNewlyBlockedCells(handles: ReadonlySet<string>): void {
    for (const handle of handles) {
      if (!shouldFoldBlockedTweets(handle)) continue;
      const cells = collectCellsForHandle(handle);
      // 当前 tab 正在给这个账号展示「拉黑中 / 已拉黑」反馈时，让调用方维持原有
      // 650ms 反馈窗口；其它 tab 或页面刷新后的同步则立即隐藏。
      if (cells.length === 0 || hasPendingBlockFeedback(cells)) continue;
      hideCellsSoon(cells, 0);
    }
  }

  return { shouldFoldBlockedTweets, collectCellsForHandle, hideNewlyBlockedCells };
}

export type BlockedFold = ReturnType<typeof createBlockedFold>;
