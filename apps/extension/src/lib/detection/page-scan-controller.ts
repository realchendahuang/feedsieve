/**
 * 页面扫描控制器：content script 的「扫描什么、什么节奏扫」唯一职责。
 *
 * 检测 / 标注 / 装饰由宿主（content.ts）通过 callbacks 注入，这里不持有任何检测逻辑。
 * 所有状态（脏集合、revision 快照、handle 倒排索引、调度计时、Observer）收敛在本模块，
 * 避免分散在 content script 闭包里各自为政。
 */

import { contextFromPath, extractFeedItem, tweetSelectors } from '@feedsieve/x-adapter';

/** mutation 停止后到扫描的固定间隔。 */
export const SCAN_DEBOUNCE_MS = 300;
/** 单次分片的同步工作预算：略小于一帧，超了就让出主线程。 */
export const SCAN_CHUNK_BUDGET_MS = 8;

export interface PendingBadge {
  cell: HTMLElement;
  badge: HTMLElement;
}

export interface ScanCallbacks {
  /** 处理单个 article：提取 → 检测 → 产出一个待插徽章（或什么都不做）。 */
  processOne(
    article: Element,
    context: ReturnType<typeof contextFromPath>,
    pendingBadges: PendingBadge[],
  ): void;
  /** 批量插入待插徽章（DOM 批量插入减少滚动锚定抖动）。 */
  flushBadges(pendingBadges: PendingBadge[]): void;
  /** 扫描正常 / 失败的心跳（X 能力快照 timelineParsing 的输入）。 */
  noteHealth(ok: boolean, reason?: string): void;
}

/** 虚拟列表节点复用时的 revision 快照（bio 变化由 markDirtyForBio 主动作废）。 */
export function scanRevision(
  item: {
    postId?: string | null;
    author: { handle: string; displayName?: string };
    text: string;
    links: { href: string; hostname?: string }[];
  },
  bio: string | undefined,
): string {
  return [
    item.postId ?? '',
    item.author.handle.toLowerCase(),
    item.author.displayName ?? '',
    item.text,
    bio ?? '',
    item.links.map((link) => `${link.href}|${link.hostname ?? ''}`).join(''),
  ].join('');
}

export class PageScanController {
  private readonly dirtyArticles = new Set<Element>();
  private snapshots = new WeakMap<Element, string>();
  private readonly articlesByHandle = new Map<string, Set<Element>>();
  private readonly articleHandles = new WeakMap<Element, string>();
  private scanRunning = false;
  private scanTimer: number | undefined;
  private observer: MutationObserver | null = null;
  private readonly callbacks: ScanCallbacks;

  constructor(callbacks: ScanCallbacks) {
    this.callbacks = callbacks;
  }

  /** 去抖调度：固定间隔（不因后续 mutation 反复顺延），配合分片摊薄工作。 */
  schedule(): void {
    if (this.scanRunning || this.scanTimer !== undefined) return;
    this.scanTimer = window.setTimeout(() => {
      void this.runScan();
    }, SCAN_DEBOUNCE_MS);
  }

  /** 显式全页重扫：启动、SPA 路由切换、设置/名单/语言变化。 */
  fullRescan(): void {
    this.fullRescanArticles();
    this.schedule();
  }

  private fullRescanArticles(): void {
    for (const article of document.querySelectorAll(tweetSelectors.article)) {
      this.dirtyArticles.add(article);
    }
  }

  /** 单个节点标脏（observer / 外部主动触发）。 */
  markDirty(article: Element): void {
    this.dirtyArticles.add(article);
  }

  /** bio 有权威更新：只作废该 handle 受影响、仍连接的卡片。 */
  markDirtyForBio(handle: string): void {
    const indexed = this.articlesByHandle.get(handle);
    if (!indexed) return;
    for (const article of indexed) {
      if (article.isConnected) this.dirtyArticles.add(article);
      else indexed.delete(article);
    }
  }

  /** handle ↔ 节点索引维护（scanOne 提取后登记）。 */
  remember(article: Element, handle: string): void {
    const previous = this.articleHandles.get(article);
    if (previous && previous !== handle) {
      const previousSet = this.articlesByHandle.get(previous);
      previousSet?.delete(article);
      if (previousSet?.size === 0) this.articlesByHandle.delete(previous);
    }
    this.articleHandles.set(article, handle);
    const set = this.articlesByHandle.get(handle) ?? new Set<Element>();
    set.add(article);
    this.articlesByHandle.set(handle, set);
  }

  /** 节点被虚拟列表回收 / 提取失败：清理快照与索引。 */
  forget(article: Element): void {
    this.snapshots.delete(article);
    const stale = this.articleHandles.get(article);
    if (stale) {
      const set = this.articlesByHandle.get(stale);
      set?.delete(article);
      if (set?.size === 0) this.articlesByHandle.delete(stale);
    }
  }

