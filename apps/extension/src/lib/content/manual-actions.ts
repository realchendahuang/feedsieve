/**
 * 标注 UI 上的用户手动拉黑动作：
 * - attachManualAction：未命中检测的 article 动作栏末尾的拉黑图标按钮
 * - runManualSpamBlock：手动输入（popup）触发的垃圾账号拉黑
 * - runBlockNow：徽章「拉黑」按钮的完整反馈链路
 */

import { tweetSelectors } from '@feedsieve/x-adapter';
import { removeAllowed } from '../community/allowlist';
import { removeFollowingAccount } from '../community/following-allowlist';
import { syncLocalLabels } from '../community/contribute';
import { hideCellsSoon } from '../platform/remove-tweets';
import type { BlockEvidence } from '../detection/detection-pipeline';
import type { ContentState } from './page-state';
import type { BlockCore } from './block-core';
import type { BlockedFold } from './blocked-fold';
import { actionIcon, alignActionSlot, createActionSlot, type ActionSlot } from './action-slot';
import type { ManualReportReason } from '../community/manual-reasons';
import { openReasonMenu } from './reason-menu';

/** 动作栏图标按钮的状态：图标随状态切换，失败时短暂显示错误码。 */
function setManualState(
  slot: Pick<ActionSlot, 'button' | 'setContent'>,
  state: 'idle' | 'busy' | 'done' | 'failed',
  failedText = '',
): void {
  slot.button.setAttribute('data-fs-state', state);
  if (state === 'failed') {
    slot.setContent(failedText);
    return;
  }
  slot.setContent(actionIcon(state === 'done' ? 'check' : 'userX'));
}

