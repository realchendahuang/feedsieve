// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Detection } from '@feedsieve/detector';
import type { PendingBadge } from '../detection/page-scan-controller';
import { bumpStat } from '../stats/local-stats';
import { createBadges, markedForOtherPost } from './badges';
import type { ManualActions } from './manual-actions';
import { createContentState, MARK_ATTRIBUTE } from './page-state';

vi.mock('../stats/local-stats', () => ({ bumpStat: vi.fn(async () => {}) }));
vi.mock('../stats/daily-stats', () => ({ bumpDaily: vi.fn(async () => {}) }));

function detection(overrides: Partial<Detection> = {}): Detection {
  return {
    handle: 'spam_bot',
    marked: true,
    source: 'community-list',
    reason: '社区名单',
    ruleId: 'list',
    ...overrides,
  };
}

function setup() {
  const state = createContentState();
  const badges = createBadges({
    state,
    runBlockNow: vi.fn(async () => undefined) as unknown as ManualActions['runBlockNow'],
  });
  return { state, badges };
}

function cell(): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('data-testid', 'cellInnerDiv');
  document.body.append(el);
  return el;
}

beforeEach(() => {
  document.body.replaceChildren();
  vi.mocked(bumpStat).mockClear();
  // notifyPageMarkedChanged 会延迟 100ms 发 runtime 消息；这里只是不让它抛错
  vi.stubGlobal('browser', { runtime: { sendMessage: vi.fn(async () => undefined) } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('markCell：格子被复用后的标注归属', () => {
  it('同一 cell 复用给同作者的另一条推文：旧徽章被替换，标记带上新 postId', () => {
    const { badges } = setup();
    const target = cell();

    const first: PendingBadge[] = [];
    badges.markCell(
      target,
      detection({ reason: '旧理由' }),
      'other',
      {},
      first,
      '旧正文',
      'Spam Bot',
      '111',
    );
    badges.flushPendingBadges(first);
    expect(target.querySelector('.fs-badge')?.textContent).toContain('旧理由');
    expect(target.getAttribute(MARK_ATTRIBUTE)).toBe('community-list|111');
    expect(vi.mocked(bumpStat)).toHaveBeenCalledTimes(1);

    const second: PendingBadge[] = [];
    badges.markCell(
      target,
      detection({ reason: '新理由' }),
      'other',
      {},
      second,
      '新正文',
      'Spam Bot',
      '222',
    );
    badges.flushPendingBadges(second);

    // 旧徽章必须先被清掉：否则 buildBadge 见到已有 .fs-badge 会跳过，新推文顶着旧理由
    const rendered = target.querySelectorAll('.fs-badge');
    expect(rendered).toHaveLength(1);
    expect(rendered[0]?.textContent).toContain('新理由');
    expect(rendered[0]?.textContent).not.toContain('旧理由');
    expect(target.getAttribute(MARK_ATTRIBUTE)).toBe('community-list|222');
    // 另一条推文是新的命中，照常计数
    expect(vi.mocked(bumpStat)).toHaveBeenCalledTimes(2);
  });

  it('同一条推文的装饰被冲掉后重建：不重复计入检测统计', () => {
    const { badges } = setup();
    const target = cell();

    const first: PendingBadge[] = [];
    badges.markCell(target, detection(), 'other', {}, first, undefined, undefined, '111');
    badges.flushPendingBadges(first);
    expect(vi.mocked(bumpStat)).toHaveBeenCalledTimes(1);

    // X 冲掉徽章，扫描判定输入没变（countAsNew=false），只重建装饰
    target.querySelector('.fs-badge')?.remove();
    const rebuild: PendingBadge[] = [];
    badges.markCell(target, detection(), 'other', {}, rebuild, undefined, undefined, '111', false);
    badges.flushPendingBadges(rebuild);

    expect(target.querySelectorAll('.fs-badge')).toHaveLength(1);
    expect(vi.mocked(bumpStat)).toHaveBeenCalledTimes(1);
  });

  it('markedForOtherPost 只在 postId 变化时成立（无标记 / 旧格式不误判）', () => {
    const target = cell();
    expect(markedForOtherPost(target, '111')).toBe(false);

    // 旧版本的标记值只有来源、没有 postId：没有可比对象，不误删装饰
    target.setAttribute(MARK_ATTRIBUTE, 'community-list');
    expect(markedForOtherPost(target, '111')).toBe(false);

    target.setAttribute(MARK_ATTRIBUTE, 'community-list|111');
    expect(markedForOtherPost(target, '111')).toBe(false);
    expect(markedForOtherPost(target, '222')).toBe(true);
    // 拿不到当前推文 id（卡片类）时不判断
    expect(markedForOtherPost(target, undefined)).toBe(false);
    expect(markedForOtherPost(target, null)).toBe(false);
  });
});
