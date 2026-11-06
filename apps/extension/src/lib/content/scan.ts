import {
  LocalCampaignIndex,
  LOCAL_CAMPAIGN_RULE_ID,
  campaignCandidateSignal,
} from '../detection/local-campaign';
import { normalizeKeywordPhrase } from '../detection/keyword-rules';
import { PROFILE_INVITATION_RULE_ID } from '../detection/profile-invitation';
/**
 * 单 article 的扫描管线：提取 → 检测 → 标注/折叠/豁免。
 * 只处理传入的这一个节点；调度（脏集合、分片、防重入）由 PageScanController 负责。
 */

import { toHandleSet, type DetectAuthor } from '@feedsieve/detector';
import {
  contextFromPath,
  extractFeedItem,
  tweetSelectors,
} from '@feedsieve/x-adapter';
import { runDetectionPipeline } from '../detection/detection-pipeline';
import { recordDetection } from '../detection/detection-log';
import {
  scanRevision,
  type PageScanController,
  type PendingBadge,
} from '../detection/page-scan-controller';
import { getBundledEntries } from '../community/community-store';
import { HIDDEN_TWEET_CELL_ATTRIBUTE, hiddenForOtherPost, hideCellsSoon } from '../platform/remove-tweets';
import { MARK_ATTRIBUTE, type ContentState } from './page-state';
import { markedForOtherPost, type Badges } from './badges';
import type { BlockedFold } from './blocked-fold';
import type { ManualActions } from './manual-actions';
import type { InsightDecorations } from '../insight/decorations';
import { toReportableHit, type RuleHitItem } from '../community/rule-hit-uplink';

/**
 * 最近一次公开最终名单随扩展打包，作为离线兜底。
 * 社区名单走运行时同步（background SW -> storage.local -> 这里建索引），
 * 服务器快照永远是权威来源。
 * 名单 JSON（2 MB+ 级）不进 JS chunk，由后台读取随包资源（替换原来
 * 的静态 import——它会同步锁住 content script 的 JS 解析三个入口各一份）。
 */
let builtinList: ReadonlySet<string> = toHandleSet([]);

