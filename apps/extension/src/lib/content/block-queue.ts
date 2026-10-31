/**
 * 持久拉黑队列的 content 侧装配：
 * - startPersistentQueue：popup「一键拉黑 / 社区批量」入口，创建持久队列并启动 runner
 * - executePersistentQueue：注入「持久化适配器 + 真实 Block 动作」的唯一 runner执行体
 *
 * 安全档位缓存与 429 风暴计数是本模块级状态（原 content.ts 模块级，随迁保持）。
 */

import { runQueuedBlocks } from '@feedsieve/block-queue';
import {
  createPersistentBlockQueue,
  getPersistentBlockQueue,
  setPersistentBlockQueue,
  type PersistentBlockQueueState,
} from '../queue/block-queue-store';
import {
  currentAccountKey,
  DEFAULT_PRESET,
  loadSafetyLedger,
  paceForPreset,
  persistSignal,
  RATE_LIMIT_STORM_THRESHOLD,
  shouldPauseForQuota,
  type SafetyPreset,
} from '../queue/block-safety';
import { requestOfficialPauseCheck } from '../community/community-store';
import { hideCellsSoon } from '../platform/remove-tweets';
import type { BlockEvidence } from '../detection/detection-pipeline';
import type { ContentState } from './page-state';
import type { BlockCore } from './block-core';
import type { BlockedFold } from './blocked-fold';

/** 安全档位缓存：每次账本读取时刷新，供 successPaceMs 同步注入（runner 的 pace 是同步函数）。 */
let safetyPresetCache: SafetyPreset = DEFAULT_PRESET;
/** 连续 429 计数：达到阈值升级为 rate_limit_storm（收缩当日预算 + 整队暂停）。 */
let consecutiveRateLimited = 0;

