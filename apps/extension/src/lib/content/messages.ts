/**
 * content script 的 runtime.onMessage 路由（popup / background 发起的指令）：
 * - 一键拉黑 / 社区批量入队 / 撤销 / 手动拉黑 / 关注同步
 * - 队列 resume / pause / cancel 与能力快照
 * - 页面黄框清单快照查询
 * - 热帖定位（滚动到页面上的帖子；热帖列表本身由后台汇总，见 shared-insight.ts）
 */

import { readCapabilities } from '@feedsieve/x-adapter';
import { runUnblockBatch } from '../queue/run-unblock-batch';
import { sanitizeQueueItem } from '../queue/block-queue-store';
import { syncLocalLabels } from '../community/contribute';
import type { QueueSupervisor } from '../queue/queue-supervisor';
import type { FollowingSync } from '../community/following-sync';
import type { ContentState } from './page-state';
import { communityVoteForDetection } from './block-core';
import type { BlockQueueRunner } from './block-queue';
import type { ManualActions } from './manual-actions';
import type { ProfileFill } from './profile-fill';
import { scrollToPost } from '../insight/locate';

export function registerContentMessageHandlers(deps: {
  state: ContentState;
  queueSupervisor: QueueSupervisor;
  followingSync: FollowingSync;
  startPersistentQueue: BlockQueueRunner['startPersistentQueue'];
  runManualSpamBlock: ManualActions['runManualSpamBlock'];
  profileFill: ProfileFill;
}): void {
  const {
    state,
    queueSupervisor,
    followingSync,
    startPersistentQueue,
    runManualSpamBlock,
    profileFill,
  } = deps;

  /**
   * popup「一键拉黑 / 一键撤销」入口：这里执行需要页面会话的原生操作，
   * 返回 Promise 作为 sendMessage 的响应（批量汇总见 run-block/run-unblock-batch.ts）。
   */
  browser.runtime.onMessage.addListener((message: unknown) => {
    const msg = message as {
      type?: string;
      handle?: string;
      handles?: string[];
      targetTabId?: number;
      items?: Array<{ handle: string; xUserId?: string; category: string }>;
    } | null;
    const type = msg?.type;
    // 一键拉黑 = 当前页面黄框账号（支持剔除误删项后仅拉黑选中的账号）
    if (type === 'feedsieve:run-page-block') {
      const targetHandles = Array.isArray(msg?.handles)
        ? new Set(msg.handles.map((h: string) => String(h).toLowerCase()))
        : null;
      const toBlock = [...state.pageMarked.values()].filter(
        (item) => !targetHandles || targetHandles.has(item.handle.toLowerCase()),
      );
      return startPersistentQueue(
        'page-batch',
        toBlock.map((item) => ({
          handle: item.handle,
          category: item.category,
          reason: item.reason,
          evidence: item.evidence,
          // 防自我放大的计票口径与单条拉黑路径完全一致（communityVoteForDetection）
          communityVote: communityVoteForDetection(item.evidence.detectionSource, item.ruleId),
          // 推文原文快照随任务走：队列延迟执行时不页面已滚走，靠这里记账
          tweetSnippet: item.snippet,
          displayName: item.displayName,
          // bio 是 XHR 桥带来的简介原文（bio 启发式的判定材料）；入队时固化
          bio: state.bioCache.get(item.handle),
        })),
        msg?.targetTabId,
      );
    }
    if (type === 'feedsieve:unblock') {
      return runUnblockBatch(msg?.handle).then((result) => {
        void syncLocalLabels();
        return result;
      });
    }
    if (type === 'feedsieve:manual-spam-block' && msg?.handle) {
      return runManualSpamBlock(msg.handle);
    }
    if (type === 'feedsieve:profile-fill' && typeof msg?.handle === 'string') {
      // 用户点「补全」：向下滚动让 X 自己加载更多帖子（不额外请求 X）
      return profileFill.fill(msg.handle.toLowerCase());
    }
    if (type === 'feedsieve:profile-fill-stop') {
      profileFill.stop();
      return Promise.resolve({ ok: true });
    }
    if (type === 'feedsieve:following-sync-start') {
      return followingSync.start();
    }
    if (type === 'feedsieve:community-block-start' && Array.isArray(msg?.items)) {
      // 消息通道可跨上下文伪造/携带畸形条目（review F1/F6）：逐条严格校验后才入队
      const items = (msg.items as unknown[])
        .map(sanitizeQueueItem)
        .filter((item): item is NonNullable<typeof item> => item !== null);
      if (items.length === 0) {
        return { status: 'error', error: 'invalid-items', id: '', count: 0 };
      }
      return startPersistentQueue('community-batch', items, msg.targetTabId);
    }
    if (type === 'feedsieve:capabilities') {
      // popup 用：当前 X 会话 / Block 接口 / 解析 / 扫描的能力快照（非破坏性观测）
      return Promise.resolve(readCapabilities());
    }
    if (type === 'feedsieve:block-queue-resume') {
      return queueSupervisor.resume();
    }
    if (type === 'feedsieve:block-queue-pause') {
      return queueSupervisor.pauseByUser();
    }
    if (type === 'feedsieve:block-queue-cancel') {
      return queueSupervisor.cancel();
    }
    return undefined;
  });

  /** popup「一键拉黑」需要的页面黄框快照与热帖定位（发往活动 tab 实时查询）。 */
  browser.runtime.onMessage.addListener((message: unknown) => {
    const type = (message as { type?: string } | null)?.type;
    if (type === 'feedsieve:scroll-to-post') {
      const postId = (message as { postId?: unknown }).postId;
      return Promise.resolve({
        found: typeof postId === 'string' && /^\d{1,20}$/.test(postId) && scrollToPost(postId),
      });
    }
    if (type === 'feedsieve:page-marked-list') {
      // 必须 Promise：Chrome 原生 onMessage 只认 true / Promise 作为异步响应，
      // 同步返回数组会被忽略，popup 收到 undefined（v0.7.0 真机回归捕获）
      return Promise.resolve(
        [...state.pageMarked.values()].map((m) => ({
          handle: m.handle,
          category: m.category,
          reason: m.reason,
          evidence: m.evidence,
          snippet: m.snippet,
          displayName: m.displayName,
        })),
      );
    }
    return undefined;
  });
}