  /** 只清 revision 快照（提取失败路径：索引保持）。 */
  dropSnapshot(article: Element): void {
    this.snapshots.delete(article);
  }

  /** revision 已渲染则返回 false；否则记录新快照并返回 true（需要重新标注）。 */
  hasChanged(article: Element, revision: string): boolean {
    const current = this.snapshots.get(article);
    if (current === revision) return false;
    this.snapshots.set(article, revision);
    return true;
  }

  /** 页面级重置（名单/设置变化重建装饰时）。 */
  reset(): void {
    this.snapshots = new WeakMap();
  }

  /**
   * 按 handle 找应隐藏的 cell：已知索引 + 脏集合交叉校验（重新解析防止索引漂移）。
   * 批量队列每个 handle 都要调一次；用索引避免整页扫描。
   */
  cellsForHandle(handle: string): Element[] {
    const normalized = handle.trim().replace(/^@+/, '').toLowerCase();
    if (!normalized) return [];
    const context = contextFromPath(location.pathname);
    const candidates = new Set<Element>();
    for (const article of this.articlesByHandle.get(normalized) ?? []) {
      candidates.add(article);
    }
    for (const article of this.dirtyArticles) {
      candidates.add(article);
    }
    const cells = new Set<Element>();
    for (const article of candidates) {
      if (!article.isConnected) continue;
      if (extractFeedItem(article, context)?.author.handle.toLowerCase() !== normalized) continue;
      cells.add(article.closest(tweetSelectors.timelineCell) ?? article);
    }
    return [...cells];
  }

  /** 监听页面变化；只标脏页面节点，忽略插件自己的徽章/按钮，避免反馈环。 */
  observe(root: Node): void {
    if (this.observer) this.observer.disconnect();
    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        const target =
          mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
        if (target?.closest('.fs-badge, .fs-manual-mark')) continue;
        let touched = false;
        for (const node of mutation.addedNodes) {
          if (
            node instanceof Element &&
            (node.matches('.fs-badge, .fs-manual-mark') ||
              node.closest('.fs-badge, .fs-manual-mark'))
          ) {
            continue;
          }
          touched = true;
          if (!(node instanceof Element)) continue;
          if (node.matches(tweetSelectors.article)) this.dirtyArticles.add(node);
          for (const nested of node.querySelectorAll(tweetSelectors.article)) {
            this.dirtyArticles.add(nested);
          }
        }
        if (!touched) {
          for (const node of mutation.removedNodes) {
            if (
              node instanceof Element &&
              (node.matches('.fs-badge, .fs-manual-mark') ||
                node.closest('.fs-badge, .fs-manual-mark'))
            ) {
              continue;
            }
            touched = true;
            break;
          }
        }
        if (!touched) continue;
        const article = target?.closest(tweetSelectors.article);
        if (article) this.dirtyArticles.add(article);
      }
      if (this.dirtyArticles.size > 0) this.schedule();
    });
    this.observer.observe(root, { childList: true, subtree: true });
  }

  dispose(): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.scanTimer !== undefined) {
      window.clearTimeout(this.scanTimer);
      this.scanTimer = undefined;
    }
  }

  private async runScan(): Promise<void> {
    this.scanTimer = undefined;
    if (this.scanRunning) return;
    this.scanRunning = true;
    try {
      await this.processDirty();
      this.callbacks.noteHealth(true);
    } catch {
      this.callbacks.noteHealth(false, 'scan_failed');
    } finally {
      this.scanRunning = false;
      // 扫描期间又标了脏：立即续扫，不再等一个去抖周期
      if (this.dirtyArticles.size > 0) this.schedule();
    }
  }

  private async processDirty(): Promise<void> {
    while (this.dirtyArticles.size > 0) {
      const batch = [...this.dirtyArticles];
      this.dirtyArticles.clear();
      const context = contextFromPath(location.pathname);
      const pendingBadges: PendingBadge[] = [];
      let chunkStartedAt = performance.now();
      for (let index = 0; index < batch.length; index++) {
        this.callbacks.processOne(batch[index]!, context, pendingBadges);
        // 每片不超过单帧预算，之间让出主线程：长评论区的一次扫描
        // 不再整块卡住滚动与输入。
        if (
          performance.now() - chunkStartedAt >= SCAN_CHUNK_BUDGET_MS &&
          index < batch.length - 1
        ) {
          await new Promise<void>((resolve) => {
            window.setTimeout(resolve, 0);
          });
          chunkStartedAt = performance.now();
        }
      }
      this.callbacks.flushBadges(pendingBadges);
    }
  }
}