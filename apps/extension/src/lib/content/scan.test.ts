// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeCommunity } from '../community/community-store';
import { recordDetection } from '../detection/detection-log';
import { PageScanController, SCAN_DEBOUNCE_MS } from '../detection/page-scan-controller';
import { bumpStat } from '../stats/local-stats';
import { createBadges } from './badges';
import { createManualActions } from './manual-actions';
import { createContentState, MARK_ATTRIBUTE } from './page-state';
import { createScan } from './scan';

// 随包名单在测试里永不落地：避免 createScan 启动时触发 controller.reset() + 全页重扫，
// 打乱用例里的 dirty / 快照状态。
vi.mock('../community/community-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../community/community-store')>();
  return { ...actual, getBundledEntries: () => new Promise<unknown[]>(() => {}) };
});
vi.mock('../detection/detection-log', () => ({ recordDetection: vi.fn(async () => {}) }));
vi.mock('../stats/local-stats', () => ({ bumpStat: vi.fn(async () => {}) }));
vi.mock('../stats/daily-stats', () => ({ bumpDaily: vi.fn(async () => {}) }));

function community(handles: string[] = []): RuntimeCommunity {
  return {
    index: { version: 'test', size: 0, lookup: () => null },
    handleSet: new Set(handles),
    whitelistSet: new Set(),
    verifiedSet: new Set(),
    fingerprintSet: new Set(),
    domainSet: new Set(),
    campaignById: new Map(),
    campaignByFingerprint: new Map(),
    version: 'test',
    mutedRules: new Set(),
  } as unknown as RuntimeCommunity;
}

/** 按 X 的真实结构拼一条推文 + 外层时间线格子。 */
function tweet(options: { handle: string; postId: string; text: string }): {
  cell: HTMLElement;
  article: HTMLElement;
} {
  const cell = document.createElement('div');
  cell.setAttribute('data-testid', 'cellInnerDiv');
  const article = document.createElement('article');
  article.setAttribute('data-testid', 'tweet');
  article.innerHTML = [
    `<div data-testid="User-Name"><a href="/${options.handle}">${options.handle}</a>` +
      `<a href="/${options.handle}">@${options.handle}</a></div>`,
    `<div data-testid="tweetText">${options.text}</div>`,
    `<a href="/${options.handle}/status/${options.postId}">` +
      '<time datetime="2026-11-01T00:00:00.000Z">Nov 1</time></a>',
    '<div role="group"><button data-testid="like">1</button></div>',
  ].join('');
  cell.append(article);
  document.body.append(cell);
  return { cell, article };
}

function setup(options: { communityHandles?: string[] } = {}) {
  const state = createContentState();
  if (options.communityHandles) state.community = community(options.communityHandles);
  // 回调与 scan 互相引用：先建控制器，scan 建好后再回填
  const wired: { scan?: ReturnType<typeof createScan> } = {};
  const controller = new PageScanController({
    processOne: (article, context, pendingBadges) =>
      wired.scan?.scanOne(article, context, pendingBadges),
    flushBadges: (pendingBadges) => badges.flushPendingBadges(pendingBadges),
    noteHealth: () => undefined,
  });
  const fold = { shouldFoldBlockedTweets: () => true } as unknown as Parameters<
    typeof createManualActions
  >[0]['fold'];
  const manual = createManualActions({
    state,
    blockOne: vi.fn(async () => ({ ok: true as const })) as never,
    fold,
  });
  const badges = createBadges({ state, runBlockNow: manual.runBlockNow });
  const scan = createScan({ state, controller, fold, badges, manual });
  wired.scan = scan;
  return { state, controller, badges, manual, scan };
}

