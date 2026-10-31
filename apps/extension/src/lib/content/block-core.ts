import { createTrainingSample } from '../community/training-samples';
/**
 * 单账号拉黑核心链路：blockOne（顺手拉黑 / 徽章拉黑 / 手动拉黑 / 队列执行共用的
 * 唯一实现）与「是否给社区加票」的唯一口径 communityVoteForDetection。
 */

import { resolveUserIdByHandle, runNativeAction } from '@feedsieve/x-adapter';
import { markBlocked } from '../community/blocked-accounts';
import { getUserId, saveUserIds } from '../community/user-ids';
import { contributeBlocks } from '../community/contribute';
import { requestOfficialPauseCheck } from '../community/community-store';
import { bumpStat } from '../stats/local-stats';
import { bumpDaily } from '../stats/daily-stats';
import { STRICT_HANDLE_RE } from '../platform/xhr-bridge-guard';
import { currentAccountKey, recordSafetyEvent } from '../queue/block-safety';
import type { ContentState, PageMarkedAccount } from './page-state';

/**
 * 「是否给社区加票」的唯一口径，单条拉黑与一键批量拉黑共用。
 * 防自我放大：社区名单命中是既有结论；keyword:*（本地自定义 + 官方词库）
 * 是短语偏好层、只做人工确认提示 —— 两者都不反向加票。
 * builtin-list / fingerprint / domain / weak-signal-combo（乱码批量号锚点 +
 * 内容佐证，直接证据）是独立发现，用户确认拉黑后正常计票。
 */
export function communityVoteForDetection(
  detectionSource: string | undefined,
  ruleId?: string,
): boolean {
  return detectionSource !== 'community-list' && !ruleId?.startsWith('keyword:');
}

