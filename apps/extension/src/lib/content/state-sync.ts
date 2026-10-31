/**
 * 存储名单 / 设置快照 → ContentState → 页面装饰的同步层：
 * - refresh*：把持久层（黑名单 / 白名单 / 关注保护 / 自己 / 社区设置 / 词库）
 *   刷进状态缓存并按需触发页面对账
 * - resetPageDecorations*：设置、名单变化后撤销旧标注结论再重扫
 */

import { contextFromPath, extractFeedItem, tweetSelectors } from '@feedsieve/x-adapter';
import { getBlockedAccounts, subscribeBlocked } from '../community/blocked-accounts';
import { getAllowlist, subscribeAllowlist } from '../community/allowlist';
import {
  getFollowingAllowlist,
  getSelfHandle,
  subscribeFollowingAllowlist,
  subscribeSelfHandle,
} from '../community/following-allowlist';
import { buildRuntimeCommunity, getCommunitySettings } from '../community/community-store';
import {
  createKeywordHeuristics,
  ensureVariantTables,
  getKeywordRuleSettings,
} from '../detection/keyword-rules';
import { getKeywordPackCatalog } from '../detection/keyword-packs';
import { HIDDEN_TWEET_CELL_ATTRIBUTE, mutateWithStableViewport } from '../platform/remove-tweets';
import type { PageScanController } from '../detection/page-scan-controller';
import { MARK_ATTRIBUTE, replaceHandleCache, type ContentState } from './page-state';
import type { BlockedFold } from './blocked-fold';