export function createBlockQueueRunner(deps: {
  state: ContentState;
  blockOne: BlockCore['blockOne'];
  fold: BlockedFold;
  /** 启动本 tab runner（queueSupervisor.run 的端口，避免与 supervisor 构造互相依赖）。 */
  runQueue: () => void;
}) {
  const { state, blockOne, runQueue, fold } = deps;

  async function startPersistentQueue(
    source: 'page-batch' | 'community-batch',
    items: Array<{
      handle: string;
      xUserId?: string;
      category: string;
      reason?: string;
      evidence?: BlockEvidence;
      communityVote?: boolean;
    }>,
    targetTabId?: number,
  ): Promise<
    | { status: 'started'; id: string; count: number }
    | { status: 'error'; error: string; id: string; count: number }
  > {
    // 官方暂停开关生效时拒绝新建破坏性队列（popup 也会先检查并禁用入口）；
    // 本地快照未停时再实时确认一次，避免开关刚翻转仍被旧的 6h 缓存放行。
    if (state.community?.killSwitch?.destructive_actions_disabled) {
      return { status: 'error', error: 'kill_switch', id: '', count: 0 };
    }
    const officialPause = await requestOfficialPauseCheck();
    if (officialPause.destructive_actions_disabled) {
      return { status: 'error', error: 'kill_switch', id: '', count: 0 };
    }
    const filtered = items.filter((item) => {
      const handle = item.handle.toLowerCase();
      return (
        !state.allowCache.has(handle) &&
        !state.followingCache.has(handle) &&
        !state.blockedCache.has(handle)
      );
    });
    const created = await createPersistentBlockQueue(source, filtered, { targetTabId });
    runQueue();
    return { status: 'started', id: created.id, count: created.tasks.length };
  }

  /**
   * 队列执行在 content script 内；页面刷新会中断正在发出的请求。
   * 只有确认 owner tab 已消失（心跳停摆）才把孤儿 running 状态降为 paused，
   * 避免误伤其它 tab 正在执行的队列、也避免 popup 误报「仍在运行」。
   *
   * allowReschedule 仅启动调用为真：owner 恰好在心跳窗口内刷新时，靠
   * 「新页面启动必然重新走本函数」覆盖，定时复查本身不再自续，避免常驻轮询。
   */
  async function executePersistentQueue(): Promise<void> {
    // 状态迁移、失败分类、自适应节奏全部收敛到 packages/block-queue 的唯一 runner；
    // 本函数只注入「持久化适配器 + 真实 Block 动作」，不再维护第二套循环语义。
    await runQueuedBlocks({
      load: () => getPersistentBlockQueue(),
      save: (session) => setPersistentBlockQueue(session as PersistentBlockQueueState),
      perform: async (task) => {
        // 入队后白名单/关注/自己可能变化：执行期再次豁免，绝不拉黑受保护账号
        // （创建队列时的过滤只覆盖入队那一刻的状态，暂停期间加白名单要靠这里兜住）。
        const lcHandle = task.handle.toLowerCase();
        if (
          state.allowCache.has(lcHandle) ||
          state.followingCache.has(lcHandle) ||
          state.blockedCache.has(lcHandle) ||
          (state.selfHandle !== null && lcHandle === state.selfHandle)
        ) {
          return { ok: true };
        }
        // 恢复/换源后 source 可能变化：每次执行按当前队列状态取 origin 与贡献策略
        const current = await getPersistentBlockQueue();
        const accountKey = currentAccountKey();
        // 安全额度：响应式预算用尽则本任务不发请求，走 quota_exhausted → 整队暂停。
        // 额度是友情提醒不是硬闸：用户点「仍要继续」后（quotaOverride）本轮放行，
        // X 侧真实推力仍由 429 风暴 / 认证失效信号兜底。
        const ledger = await loadSafetyLedger(accountKey);
        safetyPresetCache = ledger.preset;
        if (shouldPauseForQuota(current, ledger, Date.now())) {
          return { ok: false, code: 'quota_exhausted' };
        }
        const outcome = await blockOne(
          {
            handle: task.handle,
            ...(task.xUserId ? { xUserId: task.xUserId } : {}),
            category: task.category,
            reason: task.reason ?? '',
            evidence: task.evidence ?? {},
          },
          {
            origin: current?.source ?? 'page-batch',
            communityVote: task.communityVote ?? !(current?.source === 'community-batch'),
            batchId: current?.id,
            tweetSnippet: task.tweetSnippet,
            displayName: task.displayName,
            bio: task.bio,
          },
        );
        // 429 风暴：连续 RATE_LIMIT_STORM_THRESHOLD 次 429 不再退避硬磨——
        // 收缩当日预算（砍半）并升级为整队暂停（docs/legacy/BLOCK_SAFETY.md Layer B/C）
        if (!outcome.ok && outcome.code === 'rate_limited') {
          consecutiveRateLimited += 1;
          if (consecutiveRateLimited >= RATE_LIMIT_STORM_THRESHOLD) {
            consecutiveRateLimited = 0;
            await persistSignal(accountKey, 'rate_limit_storm');
            return { ok: false, code: 'rate_limit_storm' };
          }
          return outcome;
        }
        consecutiveRateLimited = 0;
        // 服务端明确拒绝写操作（登出/风控锁定）：当天预算清零，账号红线收缩
        // TODO(block-safety PR2, docs/legacy/BLOCK_SAFETY.md)：Arkose/登录墙（challenge）检测
        // 待真机验证 X 验证码响应特征后在此并链（persistSignal(accountKey, 'challenge')）
        if (!outcome.ok && outcome.code === 'auth_required') {
          await persistSignal(accountKey, 'auth_required');
        }
        return outcome;
      },
      // 成功后相邻间隔按安全档位「base + 抖动」，避免固定节拍器（docs/legacy/BLOCK_SAFETY.md Layer A）
      successPaceMs: () => paceForPreset(safetyPresetCache, Math.random),
      onSuccess: (task) => {
        // 队列侧页面副作用：移除黄框并隐藏该账号推文（对齐 X 原生拉黑行为；
        // 被拉黑者本人主页豁免，见 shouldFoldBlockedTweets）
        state.blockedCache.add(task.handle);
        state.pageMarked.delete(task.handle);
        state.notifyPageMarkedChanged();
        if (fold.shouldFoldBlockedTweets(task.handle)) {
          hideCellsSoon(fold.collectCellsForHandle(task.handle));
        }
      },
    });
  }

  return { startPersistentQueue, executePersistentQueue };
}

export type BlockQueueRunner = ReturnType<typeof createBlockQueueRunner>;
