import { createTrainingSample } from '../community/training-samples';
/**
 * 黄框徽章与页面账本的写入：
 * - markCell：cell 打黄框属性 + 记入 pageMarked 账本 + 本地统计
 * - buildBadge：徽章 DOM（理由 + 拉黑 / 误标 / 抢救操作）
 * - flushPendingBadges：同批徽章集中一次挂载，避免逐条改高度
 */

import type { Detection } from '@feedsieve/detector';
import { getUserId } from '../community/user-ids';
import { addAllowlist } from '../community/allowlist';
import { rescueHandle, syncLocalLabels } from '../community/contribute';
import { mutateWithStableViewport } from '../platform/remove-tweets';
import type { BlockEvidence } from '../detection/detection-pipeline';
import type { PendingBadge } from '../detection/page-scan-controller';
import { bumpStat } from '../stats/local-stats';
import { bumpDaily } from '../stats/daily-stats';
import { MARK_ATTRIBUTE, type ContentState } from './page-state';
import { communityVoteForDetection } from './block-core';
import type { ManualActions } from './manual-actions';
import { createIcon } from '../insight/icons';

/** 标注属性值：`来源|postId`。postId 用来识别虚拟列表复用后残留的旧装饰。 */
function markValue(source: string, postId?: string | null): string {
  return postId ? `${source}|${postId}` : source;
}

/** 从标注属性值里读 postId：旧格式（只有来源）没有 postId，返回 null。 */
function markPostId(value: string | null): string | null {
  if (!value) return null;
  const separator = value.indexOf('|');
  if (separator < 0) return null;
  return value.slice(separator + 1) || null;
}

/**
 * 格子上的黄框是不是另一条推文的：X 虚拟列表会把同一个 cell 复用给新推文。
 * 复用后若不清掉旧徽章，新推文下面会挂着上一条的理由——buildBadge 见到
 * 已存在的 .fs-badge 会直接跳过，旧理由就永远留下来了。
 */
export function markedForOtherPost(cell: Element, postId?: string | null): boolean {
  if (!postId) return false;
  const marked = markPostId(cell.getAttribute(MARK_ATTRIBUTE));
  return marked !== null && marked !== postId;
}