/** 走生产路径：标脏 → 去抖 → PageScanController 分片扫描。 */
async function scanOnce(controller: PageScanController, article: Element): Promise<void> {
  controller.markDirty(article);
  controller.schedule();
  await vi.advanceTimersByTimeAsync(SCAN_DEBOUNCE_MS);
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.replaceChildren();
  // notifyPageMarkedChanged 会延迟 100ms 发 runtime 消息（标记变化广播）
  vi.stubGlobal('browser', { runtime: { sendMessage: vi.fn(async () => undefined) } });
  vi.mocked(recordDetection).mockClear();
  vi.mocked(bumpStat).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('scanOne：X 重渲染后的装饰自愈', () => {
  it('徽章被 X 冲掉后，下一轮扫描把黄框徽章补回来（不重复计新命中）', async () => {
    const ctx = setup({ communityHandles: ['spam_bot'] });
    const { cell, article } = tweet({
      handle: 'spam_bot',
      postId: '111',
      text: 'free crypto now',
    });

    await scanOnce(ctx.controller, article);
    expect(cell.hasAttribute(MARK_ATTRIBUTE)).toBe(true);
    const badges = cell.querySelectorAll('.fs-badge');
    expect(badges).toHaveLength(1);
    expect(vi.mocked(recordDetection)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(bumpStat)).toHaveBeenCalledTimes(1);

    // X 重渲染：把我们插的徽章冲掉，cell / article 节点本身还在
    badges[0]!.remove();
    expect(cell.querySelector('.fs-badge')).toBeNull();

    await scanOnce(ctx.controller, article);
    expect(cell.querySelectorAll('.fs-badge')).toHaveLength(1);
    // 重建不是新命中：检测日志与统计都不重复
    expect(vi.mocked(recordDetection)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(bumpStat)).toHaveBeenCalledTimes(1);
  });

  it('动作栏被 X 重渲染后，下一轮扫描把手动拉黑按钮补回来', async () => {
    const ctx = setup();
    const { article } = tweet({ handle: 'normal_user', postId: '333', text: 'hello there' });

    await scanOnce(ctx.controller, article);
    expect(article.querySelectorAll('[data-fs-manual-action]')).toHaveLength(1);

    // X 重渲染动作栏：整排原生按钮换新，我们插进去的格子一起没了
    article.querySelector('[role="group"]')!.innerHTML = '<button data-testid="like">1</button>';
    expect(article.querySelector('[data-fs-manual-action]')).toBeNull();

    await scanOnce(ctx.controller, article);
    expect(article.querySelectorAll('[data-fs-manual-action]')).toHaveLength(1);
  });

  it('同作者的 cell 被复用给另一条推文时，旧黄框与理由徽章不会留在新推文下', async () => {
    const ctx = setup();
    // 关键词规则只命中第一条正文：同一作者的第二条推文是干净的
    ctx.state.keywordHeuristics = [
      {
        id: 'keyword:custom:test',
        check: (input: { text?: string }) =>
          input.text?.includes('free crypto') ? '自定义词命中' : null,
      },
    ] as unknown as typeof ctx.state.keywordHeuristics;
    const { cell, article } = tweet({
      handle: 'spam_bot',
      postId: '111',
      text: 'free crypto now',
    });

    await scanOnce(ctx.controller, article);
    expect(cell.hasAttribute(MARK_ATTRIBUTE)).toBe(true);
    expect(cell.querySelectorAll('.fs-badge')).toHaveLength(1);

    // X 把同一个 cell / article 复用给同作者的新推文（新 postId、干净内容）
    article.innerHTML = [
      '<div data-testid="User-Name"><a href="/spam_bot">spam_bot</a></div>',
      '<div data-testid="tweetText">just saying hi</div>',
      '<a href="/spam_bot/status/222"><time datetime="2026-11-02T00:00:00.000Z">Nov 2</time></a>',
      '<div role="group"><button data-testid="like">1</button></div>',
    ].join('');
    await scanOnce(ctx.controller, article);

    expect(cell.hasAttribute(MARK_ATTRIBUTE)).toBe(false);
    expect(cell.querySelectorAll('.fs-badge')).toHaveLength(0);
  });
});
