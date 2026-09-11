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
  const controller = new PageScanController({
    processOne:
      processOne ??
      ((article: Element, _context, pendingBadges: PendingBadge[]) => {
        processed.push({ article, pending: pendingBadges.length });
      }),
    flushBadges: (pending) => flushed.push([...pending]),
    noteHealth: (ok, reason) => health.push({ ok, reason }),
  });
  return { controller, processed, flushed, health };
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

  it('markDirty + schedule：去抖后按分片处理并汇报健康', async () => {
    const ctx = setup();
    ctx.controller.markDirty(tweetArticle());
    ctx.controller.schedule();
    expect(ctx.processed).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(SCAN_DEBOUNCE_MS);
    expect(ctx.processed).toHaveLength(1);
    expect(ctx.health).toEqual([{ ok: true }]);
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