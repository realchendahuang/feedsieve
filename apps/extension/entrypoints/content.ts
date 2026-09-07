import { toHandleSet, type Detection } from '@feedsieve/detector';
import { runQueuedBlocks } from '@feedsieve/block-queue';
import { PageScanController, scanRevision } from '../src/lib/page-scan-controller';
import {
  contextFromPath,
  extractFeedItem,
  noteTimelineHealth,
  parseXApiResponse,
  readCapabilities,
  readCsrfToken,
  resolveUserIdByHandle,
  runNativeAction,
  tweetSelectors,
  X_WEB_BEARER,
  type ParsedApiData,
} from '@feedsieve/x-adapter';
import { getBlockedAccounts, markBlocked, subscribeBlocked } from '../src/lib/blocked-accounts';
import { bumpStat } from '../src/lib/local-stats';
import { bumpDaily } from '../src/lib/daily-stats';
import {
  HIDDEN_TWEET_CELL_ATTRIBUTE,
  hideCellsSoon,
  mutateWithStableViewport,
} from '../src/lib/remove-tweets';
import { runUnblockBatch } from '../src/lib/run-unblock-batch';
import { getUserId, saveUserIds } from '../src/lib/user-ids';
import {
  buildRuntimeCommunity,
  requestOfficialPauseCheck,
  subscribeCommunity,
  type RuntimeCommunity,
} from '../src/lib/community-store';
import {
  addAllowlist,
  getAllowlist,
  removeAllowed,
  subscribeAllowlist,
} from '../src/lib/allowlist';
import {
  contributeBlocks,
  rescueHandle,
  syncLocalLabels,
} from '../src/lib/contribute';
import { getCommunitySettings } from '../src/lib/community-store';
import { runDetectionPipeline, type BlockEvidence } from '../src/lib/detection-pipeline';
import {
  clearFollowingSyncDraft,
  getFollowingAllowlist,
  getFollowingSyncDraft,
  getFollowingSyncState,
  getSelfHandle,
  removeFollowingAccount,
  replaceFollowingAccounts,
  setFollowingSyncDraft,
  setFollowingSyncState,
  setSelfHandle,
  subscribeFollowingAllowlist,
  upsertFollowingAccounts,
} from '../src/lib/following-allowlist';
import {
  createPersistentBlockQueue,
  getPersistentBlockQueue,
  setPersistentBlockQueue,
  type PersistentBlockQueueState,
} from '../src/lib/block-queue-store';
import {
  currentAccountKey,
  DEFAULT_PRESET,
  loadSafetyLedger,
  paceForPreset,
  persistSignal,
  RATE_LIMIT_STORM_THRESHOLD,
  recordSafetyEvent,
  remainingQuota,
  type SafetyPreset,
} from '../src/lib/block-safety';
import {
  getUiLanguage,
  subscribeUiLanguage,
  type UiLanguage,
} from '../src/lib/i18n';
import {
  createKeywordHeuristics,
  getKeywordRuleSettings,
  subscribeKeywordRules,
} from '../src/lib/keyword-rules';
import {
  BUNDLED_KEYWORD_PACK_CATALOG,
  getKeywordPackCatalog,
  KEYWORD_PACK_SYNC_MAX_AGE_MS,
  subscribeKeywordPackCatalog,
  type KeywordPackCatalog,
} from '../src/lib/keyword-packs';
import builtinListJson from '../../../community/lists/official.json';

/**
 * 最近一次公开最终名单随扩展打包，作为离线兜底。
 * 社区名单走运行时同步（background SW -> storage.local -> 这里建索引），
 * 服务器快照永远是权威来源。
 */
const BUILTIN_LIST = toHandleSet((builtinListJson as { entries: unknown }).entries as never[]);

const MARK_ATTRIBUTE = 'data-fs-marked';
const STYLE_ELEMENT_ID = 'feedsieve-mark-styles';

/** 页面内一个黄框账号待处理时的标记数据（一键拉黑 = 页面全部黄框）。 */
interface PageMarkedAccount {
  handle: string;
  xUserId?: string;
  category: string;
  /** 标注理由（popup 页面黄框清单展示用） */
  reason: string;
  evidence: BlockEvidence;
}

/**
 * Phase 1 content script：黄框标注（带理由）。一键拉黑 = 当前页面全部黄框账号。
 *
 * - ISOLATED world（冻结决策）
 * - 标注绝不改动页面内容显示，也不破坏 X 布局。
 *   借鉴成熟方案（PureTwitter / TBWL）：
 *   1. 黄圈打在 article 的外层 cellInnerDiv 上 —— 纯 border，无背景色；
 *      绝不往 article（CSS grid 容器）里塞元素。
 *   2. 理由徽章作为 cellInnerDiv 的块级子元素排在推文下方，不覆盖任何内容。
 * - MutationObserver 只发现候选节点，WeakSet 去重，debounce 批量扫描
 * - XHR 桥（xhr-bridge.content.ts，MAIN world）通过 CustomEvent 送来
 *   GraphQL 权威数据：在这里缓存 rest_id（拉黑 API 必需）与 bio（检测增强）。
 * - 页面黄框集合 pageMarked 是会话内内存态：拉黑成功即移除，
 *   页面刷新后重新扫描重建（不需要跨页面持久化）。
 */