export function createManualActions(deps: {
  state: ContentState;
  blockOne: BlockCore['blockOne'];
  fold: BlockedFold;
}) {
  const { state, blockOne, fold } = deps;

  const manualEvidence = new WeakMap<
    HTMLButtonElement,
    { handle: string; evidence: BlockEvidence }
  >();
  /** 同一时间只开一个原因浮层；浮层自己在关闭时清空。 */
  let closeActiveMenu: (() => void) | null = null;

  // ---------- 标注 UI ----------

  function attachManualAction(article: HTMLElement, handle: string, evidence: BlockEvidence): void {
    const existing = article.querySelector<HTMLButtonElement>('[data-fs-manual-action]');
    if (existing) {
      manualEvidence.set(existing, { handle, evidence });
      return;
    }
    const actionAnchor = article.querySelector(tweetSelectors.actionAnchor);
    const actionGroup = actionAnchor?.closest(tweetSelectors.actionGroup);
    if (!actionGroup) return;

    const title =
      state.uiLanguage === 'zh'
        ? '福滤娃 · 拉黑此账号（先选原因）'
        : 'FeedSieve · Block this account (choose a reason)';
    // 复制 X 原生动作按钮的结构，宽度和对齐跟着 X 走（见 action-slot.ts）
    const slot = createActionSlot(actionGroup, 'block', title);
    const { button } = slot;
    manualEvidence.set(button, { handle, evidence });
    button.classList.add('fs-manual-mark');
    button.setAttribute('data-fs-manual-action', 'true');
    setManualState(slot, 'idle');
    button.addEventListener('click', () => {
      if (button.disabled) return;
      const current = manualEvidence.get(button);
      if (!current) return;
      // 点同一颗按钮 = 收起；点另一颗 = 换到那颗下面。
      const wasOpen = button.hasAttribute('data-fs-menu');
      closeActiveMenu?.();
      closeActiveMenu = null;
      if (wasOpen) return;
      button.setAttribute('data-fs-menu', 'open');
      closeActiveMenu = openReasonMenu(button, {
        language: state.uiLanguage,
        onPick: (reason) => {
          closeActiveMenu = null;
          button.removeAttribute('data-fs-menu');
          // 浮层开着时 X 可能又更新了这条 article 的证据，落盘前再取一次最新值
          void runManualFromMenu(button, slot, manualEvidence.get(button) ?? current, reason);
        },
        onClose: () => {
          closeActiveMenu = null;
          button.removeAttribute('data-fs-menu');
        },
      });
    });
    actionGroup.appendChild(slot.root);
    alignActionSlot(slot.root);
  }

  async function runManualFromMenu(
    button: HTMLButtonElement,
    slot: ActionSlot,
    current: { handle: string; evidence: BlockEvidence },
    reason: ManualReportReason | null,
  ): Promise<void> {
    button.disabled = true;
    setManualState(slot, 'busy');
    const outcome = await runManualSpamBlock(current.handle, current.evidence, reason).catch(
      () => ({ ok: false as const, code: 'unknown' }),
    );
    if (outcome.ok) {
      setManualState(slot, 'done');
      // 被拉黑者本人主页豁免折叠（与徽章路径 runBlockNow 同口径，见 blocked-fold）
      if (fold.shouldFoldBlockedTweets(current.handle)) {
        hideCellsSoon(fold.collectCellsForHandle(current.handle));
      }
      return;
    }
    setManualState(
      slot,
      'failed',
      `${state.uiLanguage === 'zh' ? '失败' : 'Failed'} ${outcome.code}`,
    );
    window.setTimeout(() => {
      button.disabled = false;
      setManualState(slot, 'idle');
    }, 3000);
  }

  /**
   * 手动拉黑。reason=null 表示「仅拉黑」：只写本地账本，不参与社区计票；
   * 选原因时分类就是票面 reason，不再默认写 other。
   */
  async function runManualSpamBlock(
    rawHandle: string,
    evidence: BlockEvidence = {},
    reason: ManualReportReason | null = null,
  ): Promise<{ ok: true; handle: string } | { ok: false; code: string }> {
    const handle = normalizeManualHandle(rawHandle);
    if (!handle) return { ok: false, code: 'invalid-handle' };
    const outcome = await blockOne(
      {
        handle,
        category: reason ?? 'other',
        reason: '',
        evidence: { ...evidence, detectionSource: 'manual' },
      },
      {
        origin: reason ? 'manual-spam' : 'manual-personal',
        communityVote: reason !== null,
      },
    );
    if (!outcome.ok) return outcome;

    // 最新的用户显式判断覆盖旧的「关注 / 不是垃圾」保护。
    await Promise.all([removeAllowed(handle), removeFollowingAccount(handle)]);
    await syncLocalLabels();
    return { ok: true, handle };
  }

  function normalizeManualHandle(value: string): string | null {
    const trimmed = value.trim();
    let candidate = trimmed;
    try {
      const url = new URL(trimmed);
      if (
        url.hostname === 'x.com' ||
        url.hostname === 'www.x.com' ||
        url.hostname === 'twitter.com'
      ) {
        candidate = url.pathname.split('/').filter(Boolean)[0] ?? '';
      }
    } catch {
      // 不是 URL，按 @handle 处理
    }
    const handle = candidate.replace(/^@+/, '').toLowerCase();
    return /^[a-z0-9_]{1,15}$/.test(handle) ? handle : null;
  }

  /**
   * 顺手拉黑（Phase 2）：查缓存的 rest_id -> 调 X 网页端原拉黑端点。
   * 缓存 miss 不再让用户等刷新：按 UserByScreenName 当场解析（TBWL 同款），
   * 解析成功顺手回填缓存；只有解析也失败才如实提示。
   * 成功后：把该账号从 pageMarked 移除，并把页面上该账号的推文隐藏
   * （对齐 X 原生拉黑行为，见 src/lib/remove-tweets.ts）。
   * 按钮文字实时反映状态，绝不假装成功。
   */
  async function runBlockNow(
    handle: string,
    button: HTMLButtonElement,
    category: string,
    evidence: BlockEvidence,
    origin: 'manual-spam' | 'single-detection' = 'single-detection',
    communityVote = true,
  ): Promise<void> {
    const original = button.textContent;
    button.disabled = true;
    try {
      button.textContent = state.uiLanguage === 'zh' ? '拉黑中…' : 'Blocking…';
      const outcome = await blockOne(
        {
          handle,
          category,
          reason: '',
          evidence,
        },
        { origin, communityVote },
      );
      if (outcome.ok) {
        button.textContent = state.uiLanguage === 'zh' ? '已拉黑 ✓' : 'Blocked ✓';
        state.pageMarked.delete(handle);
        state.notifyPageMarkedChanged();
        if (fold.shouldFoldBlockedTweets(handle)) {
          hideCellsSoon(fold.collectCellsForHandle(handle));
        }
      } else {
        // 如实反馈失败原因（auth_required / rate_limited / network_error…）
        button.textContent = `${state.uiLanguage === 'zh' ? '失败' : 'Failed'} ${outcome.code}`;
        console.warn(`[FeedSieve] block @${handle} failed:`, outcome.code);
        setTimeout(() => {
          button.textContent = original;
          button.disabled = false;
        }, 3000);
      }
    } catch (error) {
      button.textContent = '失败 未知';
      console.error(`[FeedSieve] block @${handle} threw:`, error);
      setTimeout(() => {
        button.textContent = original;
        button.disabled = false;
      }, 3000);
    }
  }

  return { attachManualAction, runManualSpamBlock, runBlockNow };
}

export type ManualActions = ReturnType<typeof createManualActions>;