export function createScan(deps: {
  state: ContentState;
  controller: PageScanController;
  fold: BlockedFold;
  badges: Badges;
  manual: ManualActions;
  /** 流速 / 量级装饰：与检测无关，每条推文都装饰（含自己的、受保护的）。 */
  insight?: InsightDecorations;
  /** 作者的公开账号数据（X 接口已返回的：粉丝、关注、注册时间），给新注册小号规则用。 */
  authorFacts?: (handle: string) => DetectAuthor | undefined;
  /** 本地规则打了黄框：匿名上报给服务器做误伤统计与佐证（rule-hit-uplink.ts）。 */
  onRuleHit?: (hit: RuleHitItem) => void;
  /** 过滤模块总开关：关掉后不检测、不挂手动拉黑入口；流速装饰仍由 hot 模块控制。 */
  isFilterEnabled?: () => boolean;

}) {
  const { state, controller, fold, badges, manual, insight } = deps;
  const { markCell } = badges;
  const { attachManualAction } = manual;
  const campaigns = new LocalCampaignIndex(normalizeKeywordPhrase);
  let campaignRules = state.keywordHeuristics;
  let campaignSeedRule = campaignRules.find((rule) => rule.id === PROFILE_INVITATION_RULE_ID);
  const eligibleSeed = (author: string): boolean =>
    !state.allowCache.has(author) &&
    !state.followingCache.has(author) &&
    author !== state.selfHandle &&
    !state.community?.verifiedSet.has(author) &&
    !state.community?.whitelistSet.has(author);

  /**
   * 挂过手动拉黑按钮的 article（WeakSet 不阻挡 GC）。
   * X 重渲染会把注入节点冲掉，而 revision 没变时 scanOne 会早退、不再挂一次；
   * 靠这份记录才能发现「本该有按钮、现在没了」。不往 X 的 DOM 上加标记，
   * 避免 React 重排时把我们的属性一并卷走或影响它自己的样式。
   */
  const manualActionArticles = new WeakSet<Element>();

  /**
   * 注入节点有没有被 X 的重渲染冲掉：
   * - 黄框标记还在、理由徽章没了
   * - 挂过手动拉黑按钮、按钮没了
   * 任一成立就要丢弃 revision 早退、把这一条重新走一遍标注。
   */
  function decorationsLost(article: Element, cell: Element): boolean {
    if (cell.hasAttribute(MARK_ATTRIBUTE) && !cell.querySelector('.fs-badge')) return true;
    return manualActionArticles.has(article) && !article.querySelector('[data-fs-manual-action]');
  }

  void getBundledEntries()
    .then((entries) => {
      builtinList = toHandleSet(entries as never[]);
      controller.reset();
      controller.fullRescan();
    })
    .catch((error) => {
      // 打包资源缺失属异常；保持空集，社区名单同步通道仍可用。但绝不静默：
      console.error('[FeedSieve] 随包名单快照加载失败，内置名单为空，仅剩服务端同步通道:', error);
    });

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
    const ownerCell = article.closest(tweetSelectors.timelineCell) ?? article;
    // 同一作者的新推文复用了旧 cell：上一条的黄框/理由徽章先撤掉。
    // 新推文如果命中，markCell 会重建；如果没命中，下面的 revision 早退
    // 不会再进 markCell，不清就会一直挂着上一条的旧理由。
    if (markedForOtherPost(ownerCell, item.postId)) {
      ownerCell.removeAttribute(MARK_ATTRIBUTE);
      ownerCell.querySelectorAll('.fs-badge').forEach((badge) => badge.remove());
    }
    // 格子记的隐藏对象不是这条推文（X 把格子复用给了别人）：别连坐。
    // 换进来的还是被拉黑的账号就继续藏着，只把记号改对（别先放出来再藏，免得闪一下）。
    if (item.postId && hiddenForOtherPost(ownerCell, item.postId)) {
      if (state.blockedCache.has(handle)) {
        ownerCell.setAttribute(HIDDEN_TWEET_CELL_ATTRIBUTE, item.postId);
      } else {
        ownerCell.removeAttribute(HIDDEN_TWEET_CELL_ATTRIBUTE);
      }
    }
    const previousHandle = controller.remember(element, handle);
    if (previousHandle) {
      // X 复用同一个 article 显示另一条推文：上一条的隐藏/黄框徽章必须一起清掉，
      // 否则新推文会被直接隐藏，或顶着别人的判定理由。
      ownerCell.removeAttribute(MARK_ATTRIBUTE);
      ownerCell.removeAttribute(HIDDEN_TWEET_CELL_ATTRIBUTE);
      ownerCell.querySelectorAll('.fs-badge').forEach((badge) => badge.remove());
      // 旧推文的手动拉黑入口归属的是旧作者，等新推文重新决定要不要挂
      manualActionArticles.delete(element);
    }
    // 先于 revision 早退：指标会变而 DOM 不变；文案不变时 decorate 不写 DOM
    insight?.decorate(element, item);
    // 过滤模块关闭：检测、黄框、手动拉黑入口全部不出现；已注入的由 content 在开关变化时清掉
    if (deps.isFilterEnabled?.() === false) {
      for (const action of article.querySelectorAll('[data-fs-action="block"]')) action.remove();
      manualActionArticles.delete(element);
      return;
    }
    const bio = state.bioCache.get(handle);
    const facts = deps.authorFacts?.(handle);
    // X 的默认头像不在 pbs.twimg.com，接口数据里会被消毒掉，只能从页面上看
    const defaultAvatar = !!element.querySelector(
      '[data-testid="Tweet-User-Avatar"] img[src*="default_profile_images"]',
    );
    // revision 快照：虚拟列表复用同一 article 时跳过已标注过的输入；
    // 作者数据晚到（第一次扫描时还没有）也要重扫一次，新注册小号规则才有机会看到
    const revision = `${scanRevision(item, bio)}|${facts ? 1 : 0}${defaultAvatar ? 1 : 0}`;
    const changed = controller.hasChanged(element, revision);
    // X 重渲染可能把徽章 / 手动拉黑按钮冲掉而推文输入没变：只靠 revision 早退
    // 会让这些装饰永远不回来，所以早退前先校验「标记还在、注入节点也在」。
    if (!changed && !decorationsLost(element, ownerCell)) {
      return;
    }

    const author: DetectAuthor | undefined =
      facts || defaultAvatar
        ? { ...facts, ...(defaultAvatar ? { defaultAvatar } : {}) }
        : undefined;
    const input = {
      handle: item.author.handle,
      postId: item.postId,
      displayName: item.author.displayName,
      text: item.text,
      bio,
      links: item.links,
      ...(author ? { author } : {}),
    };

    if (campaignRules !== state.keywordHeuristics) {
      campaigns.clear();
      campaignRules = state.keywordHeuristics;
      campaignSeedRule = campaignRules.find((rule) => rule.id === PROFILE_INVITATION_RULE_ID);
    }
    // 昵称招揽规则被服务端静音时，也不再拿它给本页同模板判定做种子
    const campaignEnabled =
      state.detectionEnabled &&
      !!campaignSeedRule &&
      !state.community?.mutedRules?.has(PROFILE_INVITATION_RULE_ID) &&
      !state.community?.mutedRules?.has(LOCAL_CAMPAIGN_RULE_ID);
    if (campaignEnabled) {
      const directSeed = eligibleSeed(handle) && !!campaignSeedRule?.check(input);
      for (const author of campaigns.observe(handle, item.text, directSeed)) {
        controller.invalidateHandle(author);
      }
    }

    // 自己的帖子：永不折叠也永不标注（selfHandle 未知时防御性不跳过；
    // 后面 blockedCache 等检查都不得先于它，避免自己拉黑自己这种数据异常
    // 把帖子藏起来）。
    if (state.selfHandle && handle === state.selfHandle) {
      manualActionArticles.delete(element);
      return;
    }

    // 用户已经显式拉黑的账号高于检测开关/白名单保护：X 若又把它渲染出来，
    // 直接以非破坏性的方式折叠该 cell，而不是插入一个会再次改变高度的提示条。
    // 被拉黑者本人主页豁免折叠，理由见 shouldFoldBlockedTweets。
    if (state.blockedCache.has(handle)) {
      const cell = article.closest(tweetSelectors.timelineCell) ?? article;
      state.pageMarked.delete(handle);
      state.notifyPageMarkedChanged();
      if (fold.shouldFoldBlockedTweets(handle)) {
        hideCellsSoon([cell], 0);
      }
      manualActionArticles.delete(element);
      return;
    }

    // 检测 / 增强 / 分层 / 分类推导统一走 detection-pipeline（可独立单测的单元）
    let result = runDetectionPipeline({
      input,
      community: state.community,
      builtinList,
      keywordHeuristics: state.keywordHeuristics,
      catalog: state.keywordCatalog,
      strength: state.strength,
      uiLanguage: state.uiLanguage,
    });
    const count = campaignEnabled ? campaigns.match(handle, item.text, eligibleSeed) : 0;
    const candidateSignal =
      count >= 2 ? campaignCandidateSignal(item.text, normalizeKeywordPhrase) : null;
    if (eligibleSeed(handle) && result.presentation === 'ignore' && count >= 2) {
      result = runDetectionPipeline({
        input,
        community: state.community,
        builtinList,
        keywordHeuristics: [
          ...state.keywordHeuristics,
          {
            id: LOCAL_CAMPAIGN_RULE_ID,
            check: () =>
              `命中官方规则：与 ${count} 个具有昵称招揽证据的账号同模板 + ${candidateSignal === 'anti-bot-claim' ? '正文自称非人机' : '长数字载荷'} · 正文`,
          },
        ],
        catalog: state.keywordCatalog,
        strength: state.strength,
        uiLanguage: state.uiLanguage,
      });
      result.evidence.signalIds = [
        LOCAL_CAMPAIGN_RULE_ID,
        'same-template-direct-seeds',
        candidateSignal!,
      ];
    }
    result.evidence.observedAt = Date.now();
    result.evidence.catalogVersion = state.keywordCatalog.pack_version;
    // A withdrawn seed or changed profile must retract the previous inferred badge.
    if (
      result.presentation === 'ignore' &&
      [LOCAL_CAMPAIGN_RULE_ID, PROFILE_INVITATION_RULE_ID].includes(
        state.pageMarked.get(handle)?.ruleId ?? '',
      )
    ) {
      const cell = article.closest(tweetSelectors.timelineCell) ?? article;
      cell.removeAttribute(MARK_ATTRIBUTE);
      cell.querySelectorAll('.fs-badge').forEach((badge) => badge.remove());
      state.pageMarked.delete(handle);
      state.notifyPageMarkedChanged();
    }
    const isProtected = state.allowCache.has(handle) || state.followingCache.has(handle);
    if (isProtected) {
      // SPA 路由切换不会清 pageMarked：保护名单里的账号重现在扫描里时，
      // 把残留的旧条目就地清掉（DOM 装饰保持原状，无需在这里动它）。
      if (state.pageMarked.has(handle)) {
        state.pageMarked.delete(handle);
        state.notifyPageMarkedChanged();
      }
    }
    if (isProtected || !state.detectionEnabled || result.presentation === 'ignore') {
      attachManualAction(article as HTMLElement, handle, result.evidence);
      // 记下「这条挂过手动拉黑入口」：X 重渲染冲掉按钮后，靠它发现装饰丢失并补挂
      if (article.querySelector('[data-fs-manual-action]')) {
        manualActionArticles.add(article);
      }
      return;
    }

    // 本地规则质量观测：只有真正到达页面的命中才计数（见 detection-log.ts）；
    // 装饰被 X 冲掉后的重建（changed=false）不是新命中，不重复计数/上报。
    if (changed) {
      void recordDetection({
        handle,
        ruleId: result.detection!.ruleId ?? result.detection!.source,
        source: result.detection!.source,
        category: result.category ?? 'other',
        reason: result.detection!.reason,
        fingerprint: result.evidence.contentFingerprint,
      });
    }
    // 官方规则 / 内置启发式的命中匿名上报（名单命中、个人自定义词不报，见 rule-hit-uplink.ts）
    if (changed) {
      const ruleHit = toReportableHit({
        handle,
        ruleId: result.detection!.ruleId,
        source: result.detection!.source,
        category: result.category,
        fingerprint: result.evidence.contentFingerprint,
        postId: item.postId,
      });
      if (ruleHit) deps.onRuleHit?.(ruleHit);
    }

    // 标注打在外层时间线格子上（PureTwitter 同款目标层）；找不到才退回 article
    const cell = article.closest(tweetSelectors.timelineCell) ?? article;
    // 已经走标注的推文不需要手动拉黑入口；清掉记录，避免它的按钮被 X 冲掉后
    // 又被当成「装饰丢失」无限重扫
    manualActionArticles.delete(element);
    markCell(
      cell as HTMLElement,
      result.detection!,
      result.category ?? 'other',
      result.evidence,
      pendingBadges,
      item.text,
      item.author.displayName,
      item.postId,
      changed,
    );
  }

  return { scanOne };
}
