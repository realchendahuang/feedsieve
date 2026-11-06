/**
 * 页面扫描控制器：content script 的「扫描什么、什么节奏扫」唯一职责。
 *
 * 检测 / 标注 / 装饰由宿主（content.ts）通过 callbacks 注入，这里不持有任何检测逻辑。
 * 所有状态（脏集合、revision 快照、handle 倒排索引、调度计时、Observer）收敛在本模块，
 * 避免分散在 content script 闭包里各自为政。
 */

import { contextFromPath, extractFeedItem, tweetSelectors } from '@feedsieve/x-adapter';
import { INSIGHT_DECORATION_SELECTOR } from '../insight/decorations';

/**
 * 插件自己插进页面的节点：Observer 必须忽略它们的增删与内部变化，
 * 否则每次插入都会把所在推文标脏、触发重扫，形成反馈环。
 */
const OWN_DECORATION_SELECTOR = `.fs-badge, .fs-manual-mark, [data-fs-action], .fs-ai-mark, .fs-ai-foldbar, [data-fs-ai-tab], ${INSIGHT_DECORATION_SELECTOR}`;

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
  /**
   * 这一轮脏节点扫完了。给「要按整页顺序判断」的装饰用（AI 味：主帖 / 楼上祖先帖 /
   * 主帖作者要靠遍历顺序区分），它们不必自己再起一个全页轮询。
   *
   * scanned 是本轮 processDirty 实际处理过的 article（跨分片、跨 while 轮次累积；
   * 没有脏节点时是空数组）。调用方只装饰这批节点即可，不必再整页重新解析。
   */
  scanDone?(scanned: readonly Element[]): void;
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
    // 先清掉上一轮已经被虚拟列表回收的节点；全页重扫是长会话里
    // 最稳定的「顺带回收」时机（路由/设置变化之外很少触发）
    this.pruneDisconnected();
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
    }
    this.pruneHandle(handle);
  }

  /** Evidence for a template changed: invalidate only its currently rendered authors. */
  invalidateHandle(handle: string): void {
    for (const article of this.articlesByHandle.get(handle) ?? []) {
      if (!article.isConnected) continue;
      this.snapshots.delete(article);
      this.dirtyArticles.add(article);
    }
    this.pruneHandle(handle);
    this.schedule();
  }

  /** handle ↔ 节点索引维护（scanOne 提取后登记）。返回被复用前的 handle。 */
  remember(article: Element, handle: string): string | undefined {
    const previous = this.articleHandles.get(article);
    if (previous && previous !== handle) {
      const previousSet = this.articlesByHandle.get(previous);
      previousSet?.delete(article);
      if (previousSet?.size === 0) this.articlesByHandle.delete(previous);
      // 节点被复用成另一条推文：旧 revision 必须作废，否则同作者同文本会被当成「已标注」跳过。
      this.snapshots.delete(article);
    }
    this.articleHandles.set(article, handle);
    // 同一 handle 之前渲染的卡片里可能已有被回收的：顺手清掉再登记
    this.pruneHandle(handle);
    const set = this.articlesByHandle.get(handle) ?? new Set<Element>();
    set.add(article);
    this.articlesByHandle.set(handle, set);
    return previous && previous !== handle ? previous : undefined;
  }

  /** 节点被虚拟列表回收 / 提取失败：清理快照与索引。 */
  forget(article: Element): void {
    this.snapshots.delete(article);
    // 已经断开连接的节点不必再排进下一轮扫描
    this.dirtyArticles.delete(article);
    const stale = this.articleHandles.get(article);
    if (!stale) return;
    const set = this.articlesByHandle.get(stale);
    set?.delete(article);
    if (set?.size === 0) this.articlesByHandle.delete(stale);
  }

  /**
   * 剔除某个 handle 名下已被虚拟列表回收的卡片。
   *
   * articlesByHandle 的 Set 持有 Element 强引用：cell 被虚拟列表移出 DOM 后
   * 没有任何自动清理路径，长会话（无限滚动）里索引只增不减。这里在所有
   * 「本来就要遍历这个 handle」的入口顺手清理，不额外增加遍历成本。
   */
  private pruneHandle(handle: string): void {
    const indexed = this.articlesByHandle.get(handle);
    if (!indexed) return;
    for (const article of indexed) {
      if (!article.isConnected) indexed.delete(article);
    }
    if (indexed.size === 0) this.articlesByHandle.delete(handle);
  }

  /** 全量清理回收节点：之后没人再扫到的 handle 也要能随 GC 释放。 */
  private pruneDisconnected(): void {
    for (const handle of [...this.articlesByHandle.keys()]) this.pruneHandle(handle);
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
    // 批量队列每个 handle 都会调到这里：索引里的回收节点顺手清掉
    this.pruneHandle(normalized);
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
        if (target?.closest(OWN_DECORATION_SELECTOR)) continue;
        let touched = false;
        for (const node of mutation.addedNodes) {
          if (
            node instanceof Element &&
            (node.matches(OWN_DECORATION_SELECTOR) || node.closest(OWN_DECORATION_SELECTOR))
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
              (node.matches(OWN_DECORATION_SELECTOR) || node.closest(OWN_DECORATION_SELECTOR))
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
    /** 本轮真正过了一遍 processOne 的节点（跨分片累积），随 scanDone 交给整页装饰。 */
    const scanned: Element[] = [];
    while (this.dirtyArticles.size > 0) {
      const batch = [...this.dirtyArticles];
      this.dirtyArticles.clear();
      const context = contextFromPath(location.pathname);
      const pendingBadges: PendingBadge[] = [];
      let chunkStartedAt = performance.now();
      for (let index = 0; index < batch.length; index++) {
        const article = batch[index]!;
        this.callbacks.processOne(article, context, pendingBadges);
        scanned.push(article);
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
    // 本轮处理完再清一遍索引：剩下的 !isConnected 都是虚拟列表已经回收的节点，
    // 不会再被扫到，留着只会占内存
    this.pruneDisconnected();
    this.callbacks.scanDone?.(scanned);
  }
}