export function createStateSync(deps: {
  state: ContentState;
  controller: PageScanController;
  fold: BlockedFold;
}) {
  const { state, controller, fold } = deps;

  function refreshBlockedCache(): void {
    const apply = (items: Array<{ handle: string }>): void => {
      const next = new Set(items.map((item) => item.handle.toLowerCase()));
      const added = new Set([...next].filter((handle) => !state.blockedCache.has(handle)));
      const removed = new Set([...state.blockedCache].filter((handle) => !next.has(handle)));
      state.blockedCache.clear();
      for (const handle of next) state.blockedCache.add(handle);

      // 拉黑不再触发整页徽章拆装。新增项只折叠对应账号的 cell；撤销项仅重扫
      // 对应账号，让已隐藏的行重新进入正常检测路径。
      if (added.size > 0) fold.hideNewlyBlockedCells(added);
      if (removed.size > 0) resetPageDecorationsForHandles(removed);
    };
    void getBlockedAccounts()
      .then(apply)
      .catch(() => {
        // storage 异常保持旧缓存
      });
    subscribeBlocked(apply);
  }

  function refreshSelfCache(): void {
    const apply = (handle: string | null): void => {
      if (state.selfHandle === handle) return;
      state.selfHandle = handle;
      // selfHandle 首次解析或切换账号：清理自己帖子已有的标注装饰（若有）
      if (handle) resetPageDecorationsForHandles(new Set([handle]));
    };
    void getSelfHandle()
      .then(apply)
      .catch(() => {
        // storage 异常保持旧缓存（未知 = 不跳过，防御性）
      });
    // 切换账号发生在别的 tab 时，本 tab 靠 storage 订阅同步，不能只靠启动读一次
    subscribeSelfHandle(apply);
  }

  function refreshAllowCache(): void {
    const apply = (items: Array<{ handle: string }>): void => {
      const changed = replaceHandleCache(state.allowCache, items);
      // 逐账号 DOM 清理之外，再整表对账一遍：即使该账号推文已不在 DOM
      //（resetPageDecorationsForHandles 找不到 cell 空转），账本也必须清干净。
      state.pruneProtectedPageMarked();
      if (changed.size > 0) resetPageDecorationsForHandles(changed);
    };
    void getAllowlist()
      .then(apply)
      .catch(() => {
        // storage 异常保持旧缓存
      });
    // 初始订阅：后续白名单变化实时生效（订阅保持到页面卸载）
    subscribeAllowlist(apply);
  }

  function refreshFollowingCache(): void {
    const apply = (items: Array<{ handle: string }>): void => {
      const changed = replaceHandleCache(state.followingCache, items);
      state.pruneProtectedPageMarked();
      if (changed.size > 0) resetPageDecorationsForHandles(changed);
    };
    void getFollowingAllowlist()
      .then(apply)
      .catch(() => {
        // storage 异常时保留旧缓存
      });
    subscribeFollowingAllowlist(apply);
  }

  async function refreshCommunity(): Promise<void> {
    state.community = await buildRuntimeCommunity();
    const settings = await getCommunitySettings();
    state.detectionEnabled = settings.enabled;
    state.strength = settings.strength;
    state.autoContribute = settings.autoContribute;
    controller.reset();
    controller.fullRescan();
  }

  let keywordRetry: ReturnType<typeof setTimeout> | undefined;
  let keywordFailures = 0;
  function retryKeywords(): void {
    if (keywordRetry || keywordFailures >= 3) return;
    keywordFailures += 1;
    keywordRetry = setTimeout(() => {
      keywordRetry = undefined;
      void refreshKeywordHeuristics();
    }, keywordFailures * 5_000);
  }

  async function refreshKeywordHeuristics(): Promise<void> {
    // Start independently: normalization data cannot delay installation of official rules.
    const variants = ensureVariantTables()
      .then(() => {
        if (state.keywordCatalog) {
          void getKeywordRuleSettings()
            .then((settings) => {
              state.keywordHeuristics = createKeywordHeuristics(settings, state.keywordCatalog);
              controller.reset();
              controller.fullRescan();
            })
            .catch((error) => console.error('[FeedSieve] 规则刷新失败:', error));
        }
      })
      .catch((error) => {
        console.error('[FeedSieve] 变体表加载失败，繁简/部首抗规避归一化降级:', error);
        retryKeywords();
      });
    try {
      state.keywordCatalog = await getKeywordPackCatalog();
      state.keywordHeuristics = createKeywordHeuristics(
        await getKeywordRuleSettings(),
        state.keywordCatalog,
      );
      controller.reset();
      controller.fullRescan();
    } catch (error) {
      // 装载失败绝不能静默：2026-09-13 检测全灭事故里错误被 void 吞掉，用户只能靠
      // 「黄框不见了」自己发现。这里必须留下可排查的现场。
      console.error('[FeedSieve] 官方词库装载失败，保留现有检测规则:', error);
      retryKeywords();
    }
    await variants;
  }

  /**
   * X 会复用时间线 DOM；设置、语言或保护名单变化后，必须撤掉旧结论再重扫。
   * 否则「关闭检测」只影响新推文，屏幕上原有黄框仍会残留，用户会误以为开关失效。
   */
  function resetPageDecorations(): void {
    state.pageMarked.clear();
    state.notifyPageMarkedChanged();
    controller.reset();
    for (const cell of document.querySelectorAll(`[${MARK_ATTRIBUTE}]`)) {
      cell.removeAttribute(MARK_ATTRIBUTE);
    }
    for (const element of document.querySelectorAll('.fs-badge, [data-fs-action="block"]')) {
      element.remove();
    }
    controller.fullRescan();
  }

  /** 只刷新状态变化账号，避免一次拉黑让整页黄框先塌再长回来。 */
  function resetPageDecorationsForHandles(handles: ReadonlySet<string>): void {
    const context = contextFromPath(location.pathname);
    const cells = new Set<Element>();
    const articles: Element[] = [];
    const matches: Array<{ article: Element; handle: string; cell: Element }> = [];
    const handlesWithPendingFeedback = new Set<string>();
    for (const article of document.querySelectorAll(tweetSelectors.article)) {
      const item = extractFeedItem(article, context);
      const handle = item?.author.handle.toLowerCase();
      if (!handle || !handles.has(handle)) continue;
      const cell = article.closest(tweetSelectors.timelineCell) ?? article;
      matches.push({ article, handle, cell });
      if (cell.querySelector('.fs-block-now:disabled, .fs-manual-mark:disabled')) {
        handlesWithPendingFeedback.add(handle);
      }
    }
    for (const match of matches) {
      // 账本清理与屏幕反馈解耦：即使该账号正处于拉黑成功的 650ms 反馈窗
      //（cell 上有 disabled 按钮，DOM 清理延后避免局部高度变更），
      // pageMarked 也必须立即删除，否则弹窗清单里永远残留旧条目。
      state.pageMarked.delete(match.handle);
      state.notifyPageMarkedChanged();
      // 拉黑成功后的 650ms 成功反馈必须留在屏幕上；同账号其它 cell 也一并延后，
      // 否则仍会在点击瞬间造成局部高度变更。
      if (handlesWithPendingFeedback.has(match.handle)) continue;
      controller.dropSnapshot(match.article);
      articles.push(match.article);
      cells.add(match.cell);
    }
    if (cells.size === 0) return;

    mutateWithStableViewport(cells, () => {
      for (const cell of cells) {
        cell.removeAttribute(HIDDEN_TWEET_CELL_ATTRIBUTE);
        cell.removeAttribute(MARK_ATTRIBUTE);
        for (const badge of cell.querySelectorAll('.fs-badge')) badge.remove();
      }
      for (const article of articles) {
        for (const action of article.querySelectorAll('[data-fs-action="block"]')) action.remove();
      }
    });
    // 只把受影响的 article 重新入队：不再依赖「脏集合为空 -> 全页扫描」的旧路径
    for (const article of articles) controller.markDirty(article);
    controller.schedule();
  }

  return {
    refreshAllowCache,
    refreshFollowingCache,
    refreshBlockedCache,
    refreshSelfCache,
    refreshCommunity,
    refreshKeywordHeuristics,
    resetPageDecorations,
    resetPageDecorationsForHandles,
  };
}

export type StateSync = ReturnType<typeof createStateSync>;
