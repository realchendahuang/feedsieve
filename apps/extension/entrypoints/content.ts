import { contentFingerprint, detect, toHandleSet } from '@feedsieve/detector';
import type { CommunityEntry } from '@feedsieve/community-lists';
import {
  contextFromPath,
  extractFeedItem,
  parseXApiResponse,
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
  collectCellsByHandle,
  hideCellsSoon,
  mutateWithStableViewport,
} from '../src/lib/remove-tweets';
import { runUnblockBatch } from '../src/lib/run-unblock-batch';
import { getUserId, saveUserIds } from '../src/lib/user-ids';
import {
  buildRuntimeCommunity,
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
  categoryFromDetection,
  collectLinkDomains,
  contributeBlocks,
  rescueHandle,
  syncLocalLabels,
} from '../src/lib/contribute';
import { getCommunitySettings } from '../src/lib/community-store';
import { classifyDetection } from '../src/lib/detection-policy';
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
} from '../src/lib/block-queue-store';
import {
  categoryLabel,
  getUiLanguage,
  localizedDetectionReason,
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
import builtinListJson from '../../../community/lists/recommended.json';

/**
 * 内置名单（构建期打包，entries 目前为空）：离线兜底。
 * 社区名单走运行时同步（background SW -> storage.local -> 这里建索引），
 * 服务器快照永远是权威来源。
 */
const BUILTIN_LIST = toHandleSet((builtinListJson as { entries: unknown }).entries as never[]);

const MARK_ATTRIBUTE = 'data-fs-marked';
const STYLE_ELEMENT_ID = 'feedsieve-mark-styles';

/** 标注时刻收集的内容证据（上报载荷，见 contribute.ts） */
interface BlockEvidence {
  contentFingerprint?: string;
  linkDomains?: string[];
}

/** 页面内一个黄框账号待处理时的标记数据（一键拉黑 = 页面全部黄框）。 */
interface PageMarkedAccount {
  handle: string;
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
    let seenArticles = new WeakSet<Element>();
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
    /** 社区名单运行时状态（快照同步 + 强度过滤后的索引） */
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
    let scanTimer: number | undefined;

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
        items?: Array<{ handle: string; xUserId?: string; category: string }>;
      } | null;
      const type = msg?.type;
      // 一键拉黑 = 当前页面全部黄框账号（用户拍板的交互语义）
      if (type === 'feedsieve:run-page-block') {
        return runPageBlockBatch();
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
        return startPersistentQueue('community-batch', msg.items);
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
              bioCache.set(tweet.author.handle, tweet.author.bio);
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

    function hideNewlyBlockedCells(handles: ReadonlySet<string>): void {
      for (const handle of handles) {
        const cells = collectCellsByHandle(handle);
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
      scheduleScan();
    }

    /**
     * X 会复用时间线 DOM；设置、语言或保护名单变化后，必须撤掉旧结论再重扫。
     * 否则「关闭检测」只影响新推文，屏幕上原有黄框仍会残留，用户会误以为开关失效。
     */
    function resetPageDecorations(): void {
      pageMarked.clear();
      seenArticles = new WeakSet<Element>();
      for (const cell of document.querySelectorAll(`[${MARK_ATTRIBUTE}]`)) {
        cell.removeAttribute(MARK_ATTRIBUTE);
      }
      for (const element of document.querySelectorAll('.fs-badge, .fs-manual-mark')) {
        element.remove();
      }
      scheduleScan();
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
        seenArticles.delete(match.article);
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
      scheduleScan();
    }

    function scan(): void {
      const context = contextFromPath(location.pathname);
      for (const article of document.querySelectorAll(tweetSelectors.article)) {
        if (seenArticles.has(article)) {
          continue;
        }
        seenArticles.add(article);

        const item = extractFeedItem(article, context);
        if (!item) {
          continue;
        }

        const input = {
          handle: item.author.handle,
          displayName: item.author.displayName,
          text: item.text,
          bio: bioCache.get(item.author.handle),
          links: item.links,
        };

        // 内容证据只用于用户主动标记或高置信命中后的社区证据。
        // 不再因「页面上三个账号出现相同文本」直接定罪。
        const evidence: BlockEvidence = {};
        const fp = contentFingerprint(input);
        if (fp) {
          evidence.contentFingerprint = fp;
        }
        const linkDomains = collectLinkDomains(item.links);
        if (linkDomains) {
          evidence.linkDomains = linkDomains;
        }

        const handle = item.author.handle.toLowerCase();
        // 用户已经显式拉黑的账号高于检测开关/白名单保护：X 若又把它渲染出来，
        // 直接以非破坏性的方式折叠该 cell，而不是插入一个会再次改变高度的提示条。
        if (blockedCache.has(handle)) {
          const cell = article.closest(tweetSelectors.timelineCell) ?? article;
          pageMarked.delete(handle);
          hideCellsSoon([cell], 0);
          continue;
        }
        const isProtected = allowCache.has(handle) || followingCache.has(handle);
        if (isProtected || !detectionEnabled) {
          attachManualAction(article as HTMLElement, handle, evidence);
          continue;
        }

        // 识别顺序：社区快照名单 -> 内置名单兜底 -> 用户/官方可配置词库。
        // 社区指纹/域名集合由 buildRuntimeCommunity 按强度档准备（大扫除档才有内容）
        const evidenceOptions = {
          ...(community?.fingerprintSet.size ? { fingerprints: community.fingerprintSet } : {}),
          ...(community?.domainSet.size ? { domains: community.domainSet } : {}),
        };
        let detection = community
          ? detect(input, {
              list: community.handleSet,
              listSource: 'community-list',
              // v0.5 指纹即 SimHash：simhashes 集合与 fingerprints 集合同源，
              // exact 命中优先，miss 后走汉明距离找「话术变体」
              ...(community.fingerprintSet.size ? { simhashes: community.fingerprintSet } : {}),
              ...evidenceOptions,
              // 关键词/默认名称等单信号只保留在 Detector 评测层，
              // 不再直接进入用户黄框。
              heuristics: [],
            })
          : null;
        if (!detection && BUILTIN_LIST.size > 0) {
          detection = detect(input, {
            list: BUILTIN_LIST,
            listSource: 'builtin-list',
            ...evidenceOptions,
            heuristics: [],
          });
        }
        if (!detection) {
          detection = detect(input, {
            ...evidenceOptions,
            // 仅运行用户明确配置的字面短语和可逐条关闭的官方词库。
            // 命中后给人工确认黄框；页面一键拉黑仍必须由用户显式点击。
            heuristics: keywordHeuristics,
          });
        }

        if (!detection) {
          attachManualAction(article as HTMLElement, handle, evidence);
          continue;
        }

        // 社区名单命中：徽章带分类与票数，可解释性优先
        let communityCategory: string | undefined;
        let communityEntry: CommunityEntry | null = null;
        if (detection.source === 'community-list' && community) {
          const entry = community.index.lookup(item.author.handle);
          if (entry) {
            communityEntry = entry;
            communityCategory = entry.category;
            const label = categoryLabel(entry.category, uiLanguage);
            const voteSummary =
              entry.report_count > 1
                ? uiLanguage === 'zh'
                  ? `${entry.report_count} 人标记`
                  : `${entry.report_count} community marks`
                : uiLanguage === 'zh'
                  ? '社区名单'
                  : 'Community list';
            detection = {
              ...detection,
              reason: uiLanguage === 'zh' ? `${voteSummary}为${label}` : `${voteSummary}: ${label}`,
            };
          }
        }

        // v0.5 Campaign：指纹命中（exact 或变体）时，
        // 反查所在簇的规模，徽章显示「同模板 N 个账号」（网络感，不只单点）
        if (detection.source === 'fingerprint' && community) {
          const campaignHandle = detection.matchedFingerprint
            ? community.campaignByFingerprint.get(detection.matchedFingerprint)
            : undefined;
          const campaign = campaignHandle ? community.campaignById.get(campaignHandle) : undefined;
          if (campaign) {
            detection = {
              ...detection,
              campaignEntryId: campaign.campaign_entry_id,
              reason:
                uiLanguage === 'zh'
                  ? `与 ${campaign.campaign_size} 个已确认垃圾账号发布的内容高度相似`
                  : `Highly similar to content from ${campaign.campaign_size} confirmed spam accounts`,
            };
          }
        }

        if (detection.source !== 'community-list') {
          detection = {
            ...detection,
            reason: localizedDetectionReason(uiLanguage, detection),
          };
        }

        const presentation = classifyDetection({
          detection,
          strength,
          communityEntry,
        });
        if (presentation === 'ignore') {
          attachManualAction(article as HTMLElement, handle, evidence);
          continue;
        }

        // 标注打在外层时间线格子上（PureTwitter 同款目标层）；找不到才退回 article
        const cell = article.closest(tweetSelectors.timelineCell) ?? article;
        const category =
          keywordCategoryFromCurrentCatalog(detection.ruleId) ??
          categoryFromDetection(detection.source, detection.ruleId, communityCategory);
        markCell(cell as HTMLElement, detection, category, evidence);
      }
    }

    function scheduleScan(): void {
      window.clearTimeout(scanTimer);
      scanTimer = window.setTimeout(scan, 300);
    }

    /** 远程词库可新增行业包；页面本地统计仍保留该包的真实分类，不降级成 other。 */
    function keywordCategoryFromCurrentCatalog(
      ruleId: string | null | undefined,
    ): string | undefined {
      if (!ruleId?.startsWith('keyword:official:')) return undefined;
      const officialId = ruleId.slice('keyword:official:'.length);
      return keywordCatalog.packs.find((pack) => pack.rules.some((rule) => rule.id === officialId))
        ?.id;
    }

    new MutationObserver(scheduleScan).observe(document.body, {
      childList: true,
      subtree: true,
    });

    // SPA 路由变化：X 不触发页面加载，靠 History API 探测以刷新 context
    window.addEventListener('popstate', scheduleScan);
    window.addEventListener('hashchange', scheduleScan);

    scheduleScan();

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
      const idleLabel = uiLanguage === 'zh' ? '标记垃圾' : 'Mark spam';
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
            hideCellsSoon(collectCellsByHandle(handle));
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
        { handle, category: 'other', reason: '', evidence },
        {
          origin: 'manual-spam',
          communityVote: true,
          deferContribution: true,
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
      detection: NonNullable<ReturnType<typeof detect>>,
      category: string,
      evidence: BlockEvidence,
    ): void {
      cell.setAttribute(MARK_ATTRIBUTE, detection.source);
      attachBadge(cell, detection, category, evidence);
      // 页面上用户能看到的每一个黄框，都必须出现在 popup 的待处理清单里。
      // 安全边界是「必须由用户点击一键拉黑」，而不是再暗藏一层不可见的置信门槛。
      if (detection.source !== 'blocked') {
        pageMarked.set(detection.handle, {
          handle: detection.handle,
          category,
          reason: detection.reason,
          evidence,
        });
      }
      // 本地统计：每次新标注 +1（seenArticles 保证每个 cell 只标一次）；
      // 已拉黑回显不是新发现，不计数
      if (detection.source !== 'blocked') {
        void bumpStat('detected').catch(() => {
          // 统计写入失败不影响标注
        });
      }
    }

    function attachBadge(
      cell: HTMLElement,
      detection: NonNullable<ReturnType<typeof detect>>,
      category: string,
      evidence: BlockEvidence,
    ): void {
      if (cell.querySelector('.fs-badge')) {
        return;
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
      blockBtn.textContent = uiLanguage === 'zh' ? '标记垃圾并拉黑' : 'Mark spam & block';
      blockBtn.addEventListener('click', () => {
        // 本地关键词是个人偏好；用户拉黑后不反向影响社区名单。
        const communityVote = !detection.ruleId?.startsWith('keyword:');
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
      cell.appendChild(badge);
    }

    /**
     * 一键拉黑（popup 入口）：当前页面全部黄框账号批量拉黑。
     * 逐个执行，成功即从 pageMarked 移除并把推文隐藏；失败如实保留，
     * 汇总回报 popup（与「顺手拉黑」共用 blockOne 原生产链路）。
     */
    async function runPageBlockBatch(): Promise<{
      blocked: string[];
      failed: Array<{ handle: string; code: string }>;
    }> {
      const targets = [...pageMarked.values()];
      const blocked: string[] = [];
      const failed: Array<{ handle: string; code: string }> = [];
      for (const item of targets) {
        const outcome = await blockOne(item, {
          origin: 'page-batch',
          communityVote: false,
        });
        if (outcome.ok) {
          blocked.push(item.handle);
          pageMarked.delete(item.handle);
          // 对齐 X 原生拉黑行为：该账号页面上可见的推文一并隐藏。
          hideCellsSoon(collectCellsByHandle(item.handle));
        } else {
          failed.push({ handle: item.handle, code: outcome.code });
        }
        await sleep(PACE_MS);
      }
      return { blocked, failed };
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
    ): Promise<{ ok: true } | { ok: false; code: string }> {
      let xUserId: string | undefined | null = await getUserId(item.handle);
      if (!xUserId) {
        xUserId = await resolveUserIdByHandle(item.handle);
        if (xUserId) {
          void saveUserIds([{ handle: item.handle, xUserId }]).catch(() => {
            // 回填失败不影响本次拉黑
          });
        }
      }
      if (!xUserId) {
        return { ok: false, code: 'no-id' };
      }

      const result = await runNativeAction('block', xUserId);
      if (!result.ok) {
        return { ok: false, code: result.code };
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
          hideCellsSoon(collectCellsByHandle(handle));
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
      source: 'community-batch',
      items: Array<{ handle: string; xUserId?: string; category: string }>,
    ): Promise<{ status: 'started'; id: string; count: number }> {
      const filtered = items.filter((item) => {
        const handle = item.handle.toLowerCase();
        return !allowCache.has(handle) && !followingCache.has(handle) && !blockedCache.has(handle);
      });
      const state = await createPersistentBlockQueue(source, filtered);
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
      for (const task of state.tasks) {
        if (task.status === 'running') task.status = 'pending';
        if (
          task.status === 'failed' &&
          ['rate_limited', 'auth_required', 'missing_csrf', 'network_error'].includes(
            task.failureCode ?? '',
          )
        ) {
          task.status = 'pending';
          delete task.failureCode;
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
      let state = await getPersistentBlockQueue();
      if (!state || state.status !== 'running') return;
      for (;;) {
        state = await getPersistentBlockQueue();
        if (!state || state.status !== 'running') return;
        const index = state.tasks.findIndex(
          (task) => task.status === 'pending' || task.status === 'running',
        );
        if (index < 0) {
          state.status = 'completed';
          await setPersistentBlockQueue(state);
          return;
        }
        const task = state.tasks[index]!;
        task.status = 'running';
        delete task.failureCode;
        await setPersistentBlockQueue(state);

        const outcome = await blockOne(
          {
            handle: task.handle,
            category: task.category,
            reason: '',
            evidence: {},
          },
          {
            origin: 'community-batch',
            communityVote: false,
            batchId: state.id,
          },
        );
        state = (await getPersistentBlockQueue()) ?? state;
        const currentTask = state.tasks.find((item) => item.handle === task.handle);
        if (!currentTask) return;
        if (outcome.ok) {
          currentTask.status = 'success';
          blockedCache.add(task.handle);
        } else {
          currentTask.failureCode = outcome.code;
          if (
            ['rate_limited', 'auth_required', 'missing_csrf', 'network_error'].includes(
              outcome.code,
            )
          ) {
            currentTask.status = 'pending';
            state.status = 'paused';
            await setPersistentBlockQueue(state);
            return;
          }
          currentTask.status = 'failed';
        }
        await setPersistentBlockQueue(state);
        await sleep(PACE_MS);
      }
    }
  },
});

/** 相邻两次拉黑请求的间隔（毫秒），与批量执行一致。 */
const PACE_MS = 400;

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
    /* 主操作组：勾选 + 顺手拉黑（高频，视觉突出） */
    .fs-actions { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
    /* 次操作组：抢救 / 误标？（低频治理，弱化） */
    .fs-actions-soft { gap: 4px; }
    .fs-pick { display: flex; align-items: center; gap: 4px; white-space: nowrap; cursor: pointer; user-select: none; }
    .fs-pick input { accent-color: #d4a900; cursor: pointer; }
    .fs-block-now {
      padding: 2px 10px;
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
      padding: 0 8px;
      min-height: 28px;
      border: 0;
      border-radius: 999px;
      background: transparent;
      color: rgb(113, 118, 123);
      font: inherit;
      font-size: 12px;
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
