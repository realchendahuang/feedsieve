// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PageScanController,
  scanRevision,
  SCAN_DEBOUNCE_MS,
  type PendingBadge,
  type ScanCallbacks,
} from './page-scan-controller';

/** X 的 article 选择器（selectors.ts 同源，保证测试构造的 DOM 真的会被扫描）。 */
function tweetArticle(): Element {
  const article = document.createElement('article');
  article.setAttribute('data-testid', 'tweet');
  return article;
}

function setup(processOne?: ScanCallbacks['processOne']) {
  const processed: Array<{ article: Element; pending: number }> = [];
  const flushed: PendingBadge[][] = [];
  const health: Array<{ ok: boolean; reason?: string }> = [];
  /** 每次 scanDone 收到的「本轮扫过的节点」。 */
  const scannedBatches: Element[][] = [];
  const controller = new PageScanController({
    processOne:
      processOne ??
      ((article: Element, _context, pendingBadges: PendingBadge[]) => {
        processed.push({ article, pending: pendingBadges.length });
      }),
    flushBadges: (pending) => flushed.push([...pending]),
    scanDone: (scanned) => {
      scannedBatches.push([...scanned]);
    },
    noteHealth: (ok, reason) => health.push({ ok, reason }),
  });
  return {
    controller,
    processed,
    flushed,
    health,
    scannedBatches,
    scanDone: () => scannedBatches.length,
  };
}