export function createBadges(deps: {
  state: ContentState;
  runBlockNow: ManualActions['runBlockNow'];
}) {
  const { state, runBlockNow } = deps;

  // ---------- 标注 UI ----------

  function markCell(
    cell: HTMLElement,
    detection: Detection,
    category: string,
    evidence: BlockEvidence,
    pendingBadges: PendingBadge[],
    snippet?: string,
    displayName?: string,
    postId?: string | null,
    /** 同一条推文的装饰被 X 冲掉后重建时为 false：不重复计入检测统计。 */
    countAsNew = true,
  ): void {
    // 同一个 cell 被复用给另一条推文：旧徽章先删掉，否则下面 buildBadge 会跳过
    if (markedForOtherPost(cell, postId)) {
      for (const stale of cell.querySelectorAll('.fs-badge')) stale.remove();
    }
    cell.setAttribute(MARK_ATTRIBUTE, markValue(detection.source, postId));
    const badge = buildBadge(cell, detection, category, evidence);
    // 徽章不立即挂载：同批标注集中到 flushPendingBadges 一次插入，
    // 避免逐条改高度 + 逐条触发滚动锚定。
    if (badge) pendingBadges.push({ cell, badge });
    // 页面上用户能看到的每一个黄框，都必须出现在 popup 的待处理清单里。
    // 安全边界是「必须由用户点击一键拉黑」，而不是再暗藏一层不可见的置信门槛。
    if (detection.source !== 'blocked') {
      state.pageMarked.set(detection.handle, {
        handle: detection.handle,
        category,
        reason: detection.reason,
        ruleId: detection.ruleId,
        evidence: { ...evidence, detectionSource: detection.source },
        snippet: snippet?.trim() || undefined,
        displayName: displayName?.trim() || undefined,
      });
      state.notifyPageMarkedChanged();
    }
    // 本地统计：每次新标注 +1（扫描快照保证每个 cell 只标一次）；
    // 已拉黑回显不是新发现，不计数；装饰被冲掉后的重建也不是新命中。
    if (detection.source !== 'blocked' && countAsNew) {
      // 连续 30 天战斗统计与总累计一起记（页面快照保证同 cell 不重复计数）
      void bumpStat('detected').catch(() => {
        // 统计写入失败不影响标注
      });
      void bumpDaily('detected').catch(() => {
        // 同上，写失败静默
      });
    }
  }

  function buildBadge(
    cell: HTMLElement,
    detection: Detection,
    category: string,
    evidence: BlockEvidence,
  ): HTMLElement | null {
    if (cell.querySelector('.fs-badge')) {
      return null;
    }

    const badge = document.createElement('div');
    badge.className = 'fs-badge';

    const label = document.createElement('span');
    label.className = 'fs-reason';
    label.textContent = detection.reason;
    // 截断时可悬停看完整普通理由；ruleId / source 只留在内部证据，不展示给用户。
    label.title = detection.reason;

    // 主操作组：顺手拉黑（高频，视觉突出）。
    // 批量操作不再走勾选：popup「一键拉黑」= 页面全部黄框账号。
    const primaryGroup = document.createElement('span');
    primaryGroup.className = 'fs-actions';

    const blockBtn = document.createElement('button');
    blockBtn.className = 'fs-block-now';
    blockBtn.type = 'button';
    blockBtn.textContent = state.uiLanguage === 'zh' ? '拉黑' : 'Block';
    blockBtn.title =
      state.uiLanguage === 'zh' ? '福滤娃 · 拉黑此账号' : 'FeedSieve · Block this account';
    blockBtn.addEventListener('click', () => {
      // 计票口径与批量路径唯一共享：见 communityVoteForDetection
      const communityVote = communityVoteForDetection(detection.source, detection.ruleId);
      void runBlockNow(
        detection.handle,
        blockBtn,
        category,
        evidence,
        'single-detection',
        communityVote,
      );
    });
    primaryGroup.append(blockBtn);

    // 次操作组：抢救 / 误标？（低频治理，弱化样式）
    const secondaryGroup = document.createElement('span');
    secondaryGroup.className = 'fs-actions fs-actions-soft';

    const allowBtn = document.createElement('button');
    allowBtn.className = 'fs-allow';
    allowBtn.type = 'button';
    allowBtn.textContent = state.uiLanguage === 'zh' ? '误标？' : 'Misflagged?';
    allowBtn.title =
      state.uiLanguage === 'zh'
        ? '加入个人白名单，并提交这条规则的误标反馈'
        : 'Add to your allowlist and report this rule as a false positive';
    allowBtn.addEventListener('click', () => {
      void (async () => {
        const sample = createTrainingSample(detection.handle, 'false-positive', {
          ...evidence,
          detectionSource: detection.source,
          ruleId: detection.ruleId,
        });
        const feedback = {
          detectionSource: detection.source,
          ...(detection.ruleId ? { ruleId: detection.ruleId } : {}),
          detectionReason: detection.reason,
        };
        const xUserId = (await getUserId(detection.handle)) ?? undefined;
        await addAllowlist(detection.handle, xUserId, feedback, evidence.displayName, {
          ...sample,
          ...(xUserId ? { xUserId } : {}),
        });
        cell.removeAttribute(MARK_ATTRIBUTE);
        badge.remove();
        // 本地白名单立即生效；同步器会补传失败记录和历史名单。
        void syncLocalLabels();
      })().catch(() => {
        // 白名单写入失败：标注保持原状
      });
    });

    // 抢救：只对社区名单命中的条目出现（显式投票，名单不是永久刑罚）
    const rescueBtn =
      detection.source === 'community-list' && state.autoContribute
        ? (() => {
            const btn = document.createElement('button');
            btn.className = 'fs-allow';
            btn.type = 'button';
            btn.textContent = state.uiLanguage === 'zh' ? '抢救' : 'Rescue';
            btn.title =
              state.uiLanguage === 'zh'
                ? '向社区投票：这个标注可能误伤了'
                : 'Vote to community: this mark may be a false positive';
            btn.addEventListener('click', () => {
              void (async () => {
                btn.disabled = true;
                btn.textContent = '…';
                const ok = await rescueHandle(
                  detection.handle,
                  {
                    detectionSource: detection.source,
                    ...(detection.ruleId ? { ruleId: detection.ruleId } : {}),
                    detectionReason: detection.reason,
                  },
                  (await getUserId(detection.handle)) ?? undefined,
                );
                if (ok) {
                  btn.textContent = state.uiLanguage === 'zh' ? '已抢救 ✓' : 'Rescued ✓';
                  setTimeout(() => {
                    btn.remove();
                  }, 2000);
                } else {
                  btn.textContent = state.uiLanguage === 'zh' ? '失败' : 'Failed';
                  setTimeout(() => {
                    btn.disabled = false;
                    btn.textContent = state.uiLanguage === 'zh' ? '抢救' : 'Rescue';
                  }, 3000);
                }
              })();
            });
            return btn;
          })()
        : null;

    // 抢救公示引流：正在投票抢救时，旁边给出官网抢救名单镜像入口
    const rescueSiteLink =
      detection.source === 'community-list' && state.autoContribute
        ? (() => {
            const link = document.createElement('a');
            link.className = 'fs-allow';
            link.href = 'https://feedsieve.win/lists/rescue';
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.textContent = state.uiLanguage === 'zh' ? '公示' : 'Cases';
            return link;
          })()
        : null;

    secondaryGroup.append(
      ...[rescueBtn, rescueSiteLink, allowBtn].filter(
        (el): el is HTMLAnchorElement | HTMLButtonElement => el != null,
      ),
    );

    badge.append(createIcon('shieldAlert', 15), label, primaryGroup, secondaryGroup);
    // cellInnerDiv 是普通块容器：徽章作为新块级子元素排在推文下方，
    // 处于文档流内但不进入 article 的 grid，不覆盖、不挤压任何 X 内容。
    // 挂载时机由 flushPendingBadges 批量决定（见 markCell）。
    return badge;
  }

  /**
   * 徽章会改变 cell 高度；同一批标注集中一次挂载，并套用与隐藏推文同款的
   * 滚动锚定保护。标注密集的评论区里，逐条挂载正是滚动抽动的来源之一。
   */
  function flushPendingBadges(pending: PendingBadge[]): void {
    if (pending.length === 0) return;
    const insertions: PendingBadge[] = [];
    const cells = new Set<HTMLElement>();
    for (const item of pending) {
      // resetPageDecorations 可能在构建与挂载之间撤销了这枚标注
      if (!item.cell.isConnected || !item.cell.hasAttribute(MARK_ATTRIBUTE)) continue;
      if (item.cell.querySelector('.fs-badge')) continue;
      if (cells.has(item.cell)) continue;
      cells.add(item.cell);
      insertions.push(item);
    }
    pending.length = 0;
    if (insertions.length === 0) return;
    mutateWithStableViewport(cells, () => {
      for (const { cell, badge } of insertions) {
        cell.appendChild(badge);
      }
    });
  }

  return { markCell, flushPendingBadges };
}

export type Badges = ReturnType<typeof createBadges>;