export function createBlockOne(state: ContentState) {
  /**
   * 单账号完整拉黑链路（顺手拉黑 / 一键拉黑共用）。
   * 不抛异常，一切失败转成结构化结果；成功后记账 + 统计 + 贡献上报。
   */
  async function blockOne(
    item: PageMarkedAccount,
    options: {
      origin?:
        'manual-spam' | 'manual-personal' | 'single-detection' | 'page-batch' | 'community-batch';
      communityVote?: boolean;
      batchId?: string;
      deferContribution?: boolean;
      /** 判定材料（推文原文/昵称/简介）；不传时回查页面黄框内存态与 bio 缓存。 */
      tweetSnippet?: string;
      displayName?: string;
      bio?: string;
    } = {},
  ): Promise<
    { ok: true } | { ok: false; code: string; httpStatus?: number; retryAfterMs?: number }
  > {
    // 官方破坏性动作暂停开关：本地快照命中立刻拦截（零额外请求）；
    // 否则实时问一次 /v1/kill-switch（background 30s TTL 缓存），网络失败回退快照。
    // 只关闭拉黑类动作，检测 / 标注 / 读取继续；单向开关，不可能远程开启自动拉黑。
    if (state.community?.killSwitch?.destructive_actions_disabled) {
      return { ok: false, code: 'kill_switch' };
    }
    const officialPause = await requestOfficialPauseCheck();
    if (officialPause.destructive_actions_disabled) {
      return { ok: false, code: 'kill_switch' };
    }
    // 拉黑目标必须严格合法：handle 是唯一指向真实账号的坐标，畸形输入宁可拒绝
    const handle = item.handle.trim().replace(/^@+/, '').toLowerCase();
    if (!STRICT_HANDLE_RE.test(handle)) {
      return { ok: false, code: 'invalid-handle' };
    }
    // 缓存 id 信任策略（review F1b/F4）：缓存/快照的 handle↔id 对可被页面伪造
    // 或因服务端数据错误而错位（签名只保完整性不保正确性）。detection / community
    // 来源的破坏性动作一律不信缓存 id，执行期按 handle 现解析（队列节奏 ~1s/block，
    // 多一次 UserByScreenName 可接受）；解析失败宁可拒发，绝不用可疑 id 打 block API。
    // 手动输入（manual-*）保留缓存优先：用户明确指向的是 handle，行为与 v0.8 前一致。
    const trustCachedId =
      options.origin === undefined || ['manual-spam', 'manual-personal'].includes(options.origin);
    let xUserId: string | undefined | null = trustCachedId
      ? (item.xUserId ?? (await getUserId(handle)))
      : undefined;
    // 拉黑时刻探活（#2 定稿）：仅当本次现场解析了 UserByScreenName（队列拉黑不信任缓存，
    // 必然要解一次）才把存活观测随票上报；缓存命中不构成新鲜存活证据，缺省不上报。
    // dead（no_user）在下方解析失败分支如实处理——X 不接受拉黑不存在的账号，票不产出。
    let liveness: 'alive' | 'dead' | undefined;
    if (!xUserId) {
      const resolved = await resolveUserIdByHandle(handle);
      if (resolved.ok) {
        xUserId = resolved.xUserId;
        liveness = 'alive';
        void saveUserIds([{ handle, xUserId }]).catch(() => {
          // 回填失败不影响本次拉黑
        });
      } else {
        // 解析失败如实归类：「账号已不存在」与「限流/网络」分开，后者交给队列退避重试
        console.warn(
          `[FeedSieve] resolve @${handle} failed:`,
          resolved.code,
          resolved.statusCode ?? '',
        );
        return {
          ok: false,
          // no_csrf / missing_csrf 均在 block-queue classifyFailure 中归类为 pause
          code: resolved.code,
          ...(resolved.statusCode !== undefined ? { httpStatus: resolved.statusCode } : {}),
        };
      }
    }

    // Freeze before the network action; the page may change while X responds.
    const sample =
      options.origin === 'manual-personal' || options.origin === 'community-batch'
        ? null
        : createTrainingSample(
            handle,
            options.origin === 'manual-spam'
              ? 'manual-spam'
              : options.origin === 'page-batch'
                ? 'batch-block'
                : 'accepted-detection',
            {
              ...item.evidence,
              tweetText: options.tweetSnippet ?? item.evidence.tweetText ?? item.snippet,
              displayName: options.displayName ?? item.evidence.displayName ?? item.displayName,
              bio: options.bio ?? item.evidence.bio,
            },
            xUserId,
          );
    const result = await runNativeAction('block', xUserId);
    if (!result.ok) {
      return {
        ok: false,
        code: result.code,
        ...(result.statusCode !== undefined ? { httpStatus: result.statusCode } : {}),
        ...(result.retryAfterMs !== undefined ? { retryAfterMs: result.retryAfterMs } : {}),
      };
    }
    // 网络已经成功：本地记账失败不能把结果报成拉黑失败，否则队列会重试已成功的操作。
    try {
      // 记账（撤销入口的数据源）+ 本地统计
      // 判定材料（推文原文/昵称/简介）按用户 2026-09-12 拍板随票上报 + 本机留档
      const markedEvidence = state.pageMarked.get(handle);
      const tweetFacts =
        (options.tweetSnippet ?? item.evidence.tweetText ?? markedEvidence?.snippet)?.trim() ||
        undefined;
      await markBlocked(
        handle,
        xUserId,
        {
          category: item.category,
          ...item.evidence,
          ...(liveness ? { liveness } : {}),
          ...(options.origin ? { origin: options.origin } : {}),
          ...(typeof options.communityVote === 'boolean'
            ? { communityVote: options.communityVote }
            : {}),
          ...(options.batchId ? { batchId: options.batchId } : {}),
        },
        {
          ...(tweetFacts ? { tweetSnippet: tweetFacts } : {}),
          ...((options.displayName ?? item.evidence.displayName ?? markedEvidence?.displayName)
            ? {
                displayName:
                  options.displayName ?? item.evidence.displayName ?? markedEvidence?.displayName,
              }
            : {}),
          // bio 是 XHR 桥带来的判定材料；队列延迟执行时页面可能已重载，缓存 miss 缺省
          ...((options.bio ?? item.evidence.bio ?? state.bioCache.get(handle))
            ? { bio: options.bio ?? item.evidence.bio ?? state.bioCache.get(handle)! }
            : {}),
        },
        sample ?? undefined,
      );
      await bumpStat('blocked');
      // v0.6 战报：今日拉黑 + 分类计数
      await bumpDaily('blocked', item.category);
      // 安全账本：只记确认成功的写操作；顺手拉黑与队列拉黑共用同一本账
      await recordSafetyEvent(currentAccountKey());
    } catch (error) {
      console.warn('[FeedSieve] 拉黑已成功，但本地记账失败（不影响拉黑结果）:', error);
    }
    // 摩擦设计：拉黑成功即自动贡献社区（无弹窗；全局开关在 contributeBlocks 内判断）
    if (options.communityVote !== false && !options.deferContribution) {
      contributeBlocks([
        {
          handle,
          xUserId,
          category: item.category,
          ...item.evidence,
          ...(liveness ? { liveness } : {}),
        },
      ]);
    }
    return { ok: true };
  }

  return { blockOne };
}

export type BlockCore = ReturnType<typeof createBlockOne>;