export default defineContentScript({
  matches: ['https://x.com/*'],
  main() {
    // 扫描调度 / 节点索引 / revision 快照 / MutationObserver 全部收敛到 PageScanController；
    // 检测与标注通过 callbacks 注入（见下方 scanOne / flushPendingBadges）。
    const controller = new PageScanController({
      processOne: (article, context, pendingBadges) => {
        scanOne(article, context, pendingBadges);
      },
      flushBadges: (pendingBadges) => {
        flushPendingBadges(pendingBadges);
      },
      noteHealth: (ok, reason) => {
        noteTimelineHealth(ok, reason);
      },
    });
    const dirtyHandles = new Set<string>();
    /** 当前页面所有黄框账号（剔除已拉黑回显：它们已经在黑名单里） */
    const pageMarked = new Map<string, PageMarkedAccount>();
    /** handle -> bio（XHR 桥提供，检测用；DOM 拿不到简介） */
    const bioCache = new Map<string, string>();
    /** 白名单缓存：一票否决，最高优先级 */
    const allowCache = new Set<string>();
    /** 当前用户自己的关注保护：仅本地，永不上传社区。 */
    const followingCache = new Set<string>();
    /** 已拉黑名单缓存：X 偶尔仍会展示已拉黑账号（f=live 等），需要标注 */
    const blockedCache = new Set<string>();
    /** 社区最终名单运行时状态（快照同步后的索引） */
    let community: RuntimeCommunity | null = null;
    /** 检测总开关；关闭后仍保留用户主动「标记垃圾并拉黑」入口。 */
    let detectionEnabled = true;
    /** 自动贡献总开关（决定「抢救」按钮是否出现） */
    let autoContribute = true;
    let strength: 'refresh' | 'standard' | 'deep_clean' = 'standard';
    let uiLanguage: UiLanguage = 'zh';
    /** 用户词与官方可配置词库：只给人工确认黄框，必须由用户点击才会拉黑。 */
    let keywordHeuristics: ReturnType<typeof createKeywordHeuristics> = [];
    let keywordCatalog: KeywordPackCatalog = BUNDLED_KEYWORD_PACK_CATALOG;
    let runningFollowingSync: Promise<void> | null = null;
    let runningPersistentQueue: Promise<void> | null = null;

    ensureStyles();
    refreshAllowCache();
    refreshFollowingCache();
    refreshBlockedCache();
    void refreshCommunity();
    void refreshKeywordHeuristics();
    void getUiLanguage().then((language) => {
      uiLanguage = language;
    });
    subscribeUiLanguage((language) => {
      uiLanguage = language;
      resetPageDecorations();
    });
    subscribeKeywordRules((settings) => {
      keywordHeuristics = createKeywordHeuristics(settings, keywordCatalog);
      resetPageDecorations();
    });
    subscribeKeywordPackCatalog((catalog) => {
      keywordCatalog = catalog;
      void refreshKeywordHeuristics().then(resetPageDecorations);
    });
    listenXhrBridge();
    // 请 background SW 同步社区快照（社区名单仍按自己的节流策略更新）。
    void browser.runtime.sendMessage({ type: 'feedsieve:community-sync' }).catch(() => {
      // SW 暂不可达（开发热重载等）：下次页面加载再试
    });
    const requestKeywordPackSync = (): void => {
      void browser.runtime.sendMessage({ type: 'feedsieve:keyword-packs-sync' }).catch(() => {
        // 词库远程同步失败时，继续用最后一次校验通过的版本或内置版本。
      });
    };
    requestKeywordPackSync();
    window.setInterval(requestKeywordPackSync, KEYWORD_PACK_SYNC_MAX_AGE_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') requestKeywordPackSync();
    });
    void pauseOrphanedPersistentQueue();

    /**
     * popup「一键拉黑 / 一键撤销」入口：这里执行需要页面会话的原生操作，
     * 返回 Promise 作为 sendMessage 的响应（批量汇总见 run-block/run-unblock-batch.ts）。
     */
    browser.runtime.onMessage.addListener((message: unknown) => {
      const msg = message as {
        type?: string;
        handle?: string;
        targetTabId?: number;
        items?: Array<{ handle: string; xUserId?: string; category: string }>;
      } | null;
      const type = msg?.type;
      // 一键拉黑 = 当前页面全部黄框账号（用户拍板的交互语义）
      if (type === 'feedsieve:run-page-block') {
        return startPersistentQueue(
          'page-batch',
          [...pageMarked.values()].map((item) => ({
            handle: item.handle,
            category: item.category,
            reason: item.reason,
            evidence: item.evidence,
            // 防自我放大：社区名单命中（采用既有结论）不上报，其余独立发现保持计票。
            // evidence.detectionSource 已在 markCell 写入 detection.source。
            communityVote: item.evidence.detectionSource !== 'community-list',
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
      if (type === 'feedsieve:following-sync-start') {
        return startFollowingFullSync();
      }
      if (type === 'feedsieve:community-block-start' && Array.isArray(msg?.items)) {
        return startPersistentQueue('community-batch', msg.items, msg.targetTabId);
      }
      if (type === 'feedsieve:capabilities') {
        // popup 用：当前 X 会话 / Block 接口 / 解析 / 扫描的能力快照（非破坏性观测）
        return Promise.resolve(readCapabilities());
      }
      if (type === 'feedsieve:block-queue-resume') {
        return resumePersistentQueue();
      }
      if (type === 'feedsieve:block-queue-pause') {
        return updatePersistentQueueStatus('paused');
      }
      if (type === 'feedsieve:block-queue-cancel') {
        return cancelPersistentQueue();
      }
      return undefined;
    });

    /** popup「一键拉黑」需要的页面黄框快照（发往活动 tab 实时查询）。 */
    browser.runtime.onMessage.addListener((message: unknown) => {
      const type = (message as { type?: string } | null)?.type;
      if (type === 'feedsieve:page-marked-list') {
        // 必须 Promise：Chrome 原生 onMessage 只认 true / Promise 作为异步响应，
        // 同步返回数组会被忽略，popup 收到 undefined（v0.7.0 真机回归捕获）
        return Promise.resolve(
          [...pageMarked.values()].map((m) => ({
            handle: m.handle,
            category: m.category,
            reason: m.reason,
          })),
        );
      }
      return undefined;
    });

    /** 消费 MAIN world XHR 桥的数据：rest_id 入库（LRU 上限内），bio 进内存缓存。 */
    function listenXhrBridge(): void {
      // 注意：桥 dispatch 在共享的 document 上；window 是各 world 独立的，监听 window 收不到
      document.addEventListener('feedsieve:xhr-items', (event) => {
        try {
          const parsed = JSON.parse((event as CustomEvent<string>).detail) as ParsedApiData;
          if (!parsed || !Array.isArray(parsed.matchedEndpoints)) {
            return;
          }
          const idEntries: Array<{ handle: string; xUserId: string }> = [];
          const followedEntries: Array<{ handle: string; xUserId?: string }> = [];
          for (const tweet of parsed.tweets ?? []) {
            if (tweet.author.xUserId) {
              idEntries.push({ handle: tweet.author.handle, xUserId: tweet.author.xUserId });
            }
            if (tweet.author.following === true) {
              followedEntries.push({
                handle: tweet.author.handle,
                ...(tweet.author.xUserId ? { xUserId: tweet.author.xUserId } : {}),
              });
            }
            if (tweet.author.bio) {
              const handle = tweet.author.handle.toLowerCase();
              if (bioCache.get(handle) !== tweet.author.bio) {
                bioCache.set(handle, tweet.author.bio);
                if (bioCache.size > BIO_CACHE_MAX) {
                  // 近似 LRU：Map 保插入序，挤掉最早入缓存的一条
                  const oldest = bioCache.keys().next().value;
                  if (oldest !== undefined) bioCache.delete(oldest);
                }
                dirtyHandles.add(handle);
              }
            }
          }
          for (const member of parsed.listMembers ?? []) {
            idEntries.push({ handle: member.handle, xUserId: member.xUserId });
          }
          for (const followed of parsed.following ?? []) {
            followedEntries.push(followed);
            if (followed.xUserId) {
              idEntries.push({ handle: followed.handle, xUserId: followed.xUserId });
            }
          }
          if (parsed.selfHandle) {
            void setSelfHandle(parsed.selfHandle);
          }
          const isFollowingPage = parsed.matchedEndpoints.includes('Following');
          // Timeline 里明确带 following=true 的作者可即时加入保护；完整 Following
          // 分页必须只写 draft，直到所有 cursor 结束才原子替换，避免失败留下半截名单。
          if (followedEntries.length > 0 && !isFollowingPage) {
            void upsertFollowingAccounts(followedEntries).catch(() => {
              // 本地关注保护写入失败不影响 X 页面
            });
          }
          if (isFollowingPage) {
            void handleFollowingSyncPage(parsed);
          }
          if (idEntries.length > 0) {
            void saveUserIds(idEntries).catch(() => {
              // 存储失败不阻塞浏览；下次同账号出现会重试
            });
          }
          // bio is authoritative data that often arrives after the first DOM
          // pass. Only invalidate cards for the handles whose bio changed.
          if (dirtyHandles.size > 0) {
            for (const handle of dirtyHandles) {
              controller.markDirtyForBio(handle);
            }
            dirtyHandles.clear();
          }
          controller.schedule();
        } catch {
          // detail 非法 JSON：静默
        }
      });
    }

    function refreshBlockedCache(): void {
      const apply = (items: Array<{ handle: string }>): void => {
        const next = new Set(items.map((item) => item.handle.toLowerCase()));
        const added = new Set([...next].filter((handle) => !blockedCache.has(handle)));
        const removed = new Set([...blockedCache].filter((handle) => !next.has(handle)));
        blockedCache.clear();
        for (const handle of next) blockedCache.add(handle);

        // 拉黑不再触发整页徽章拆装。新增项只折叠对应账号的 cell；撤销项仅重扫
        // 对应账号，让已隐藏的行重新进入正常检测路径。
        if (added.size > 0) hideNewlyBlockedCells(added);
        if (removed.size > 0) resetPageDecorationsForHandles(removed);
      };
      void getBlockedAccounts()
        .then(apply)
        .catch(() => {
          // storage 异常保持旧缓存
        });
      subscribeBlocked(apply);
    }

    /**
     * 索引优先地收集某账号当前页面的 cell：先查扫描维护的 handle 反向索引，
     * 再补上尚未入索引的 dirty article；候选逐一用 extractFeedItem 复核。
     * 批量拉黑队列每个 handle 都要取一次 cell，全页版会放大成 N 次整页扫描。
     * 索引与脏集合都收敛在 PageScanController，这里只做端口。
     */
    function collectCellsForHandle(handle: string): Element[] {
      return controller.cellsForHandle(handle);
    }

    function hideNewlyBlockedCells(handles: ReadonlySet<string>): void {
      for (const handle of handles) {
        const cells = collectCellsForHandle(handle);
        // 当前 tab 正在给这个账号展示「拉黑中 / 已拉黑」反馈时，让调用方维持原有
        // 650ms 反馈窗口；其它 tab 或页面刷新后的同步则立即隐藏。
        if (cells.length === 0 || hasPendingBlockFeedback(cells)) continue;
        hideCellsSoon(cells, 0);
      }
    }

    function hasPendingBlockFeedback(cells: readonly Element[]): boolean {
      return cells.some(
        (cell) => cell.querySelector('.fs-block-now:disabled, .fs-manual-mark:disabled') !== null,
      );
    }

    function replaceHandleCache(
      cache: Set<string>,
      items: ReadonlyArray<{ handle: string }>,
    ): Set<string> {
      const next = new Set(items.map((item) => item.handle.toLowerCase()));
      const changed = new Set([...next].filter((handle) => !cache.has(handle)));
      for (const handle of cache) {
        if (!next.has(handle)) changed.add(handle);
      }
      cache.clear();
      for (const handle of next) cache.add(handle);
      return changed;
    }

    // 快照/设置变化（同步、换强度档）实时生效到下一次扫描；只订阅一次
    subscribeCommunity(() => {
      void refreshCommunity()
        .then(resetPageDecorations)
        .catch(() => {
          // 刷新失败保持旧索引
        });
    });

    function refreshAllowCache(): void {
      const apply = (items: Array<{ handle: string }>): void => {
        const changed = replaceHandleCache(allowCache, items);
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
        const changed = replaceHandleCache(followingCache, items);
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
      community = await buildRuntimeCommunity();
      const settings = await getCommunitySettings();
      detectionEnabled = settings.enabled;
      strength = settings.strength;
      autoContribute = settings.autoContribute;
    }

    async function refreshKeywordHeuristics(): Promise<void> {
      keywordCatalog = await getKeywordPackCatalog();
      keywordHeuristics = createKeywordHeuristics(await getKeywordRuleSettings(), keywordCatalog);
      controller.fullRescan();
    }

    /**
     * X 会复用时间线 DOM；设置、语言或保护名单变化后，必须撤掉旧结论再重扫。
     * 否则「关闭检测」只影响新推文，屏幕上原有黄框仍会残留，用户会误以为开关失效。
     */
    function resetPageDecorations(): void {
      pageMarked.clear();
      controller.reset();
      for (const cell of document.querySelectorAll(`[${MARK_ATTRIBUTE}]`)) {
        cell.removeAttribute(MARK_ATTRIBUTE);
      }
      for (const element of document.querySelectorAll('.fs-badge, .fs-manual-mark')) {
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
        // 拉黑成功后的 650ms 成功反馈必须留在屏幕上；同账号其它 cell 也一并延后，
        // 否则仍会在点击瞬间造成局部高度变更。
        if (handlesWithPendingFeedback.has(match.handle)) continue;
        controller.dropSnapshot(match.article);
        pageMarked.delete(match.handle);
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
          for (const action of article.querySelectorAll('.fs-manual-mark')) action.remove();
        }
      });
      // 只把受影响的 article 重新入队：不再依赖「脏集合为空 -> 全页扫描」的旧路径
      for (const article of articles) controller.markDirty(article);
      controller.schedule();
    }

    /**
     * 单个 article 的提取 + 检测 + 标注。
     * 只处理传入的这一个节点；调度（脏集合、分片、防重入）由 PageScanController 负责。
     */
    function scanOne(
      rawArticle: Element,
      context: ReturnType<typeof contextFromPath>,
      pendingBadges: PendingBadge[],
    ): void {
      const article = rawArticle;
      const element = rawArticle;
      // X 虚拟列表可能在扫描排队期间把节点回收掉
      if (!element.isConnected) {
        controller.forget(element);
        return;
      }
      const item = extractFeedItem(element, context);
      if (!item) {
        controller.dropSnapshot(element);
        return;
      }
      const handle = item.author.handle.toLowerCase();
      controller.remember(element, handle);
      const bio = bioCache.get(handle);
      // revision 快照：虚拟列表复用同一 article 时跳过已标注过的输入
      if (!controller.hasChanged(element, scanRevision(item, bio))) {
        return;
      }

      const input = {
        handle: item.author.handle,
        displayName: item.author.displayName,
        text: item.text,
        bio,
        links: item.links,
      };

      // 用户已经显式拉黑的账号高于检测开关/白名单保护：X 若又把它渲染出来，
      // 直接以非破坏性的方式折叠该 cell，而不是插入一个会再次改变高度的提示条。
      if (blockedCache.has(handle)) {
        const cell = article.closest(tweetSelectors.timelineCell) ?? article;
        pageMarked.delete(handle);
        hideCellsSoon([cell], 0);
        return;
      }

      // 检测 / 增强 / 分层 / 分类推导统一走 detection-pipeline（可独立单测的单元）
      const result = runDetectionPipeline({
        input,
        community,
        builtinList: BUILTIN_LIST,
        keywordHeuristics,
        catalog: keywordCatalog,
        strength,
        uiLanguage,
      });
      const isProtected = allowCache.has(handle) || followingCache.has(handle);
      if (isProtected || !detectionEnabled || result.presentation === 'ignore') {
        attachManualAction(article as HTMLElement, handle, result.evidence);
        return;
      }

      // 标注打在外层时间线格子上（PureTwitter 同款目标层）；找不到才退回 article
      const cell = article.closest(tweetSelectors.timelineCell) ?? article;
      markCell(
        cell as HTMLElement,
        result.detection!,
        result.category ?? 'other',
        result.evidence,
        pendingBadges,
      );
    }

    interface PendingBadge {
      cell: HTMLElement;
      badge: HTMLElement;
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


    // 页面变化监听 + 扫描调度：收敛在 PageScanController（有脏才调度，反馈环由
    // .fs-badge/.fs-manual-mark 过滤；无关 mutation 直接忽略）
    controller.observe(document.body);

    // SPA 路由变化：X 不触发页面加载，靠 History API 探测以刷新 context
    window.addEventListener('popstate', () => controller.fullRescan());
    window.addEventListener('hashchange', () => controller.fullRescan());

    controller.fullRescan();

    // ---------- 标注 UI ----------

    function attachManualAction(
      article: HTMLElement,
      handle: string,
      evidence: BlockEvidence,
    ): void {
      if (article.querySelector('[data-fs-manual-action]')) return;
      const actionAnchor = article.querySelector(tweetSelectors.actionAnchor);
      const actionGroup = actionAnchor?.closest(tweetSelectors.actionGroup);
      if (!actionGroup) return;

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'fs-manual-mark';
      button.setAttribute('data-fs-manual-action', 'true');
      const idleLabel = uiLanguage === 'zh' ? '标记' : 'Mark';
      button.textContent = idleLabel;
      button.title = uiLanguage === 'zh' ? '标记为垃圾账号并拉黑' : 'Mark as spam and block';
      button.setAttribute('aria-label', button.title);
      button.addEventListener('click', () => {
        void (async () => {
          button.disabled = true;
          button.textContent = uiLanguage === 'zh' ? '拉黑中…' : 'Blocking…';
          const outcome = await runManualSpamBlock(handle, evidence);
          if (outcome.ok) {
            button.textContent = uiLanguage === 'zh' ? '已拉黑 ✓' : 'Blocked ✓';
            hideCellsSoon(collectCellsForHandle(handle));
            return;
          }
          button.textContent = `${uiLanguage === 'zh' ? '失败' : 'Failed'} ${outcome.code}`;
          window.setTimeout(() => {
            button.disabled = false;
            button.textContent = idleLabel;
          }, 3000);
        })();
      });
      actionGroup.appendChild(button);
    }

    async function runManualSpamBlock(
      rawHandle: string,
      evidence: BlockEvidence = {},
    ): Promise<{ ok: true; handle: string } | { ok: false; code: string }> {
      const handle = normalizeManualHandle(rawHandle);
      if (!handle) return { ok: false, code: 'invalid-handle' };
      const outcome = await blockOne(
        { handle, category: 'other', reason: '', evidence: { ...evidence, detectionSource: 'manual' } },
        {
          origin: 'manual-spam',
          communityVote: true,
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

    function markCell(
      cell: HTMLElement,
      detection: Detection,
      category: string,
      evidence: BlockEvidence,
      pendingBadges: PendingBadge[],
    ): void {
      cell.setAttribute(MARK_ATTRIBUTE, detection.source);
      const badge = buildBadge(cell, detection, category, evidence);
      // 徽章不立即挂载：同批标注集中到 flushPendingBadges 一次插入，
      // 避免逐条改高度 + 逐条触发滚动锚定。
      if (badge) pendingBadges.push({ cell, badge });
      // 页面上用户能看到的每一个黄框，都必须出现在 popup 的待处理清单里。
      // 安全边界是「必须由用户点击一键拉黑」，而不是再暗藏一层不可见的置信门槛。
      if (detection.source !== 'blocked') {
        pageMarked.set(detection.handle, {
          handle: detection.handle,
          category,
          reason: detection.reason,
          evidence: { ...evidence, detectionSource: detection.source },
        });
      }
      // 本地统计：每次新标注 +1（扫描快照保证每个 cell 只标一次）；
      // 已拉黑回显不是新发现，不计数
      if (detection.source !== 'blocked') {
        void bumpStat('detected').catch(() => {
          // 统计写入失败不影响标注
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
      blockBtn.textContent = uiLanguage === 'zh' ? '拉黑' : 'Block';
      blockBtn.title = uiLanguage === 'zh' ? '标记垃圾账号并拉黑' : 'Mark as spam and block';
      blockBtn.addEventListener('click', () => {
        // 「采用既有结论」与「独立发现」分开：本地自定义关键词是个人偏好，
        // 社区名单命中的账号已在公开名单内 —— 两者都不应反向加票。
        // 其余检测来源（官方词库 / 指纹 / 域名）是独立发现，正常计票。
        const communityVote =
          detection.source !== 'community-list' && !detection.ruleId?.startsWith('keyword:');
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
      allowBtn.textContent = '误标？';
      allowBtn.title = '加入个人白名单，并提交这条规则的误标反馈';
      allowBtn.addEventListener('click', () => {
        void (async () => {
          const feedback = {
            detectionSource: detection.source,
            ...(detection.ruleId ? { ruleId: detection.ruleId } : {}),
            detectionReason: detection.reason,
          };
          const xUserId = (await getUserId(detection.handle)) ?? undefined;
          await addAllowlist(detection.handle, xUserId, feedback);
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
        detection.source === 'community-list' && autoContribute
          ? (() => {
              const btn = document.createElement('button');
              btn.className = 'fs-allow';
              btn.type = 'button';
              btn.textContent = '抢救';
              btn.title = '向社区投票：这个标注可能误伤了';
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
                    btn.textContent = '已抢救 ✓';
                    setTimeout(() => {
                      btn.remove();
                    }, 2000);
                  } else {
                    btn.textContent = '失败';
                    setTimeout(() => {
                      btn.disabled = false;
                      btn.textContent = '抢救';
                    }, 3000);
                  }
                })();
              });
              return btn;
            })()
          : null;

      secondaryGroup.append(...(rescueBtn ? [rescueBtn] : []), allowBtn);

      badge.append(label, primaryGroup, secondaryGroup);
      // cellInnerDiv 是普通块容器：徽章作为新块级子元素排在推文下方，
      // 处于文档流内但不进入 article 的 grid，不覆盖、不挤压任何 X 内容。
      // 挂载时机由 flushPendingBadges 批量决定（见 markCell）。
      return badge;
    }

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
      } = {},
    ): Promise<
      | { ok: true }
      | { ok: false; code: string; httpStatus?: number; retryAfterMs?: number }
    > {
      // 官方破坏性动作暂停开关：本地快照命中立刻拦截（零额外请求）；
      // 否则实时问一次 /v1/kill-switch（background 30s TTL 缓存），网络失败回退快照。
      // 只关闭拉黑类动作，检测 / 标注 / 读取继续；单向开关，不可能远程开启自动拉黑。
      if (community?.killSwitch?.destructive_actions_disabled) {
        return { ok: false, code: 'kill_switch' };
      }
      const officialPause = await requestOfficialPauseCheck();
      if (officialPause.destructive_actions_disabled) {
        return { ok: false, code: 'kill_switch' };
      }
      let xUserId: string | undefined | null = item.xUserId ?? (await getUserId(item.handle));
      if (!xUserId) {
        const resolved = await resolveUserIdByHandle(item.handle);
        if (resolved.ok) {
          xUserId = resolved.xUserId;
          void saveUserIds([{ handle: item.handle, xUserId }]).catch(() => {
            // 回填失败不影响本次拉黑
          });
        } else {
          // 解析失败如实归类：「账号已不存在」与「限流/网络」分开，后者交给队列退避重试
          console.warn(
            `[FeedSieve] resolve @${item.handle} failed:`,
            resolved.code,
            resolved.statusCode ?? '',
          );
          return {
            ok: false,
            code: resolved.code === 'no_csrf' ? 'missing_csrf' : resolved.code,
            ...(resolved.statusCode !== undefined ? { httpStatus: resolved.statusCode } : {}),
          };
        }
      }

      const result = await runNativeAction('block', xUserId);
      if (!result.ok) {
        return {
          ok: false,
          code: result.code,
          ...(result.statusCode !== undefined ? { httpStatus: result.statusCode } : {}),
          ...(result.retryAfterMs !== undefined ? { retryAfterMs: result.retryAfterMs } : {}),
        };
      }
      // 记账（撤销入口的数据源）+ 本地统计
      await markBlocked(item.handle, xUserId, {
        category: item.category,
        ...item.evidence,
        ...(options.origin ? { origin: options.origin } : {}),
        ...(typeof options.communityVote === 'boolean'
          ? { communityVote: options.communityVote }
          : {}),
        ...(options.batchId ? { batchId: options.batchId } : {}),
      });
      await bumpStat('blocked');
      // v0.6 战报：今日拉黑 + 分类计数
      await bumpDaily('blocked', item.category);
      // 安全账本：只记确认成功的写操作；顺手拉黑与队列拉黑共用同一本账（docs/BLOCK_SAFETY.md）
      await recordSafetyEvent(currentAccountKey());
      // 摩擦设计：拉黑成功即自动贡献社区（无弹窗；全局开关在 contributeBlocks 内判断）
      if (options.communityVote !== false && !options.deferContribution) {
        contributeBlocks([
          { handle: item.handle, xUserId, category: item.category, ...item.evidence },
        ]);
      }
      return { ok: true };
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
        button.textContent = '拉黑中…';
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
          button.textContent = '已拉黑 ✓';
          pageMarked.delete(handle);
          hideCellsSoon(collectCellsForHandle(handle));
        } else {
          // 如实反馈失败原因（auth_required / rate_limited / network_error…）
          button.textContent = `失败 ${outcome.code}`;
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

    async function startFollowingFullSync(): Promise<
      { status: 'navigating'; url: string } | { status: 'error'; error: string }
    > {
      const selfHandle = await getSelfHandle();
      if (!selfHandle) {
        return { status: 'error', error: 'self_handle_unknown' };
      }
      const now = Date.now();
      await clearFollowingSyncDraft();
      await setFollowingSyncState({
        status: 'waiting',
        collected: 0,
        startedAt: now,
        updatedAt: now,
      });
      const url = `https://x.com/${selfHandle}/following`;
      // 用户显式点了同步；进入 X 自己的关注页触发首页 GraphQL，
      // 之后由 handleFollowingSyncPage 使用 cursor 继续分页。
      location.assign(url);
      return { status: 'navigating', url };
    }

    async function handleFollowingSyncPage(parsed: ParsedApiData): Promise<void> {
      const syncState = await getFollowingSyncState();
      if (syncState.status !== 'waiting' && syncState.status !== 'running') return;
      if (Date.now() - syncState.updatedAt > 60_000) {
        await setFollowingSyncState({
          ...syncState,
          status: 'error',
          updatedAt: Date.now(),
          error: 'following_sync_interrupted',
        });
        return;
      }
      if (runningFollowingSync) return runningFollowingSync;
      runningFollowingSync = continueFollowingSync(parsed).finally(() => {
        runningFollowingSync = null;
      });
      return runningFollowingSync;
    }

    async function continueFollowingSync(firstPage: ParsedApiData): Promise<void> {
      const started = await getFollowingSyncState();
      const startedAt = started.startedAt ?? Date.now();
      let draft = await getFollowingSyncDraft();
      const byHandle = new Map(draft.map((item) => [item.handle, item]));
      const addPage = (page: ParsedApiData): number => {
        const sizeBefore = byHandle.size;
        for (const account of page.following ?? []) {
          const handle = account.handle.trim().replace(/^@+/, '').toLowerCase();
          if (!handle) continue;
          const existing = byHandle.get(handle);
          byHandle.set(handle, {
            handle,
            ...(account.xUserId || existing?.xUserId
              ? { xUserId: account.xUserId ?? existing?.xUserId }
              : {}),
          });
        }
        return byHandle.size - sizeBefore;
      };

      try {
        let page = firstPage;
        let sourceUrl = page.sourceUrl;
        const seenCursors = new Set<string>();
        let consecutivePagesWithoutNewAccounts = 0;
        let reachedSafetyLimit = true;
        for (let pageNumber = 0; pageNumber < 1000; pageNumber++) {
          const added = addPage(page);
          consecutivePagesWithoutNewAccounts =
            added === 0 ? consecutivePagesWithoutNewAccounts + 1 : 0;
          draft = [...byHandle.values()];
          await setFollowingSyncDraft(draft);
          await setFollowingSyncState({
            status: 'running',
            collected: draft.length,
            startedAt,
            updatedAt: Date.now(),
          });

          // X 的 Following 时间线到末尾后仍会继续发只含导航 cursor 的空页；
          // 连续空页才是稳定终止信号，单个空页仍允许跨越时间线间隙。
          if (consecutivePagesWithoutNewAccounts >= 3) {
            reachedSafetyLimit = false;
            break;
          }

          const cursor = page.followingCursor;
          if (!cursor) {
            reachedSafetyLimit = false;
            break;
          }
          if (!sourceUrl || seenCursors.has(cursor)) {
            throw new Error(!sourceUrl ? 'following_source_url_missing' : 'following_cursor_loop');
          }
          seenCursors.add(cursor);
          await sleep(650);
          page = await fetchFollowingPage(sourceUrl, cursor);
          sourceUrl = page.sourceUrl ?? sourceUrl;
        }

        if (reachedSafetyLimit) {
          throw new Error('following_page_limit_reached');
        }

        const complete = [...byHandle.values()];
        await replaceFollowingAccounts(complete);
        await clearFollowingSyncDraft();
        await setFollowingSyncState({
          status: 'complete',
          collected: complete.length,
          startedAt,
          updatedAt: Date.now(),
        });
      } catch (error) {
        await setFollowingSyncState({
          status: 'error',
          collected: byHandle.size,
          startedAt,
          updatedAt: Date.now(),
          error: error instanceof Error ? error.message : 'following_sync_failed',
        });
      }
    }

    async function fetchFollowingPage(sourceUrl: string, cursor: string): Promise<ParsedApiData> {
      const csrf = readCsrfToken();
      if (!csrf) throw new Error('missing_csrf');
      const url = new URL(sourceUrl);
      const rawVariables = url.searchParams.get('variables');
      if (!rawVariables) throw new Error('following_variables_missing');
      const variables = JSON.parse(rawVariables) as Record<string, unknown>;
      variables.cursor = cursor;
      url.searchParams.set('variables', JSON.stringify(variables));
      for (let attempt = 0; attempt < 2; attempt++) {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 15_000);
        try {
          const response = await fetch(url.toString(), {
            method: 'GET',
            credentials: 'include',
            signal: controller.signal,
            headers: {
              Authorization: X_WEB_BEARER,
              'X-Twitter-Auth-Type': 'OAuth2Session',
              'X-Twitter-Active-User': 'yes',
              'X-Csrf-Token': csrf,
            },
          });
          if (!response.ok) {
            if (attempt === 0 && (response.status === 429 || response.status >= 500)) {
              await sleep(1200);
              continue;
            }
            throw new Error(`following_http_${response.status}`);
          }
          const page = parseXApiResponse(url.toString(), await response.json());
          return { ...page, sourceUrl: url.toString() };
        } catch (error) {
          if (attempt === 0 && (error as { name?: string })?.name === 'AbortError') {
            await sleep(1200);
            continue;
          }
          if ((error as { name?: string })?.name === 'AbortError') {
            throw new Error('following_request_timeout', { cause: error });
          }
          throw error;
        } finally {
          window.clearTimeout(timeout);
        }
      }
      throw new Error('following_request_failed');
    }

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
      if (community?.killSwitch?.destructive_actions_disabled) {
        return { status: 'error', error: 'kill_switch', id: '', count: 0 };
      }
      const officialPause = await requestOfficialPauseCheck();
      if (officialPause.destructive_actions_disabled) {
        return { status: 'error', error: 'kill_switch', id: '', count: 0 };
      }
      const filtered = items.filter((item) => {
        const handle = item.handle.toLowerCase();
        return !allowCache.has(handle) && !followingCache.has(handle) && !blockedCache.has(handle);
      });
      const state = await createPersistentBlockQueue(source, filtered, { targetTabId });
      void runPersistentQueue();
      return { status: 'started', id: state.id, count: state.tasks.length };
    }

    /**
     * 队列执行在 content script 内；页面刷新会中断正在发出的请求。
     * 新页面把这种孤儿 running 状态降为 paused，避免 popup 误报「仍在运行」。
     */
    async function pauseOrphanedPersistentQueue(): Promise<void> {
      const state = await getPersistentBlockQueue();
      if (!state || state.status !== 'running') return;
      state.status = 'paused';
      for (const task of state.tasks) {
        if (task.status === 'running') task.status = 'pending';
      }
      await setPersistentBlockQueue(state);
    }

    async function resumePersistentQueue(): Promise<{ status: string }> {
      const state = await getPersistentBlockQueue();
      if (!state) return { status: 'absent' };
      state.status = 'running';
      delete state.pauseReason;
      for (const task of state.tasks) {
        if (task.status === 'running') task.status = 'pending';
        // 用户显式 resume：清掉退避计时，立即重试
        if (task.status === 'pending') {
          delete task.retryAt;
          delete task.retryAfterMs;
        }
        // 旧版本遗留的 retryable failed 任务（升级前已判死）也放回 pending
        if (
          task.status === 'failed' &&
          ['rate_limited', 'auth_required', 'missing_csrf', 'network_error', 'kill_switch'].includes(
            task.failureCode ?? '',
          )
        ) {
          task.status = 'pending';
          delete task.failureCode;
          delete task.retryAt;
          delete task.retryAfterMs;
        }
      }
      await setPersistentBlockQueue(state);
      void runPersistentQueue();
      return { status: 'running' };
    }

    async function updatePersistentQueueStatus(
      status: 'paused',
    ): Promise<{ status: 'paused' | 'absent' }> {
      const state = await getPersistentBlockQueue();
      if (!state) return { status: 'absent' };
      state.status = status;
      state.pauseReason = 'user';
      await setPersistentBlockQueue(state);
      return { status };
    }

    async function cancelPersistentQueue(): Promise<{ status: 'cancelled' | 'absent' }> {
      const state = await getPersistentBlockQueue();
      if (!state) return { status: 'absent' };
      state.status = 'cancelled';
      for (const task of state.tasks) {
        if (task.status === 'pending' || task.status === 'running') task.status = 'cancelled';
      }
      await setPersistentBlockQueue(state);
      return { status: 'cancelled' };
    }

    async function runPersistentQueue(): Promise<void> {
      if (runningPersistentQueue) return runningPersistentQueue;
      runningPersistentQueue = executePersistentQueue().finally(() => {
        runningPersistentQueue = null;
      });
      return runningPersistentQueue;
    }

    async function executePersistentQueue(): Promise<void> {
      // 状态迁移、失败分类、自适应节奏全部收敛到 packages/block-queue 的唯一 runner；
      // 本函数只注入「持久化适配器 + 真实 Block 动作」，不再维护第二套循环语义。
      await runQueuedBlocks({
        load: () => getPersistentBlockQueue(),
        save: (session) => setPersistentBlockQueue(session as PersistentBlockQueueState),
        perform: async (task) => {
          // 恢复/换源后 source 可能变化：每次执行按当前队列状态取 origin 与贡献策略
          const current = await getPersistentBlockQueue();
          const accountKey = currentAccountKey();
          // 安全额度：响应式预算用尽则本任务不发请求，走 quota_exhausted → 整队暂停（次日手动继续）
          const ledger = await loadSafetyLedger(accountKey);
          safetyPresetCache = ledger.preset;
          if (remainingQuota(ledger, Date.now()) <= 0) {
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
            },
          );
          // 429 风暴：连续 RATE_LIMIT_STORM_THRESHOLD 次 429 不再退避硬磨——
          // 收缩当日预算（砍半）并升级为整队暂停（docs/BLOCK_SAFETY.md Layer B/C）
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
          // TODO(block-safety PR2, docs/BLOCK_SAFETY.md)：Arkose/登录墙（challenge）检测
          // 待真机验证 X 验证码响应特征后在此并链（persistSignal(accountKey, 'challenge')）
          if (!outcome.ok && outcome.code === 'auth_required') {
            await persistSignal(accountKey, 'auth_required');
          }
          return outcome;
        },
        // 成功后相邻间隔按安全档位「base + 抖动」，避免固定节拍器（docs/BLOCK_SAFETY.md Layer A）
        successPaceMs: () => paceForPreset(safetyPresetCache, Math.random),
        onSuccess: (task) => {
          // 队列侧页面副作用：移除黄框并隐藏该账号推文（对齐 X 原生拉黑行为）
          blockedCache.add(task.handle);
          pageMarked.delete(task.handle);
          hideCellsSoon(collectCellsForHandle(task.handle));
        },
      });
    }
  },
});

/** bio 内存缓存上限（每页会话），防止超长会话无界增长。 */
const BIO_CACHE_MAX = 2000;

/** 安全档位缓存：每次账本读取时刷新，供 successPaceMs 同步注入（runner 的 pace 是同步函数）。 */
let safetyPresetCache: SafetyPreset = DEFAULT_PRESET;
/** 连续 429 计数：达到阈值升级为 rate_limit_storm（收缩当日预算 + 整队暂停）。 */
let consecutiveRateLimited = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureStyles(): void {
  if (document.getElementById(STYLE_ELEMENT_ID)) {
    return;
  }
  const style = document.createElement('style');
  style.id = STYLE_ELEMENT_ID;
  // 基础黄色与 popup.css 复用；content 的外框另以透明度收敛。
  // isolated world 无法共享样式文件，调整主题时两处需要同步检查。
  style.textContent = `
    /* 统一细黄环标注：所有命中保持同一种视觉语言。outline 不占布局空间（区别于
       border），不会挤压格子内容；降低线宽和不透明度，避免时间线变成警戒围栏。 */
    [${MARK_ATTRIBUTE}] {
      outline: 2px solid rgb(242 201 76 / 72%) !important;
      outline-offset: -2px;
      border-radius: 16px;
    }
    /* X 的 cell 仍由其 React/虚拟列表持有；只折叠显示，绝不从 DOM 物理删除。 */
    [${HIDDEN_TWEET_CELL_ATTRIBUTE}] {
      display: none !important;
    }
    .fs-badge {
      display: flex;
      gap: 10px;
      align-items: center;
      padding: 3px 10px;
      margin: 2px 12px 8px;
      width: fit-content;
      max-width: calc(100% - 24px);
      border: 1px solid #f2c94c;
      border-radius: 999px;
      background: #fffbe6;
      color: #5c4d00;
      font-size: 12px;
      line-height: 1.5;
    }
    .fs-reason { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    /* 主操作组：保持短标签，避免挤压 X 自带操作。 */
    .fs-actions { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
    /* 次操作组：抢救 / 误标？（低频治理，弱化） */
    .fs-actions-soft { gap: 4px; }
    .fs-pick { display: flex; align-items: center; gap: 4px; white-space: nowrap; cursor: pointer; user-select: none; }
    .fs-pick input { accent-color: #d4a900; cursor: pointer; }
    .fs-block-now {
      min-width: 34px;
      padding: 2px 7px;
      border: 1px solid #d4a900;
      border-radius: 999px;
      background: #f2c94c;
      color: #3d3200;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      white-space: nowrap;
    }
    .fs-block-now:hover:not(:disabled) { background: #ffd950; }
    .fs-block-now:disabled { opacity: 0.6; cursor: wait; }
    .fs-allow {
      padding: 2px 8px;
      border: 1px solid #d9d9d9;
      border-radius: 999px;
      background: #fff;
      color: #999;
      font-size: 12px;
      cursor: pointer;
      white-space: nowrap;
    }
    .fs-allow:hover { border-color: #b3b3b3; color: #666; }
    .fs-manual-mark {
      margin-left: auto;
      min-width: 32px;
      padding: 0 6px;
      min-height: 26px;
      border: 0;
      border-radius: 999px;
      background: transparent;
      color: rgb(113, 118, 123);
      font: inherit;
      font-size: 11px;
      cursor: pointer;
      white-space: nowrap;
    }
    .fs-manual-mark:hover:not(:disabled) {
      background: rgba(244, 33, 46, 0.1);
      color: rgb(244, 33, 46);
    }
    .fs-manual-mark:disabled { opacity: 0.65; cursor: wait; }
  `;
  document.documentElement.appendChild(style);
}