/** 仅供测试：读私有索引（TS private 只是编译期约束）。 */
function indexOf(controller: PageScanController): Map<string, Set<Element>> {
  return (controller as unknown as { articlesByHandle: Map<string, Set<Element>> })
    .articlesByHandle;
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.replaceChildren();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('PageScanController', () => {
  it('family evidence invalidates only the affected author and requeues unchanged text', async () => {
    const ctx = setup();
    const first = tweetArticle();
    const second = tweetArticle();
    document.body.append(first, second);
    ctx.controller.remember(first, 'first');
    ctx.controller.remember(second, 'second');
    expect(ctx.controller.hasChanged(first, 'same-text')).toBe(true);
    expect(ctx.controller.hasChanged(second, 'same-text')).toBe(true);
    ctx.controller.invalidateHandle('first');
    expect(ctx.controller.hasChanged(first, 'same-text')).toBe(true);
    expect(ctx.controller.hasChanged(second, 'same-text')).toBe(false);
    await vi.advanceTimersByTimeAsync(SCAN_DEBOUNCE_MS);
    expect(ctx.processed.map((item) => item.article)).toEqual([first]);
    ctx.controller.dispose();
  });

  it('scanRevision 稳定且区分输入变化', () => {
    const item = {
      postId: '1800000000000000001',
      author: { handle: 'Spam_King', displayName: 'Spam King' },
      text: 'free crypto now',
      links: [{ href: 'https://x.com', hostname: 'x.com' }],
    };
    const a = scanRevision(item, 'bio1');
    expect(a).toBe(scanRevision({ ...item }, 'bio1'));
    expect(a).not.toBe(scanRevision(item, 'bio2'));
    expect(a).not.toBe(scanRevision({ ...item, postId: '1800000000000000002' }, 'bio1'));
  });

  it('markDirty + schedule：去抖后按分片处理、汇报健康并带上本轮扫过的节点', async () => {
    const ctx = setup();
    const article = tweetArticle();
    const unrelated = tweetArticle();
    document.body.append(article, unrelated); // 无关节点没标脏，不应进入扫描
    ctx.controller.markDirty(article);
    ctx.controller.schedule();
    expect(ctx.processed).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(SCAN_DEBOUNCE_MS);
    expect(ctx.processed.map((item) => item.article)).toEqual([article]);
    expect(ctx.health).toEqual([{ ok: true }]);
    // 整页装饰（AI 标签按遍历顺序判断）在扫完之后才跑一次
    expect(ctx.scanDone()).toBe(1);
    // scanDone 带上这一轮只处理过的节点：调用方不必整页重新解析
    expect(ctx.scannedBatches).toEqual([[article]]);
    expect(ctx.scannedBatches[0]).not.toContain(unrelated);
  });

  it('scanDone 汇总跨轮次处理过的节点，且只调用一次', async () => {
    const extra = tweetArticle();
    const ctx = setup((article: Element, _context, pendingBadges: PendingBadge[]) => {
      // 第一轮扫描时又标脏（模拟扫描过程中 observer 命中新节点）
      if (ctx.processed.length === 0) ctx.controller.markDirty(extra);
      ctx.processed.push({ article, pending: pendingBadges.length });
    });
    const first = tweetArticle();
    document.body.append(first, extra);
    ctx.controller.markDirty(first);
    ctx.controller.schedule();
    await vi.advanceTimersByTimeAsync(SCAN_DEBOUNCE_MS);
    await vi.advanceTimersByTimeAsync(SCAN_DEBOUNCE_MS);
    expect(ctx.processed).toHaveLength(2);
    expect(ctx.scannedBatches).toHaveLength(1);
    expect(ctx.scannedBatches[0]).toEqual([first, extra]);
  });

  it('没有脏节点时不会触发 scanDone', async () => {
    const ctx = setup();
    await vi.advanceTimersByTimeAsync(SCAN_DEBOUNCE_MS);
    expect(ctx.scanDone()).toBe(0);
  });

  it('显式调度但脏集合为空时也回调 scanDone（传空数组）：整页装饰靠它做巡检', async () => {
    const ctx = setup();
    ctx.controller.schedule();
    await vi.advanceTimersByTimeAsync(SCAN_DEBOUNCE_MS);
    expect(ctx.scanDone()).toBe(1);
    expect(ctx.scannedBatches).toEqual([[]]);
  });

  it('schedule 在已排程时去重；执行中再次标脏会自动续扫', async () => {
    const ctx = setup((article, _context, pendingBadges: PendingBadge[]) => {
      // 第一次扫描时又标脏（模拟扫描过程中 observer 命中新节点）
      if (ctx.processed.length === 0) ctx.controller.markDirty(tweetArticle());
      ctx.processed.push({ article, pending: pendingBadges.length });
    });
    ctx.controller.markDirty(tweetArticle());
    ctx.controller.schedule();
    ctx.controller.schedule(); // 去重

    await vi.advanceTimersByTimeAsync(SCAN_DEBOUNCE_MS);
    // 续扫发生在收尾：再推一个去抖周期才对等
    await vi.advanceTimersByTimeAsync(SCAN_DEBOUNCE_MS);
    expect(ctx.processed).toHaveLength(2);
  });

  it('hasChanged/dropSnapshot 管理 revision 快照（虚拟列表复用节点）', () => {
    const controller = new PageScanController({
      processOne: () => undefined,
      flushBadges: () => undefined,
      noteHealth: () => undefined,
    });
    const article = tweetArticle();
    expect(controller.hasChanged(article, 'r1')).toBe(true);
    expect(controller.hasChanged(article, 'r1')).toBe(false);
    expect(controller.hasChanged(article, 'r2')).toBe(true);
    controller.dropSnapshot(article);
    expect(controller.hasChanged(article, 'r2')).toBe(true); // 快照被清后重新渲染
  });

  it('remember / cellsForHandle 顺手剔除已被虚拟列表回收的节点', () => {
    const ctx = setup();
    const live = tweetArticle();
    const reclaimed = tweetArticle();
    document.body.append(live, reclaimed);
    ctx.controller.remember(live, 'spam');
    ctx.controller.remember(reclaimed, 'spam');
    expect(indexOf(ctx.controller).get('spam')?.size).toBe(2);

    // 虚拟列表把其中一个 cell 移出 DOM
    reclaimed.remove();
    // 同 handle 的下一条卡片登记时，顺手清掉已回收的旧条目（不额外多一次遍历）
    const fresh = tweetArticle();
    document.body.append(fresh);
    ctx.controller.remember(fresh, 'spam');
    const indexed = indexOf(ctx.controller).get('spam');
    expect(indexed?.size).toBe(2);
    expect(indexed?.has(reclaimed)).toBe(false);
    expect(indexed?.has(live)).toBe(true);
    expect(indexed?.has(fresh)).toBe(true);

    // 全部回收后，下一次按 handle 取 cell 时把空 Set 一并删掉
    live.remove();
    fresh.remove();
    expect(ctx.controller.cellsForHandle('spam')).toEqual([]);
    expect(indexOf(ctx.controller).has('spam')).toBe(false);
  });

  it('forget 清掉空 Set，索引不残留空 handle', () => {
    const ctx = setup();
    const article = tweetArticle();
    document.body.append(article);
    ctx.controller.remember(article, 'spam');
    ctx.controller.forget(article);
    expect(indexOf(ctx.controller).has('spam')).toBe(false);
  });

  it('fullRescan 与扫描收尾会清掉没人再扫到的回收节点', async () => {
    const ctx = setup();
    const gone = tweetArticle();
    const cached = tweetArticle();
    document.body.append(gone, cached);
    ctx.controller.remember(gone, 'alpha');
    ctx.controller.remember(cached, 'beta');

    // 全页重扫前先回收索引：alpha 已被虚拟列表移出 DOM，beta 还在
    gone.remove();
    ctx.controller.fullRescan();
    expect(indexOf(ctx.controller).has('alpha')).toBe(false);
    expect(indexOf(ctx.controller).has('beta')).toBe(true);

    // beta 也回收：扫描收尾统一清理，索引归零
    cached.remove();
    ctx.controller.fullRescan();
    await vi.advanceTimersByTimeAsync(SCAN_DEBOUNCE_MS);
    expect(indexOf(ctx.controller).size).toBe(0);
  });

  it('observer 忽略插件自己的 .fs-* 元素，页面内容变化才标脏', async () => {
    const ctx = setup();
    document.body.innerHTML = '<main></main>';
    ctx.controller.observe(document.body);

    // 插件自己的徽章/按钮变化：不产生扫描（反馈环防护）
    const badge = document.createElement('div');
    badge.className = 'fs-badge';
    document.body.querySelector('main')!.append(badge);
    await vi.advanceTimersByTimeAsync(SCAN_DEBOUNCE_MS);
    expect(ctx.processed).toHaveLength(0);

    // 真实推文节点变化：标脏并调度
    const article = tweetArticle();
    document.body.querySelector('main')!.append(article);
    await vi.advanceTimersByTimeAsync(SCAN_DEBOUNCE_MS);
    expect(ctx.processed).toHaveLength(1);
    expect(ctx.processed[0]?.article).toBe(article);
  });

  it('fullRescan 全量入队并调度', async () => {
    const ctx = setup();
    document.body.append(tweetArticle(), tweetArticle());
    ctx.controller.fullRescan();
    await vi.advanceTimersByTimeAsync(SCAN_DEBOUNCE_MS);
    expect(ctx.processed).toHaveLength(2);
  });

  it('flushBadges 以批次形式透传给宿主', async () => {
    const ctx = setup();
    ctx.controller.markDirty(tweetArticle());
    ctx.controller.schedule();
    await vi.advanceTimersByTimeAsync(SCAN_DEBOUNCE_MS);
    expect(ctx.flushed).toHaveLength(1);
  });
});
