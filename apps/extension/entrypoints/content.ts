import { noteTimelineHealth } from '@feedsieve/x-adapter';
import { PageScanController, type ScanCallbacks } from '../src/lib/detection/page-scan-controller';
import { createKeywordHeuristics, subscribeKeywordRules } from '../src/lib/detection/keyword-rules';
import {
  KEYWORD_PACK_SYNC_MAX_AGE_MS,
  subscribeKeywordPackCatalog,
} from '../src/lib/detection/keyword-packs';
import { subscribeCommunity } from '../src/lib/community/community-store';
import { createFollowingSync } from '../src/lib/community/following-sync';
import { createQueueSupervisor, QUEUE_HEARTBEAT_KEY } from '../src/lib/queue/queue-supervisor';
import {
  getPersistentBlockQueue,
  setPersistentBlockQueue,
  type PersistentBlockQueueState,
} from '../src/lib/queue/block-queue-store';
import { getUiLanguage, subscribeUiLanguage } from '../src/lib/platform/i18n';
import { createContentState, MARK_ATTRIBUTE } from '../src/lib/content/page-state';
import { HIDDEN_TWEET_CELL_ATTRIBUTE } from '../src/lib/platform/remove-tweets';
import { createBlockOne } from '../src/lib/content/block-core';
import { createBlockedFold } from '../src/lib/content/blocked-fold';
import { createManualActions } from '../src/lib/content/manual-actions';
import { createBadges } from '../src/lib/content/badges';
import { createScan } from '../src/lib/content/scan';
import { createRuleHitQueue, RULE_HIT_MESSAGE } from '../src/lib/community/rule-hit-uplink';
import { createStateSync } from '../src/lib/content/state-sync';
import { createXhrIngest } from '../src/lib/content/xhr-ingest';
import { createBlockQueueRunner } from '../src/lib/content/block-queue';
import { registerContentMessageHandlers } from '../src/lib/content/messages';
import { ensureStyles } from '../src/lib/content/styles';
import { createTweetStatsStore } from '../src/lib/insight/tweet-stats';
import { createInsightUplink, INSIGHT_OBSERVE_MESSAGE } from '../src/lib/insight/shared-insight';
import {
  createReadTracker,
  INSIGHT_READ_MESSAGE,
  INSIGHT_SEEN_MESSAGE,
} from '../src/lib/insight/read-tracker';
import { createInsightDecorations } from '../src/lib/insight/decorations';
import { createProfileInsight } from '../src/lib/insight/profile-insight';
import { createShareMenu } from '../src/lib/insight/share-menu';
import { createCleanUi } from '../src/lib/content/clean-ui';
import { createPageTicker } from '../src/lib/content/page-ticker';
import { createProfileFill } from '../src/lib/content/profile-fill';
import { createAiCheck } from '../src/lib/ai-check/ai-check';
import { createComposeSchedule } from '../src/lib/compose/compose-schedule';
import { createArticleHelper } from '../src/lib/compose/article-editor';
import { getScheduleSettings, subscribeScheduleSettings } from '../src/lib/compose/schedule-store';
import {
  getInsightBadgesEnabled,
  getProfileLineEnabled,
  subscribeInsightBadges,
  subscribeProfileLineEnabled,
} from '../src/lib/insight/insight-settings';
import {
  DEFAULT_MODULE_SETTINGS,
  getModuleSettings,
  subscribeModuleSettings,
  type ModuleSettings,
} from '../src/lib/settings/module-settings';

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
 *
 * 本文件只做装配（状态 / 控制器 / 各模块的创建与接线）；实现分布在
 * src/lib/content/ 各内聚模块（page-state / scan / badges / manual-actions /
 * block-core / blocked-fold / block-queue / state-sync / xhr-ingest / messages / styles）。
 */
export default defineContentScript({
  matches: ['https://x.com/*'],
  main(ctx) {
    // 扩展更新 / 重载后，已打开的 X 页面里这一份脚本不会被浏览器停掉，但扩展 API 全部失效
    // （调用即抛 Extension context invalidated）。这里的定时器和监听都走 ctx：每次触发先查
    // 上下文，失效后 onInvalidated 停掉扫描、定时器并清掉页面上的装饰，页面回到原样，
    // 刷新后由新版本接手。发消息统一走 send，失效后直接返回空，不再抛错。
    const send = (message: unknown): Promise<unknown> =>
      ctx.isValid ? browser.runtime.sendMessage(message) : Promise.resolve(undefined);
    const state = createContentState();
    // 模块总开关（默认全开，设置页可关）：hot / profile / write / aiCheck / filter / shareMenu
    let modules: ModuleSettings = DEFAULT_MODULE_SETTINGS;
    // 扫描调度 / 节点索引 / revision 快照 / MutationObserver 全部收敛到 PageScanController；
    // 检测与标注通过 callbacks 注入。scanOne / flushPendingBadges 依赖 controller，
    // 先以占位绑定创建，模块装配完成后再回填（回调只在 observe / fullRescan 之后
    // 触发，回填必然先行完成）。
    const scanWiring: {
      processOne: ScanCallbacks['processOne'];
      flushBadges: ScanCallbacks['flushBadges'];
      scanDone: NonNullable<ScanCallbacks['scanDone']>;
    } = {
      processOne: () => {},
      flushBadges: () => {},
      scanDone: () => {},
    };
    const controller = new PageScanController({
      processOne: (article, context, pendingBadges) => {
        scanWiring.processOne(article, context, pendingBadges);
      },
      flushBadges: (pendingBadges) => {
        scanWiring.flushBadges(pendingBadges);
      },
      scanDone: () => {
        scanWiring.scanDone();
      },
      noteHealth: (ok, reason) => {
        noteTimelineHealth(ok, reason);
      },
    });
    const fold = createBlockedFold(controller);
    const { blockOne } = createBlockOne(state);
    const manual = createManualActions({ state, blockOne, fold });
    const badges = createBadges({ state, runBlockNow: manual.runBlockNow });
    // 流速 / 量级：GraphQL 指标进本标签页内存，装饰时间线（不上传）
    const insightStore = createTweetStatsStore();
    // 热帖「隐藏已读」：在 X 上停留看过的帖子、打开过的详情页，记成已读（只在本地）
    const readTracker = createReadTracker({
      send: (postIds) => send({ type: INSIGHT_READ_MESSAGE, postIds }),
      sendSeen: (posts) => send({ type: INSIGHT_SEEN_MESSAGE, posts }),
    });
    // 主页洞察：资料卡下一行概况，主人自己的帖子显示倍数（数据来自后台的本地帖子库）
    // 人气行单独开关（默认关闭），关掉「流速与量级」也不影响它
    let profileLineEnabled = false;
    const profileInsight = createProfileInsight({
      getLanguage: () => state.uiLanguage,
      isEnabled: () => modules.profile && profileLineEnabled,
      request: (handle) => send({ type: 'feedsieve:profile-summary', handle }),
      openPanel: () => {
        void send({ type: 'feedsieve:open-profile-panel' }).catch(() => {});
      },
      onBaselineChange: () => insight.scheduleRefresh(),
    });
    const insight = createInsightDecorations({
      store: insightStore,
      getLanguage: () => state.uiLanguage,
      onArticle: (article) => {
        if (modules.hot) readTracker.watch(article);
      },
      profileBaseline: () => profileInsight.baseline(),
    });
    // 主页洞察由页面巡检驱动（tick），模块关闭时巡检不再调用它
    // AI 味检测：详情页回复上的「AI?」按钮 + 回复页的检测卡
    const aiCheck = createAiCheck({
      getLanguage: () => state.uiLanguage,
      getSelfHandle: () => state.selfHandle,
      isProtected: (handle) => state.allowCache.has(handle) || state.followingCache.has(handle),
      isAllowlisted: (handle) => state.allowCache.has(handle),
      isFollowing: (handle) => state.followingCache.has(handle),
      isEnabled: () => modules.aiCheck,
      send,
    });
    aiCheck.start();
    // 发帖：发帖框「下一个空档」、安排表快捷时间、预排期列表顺带记下（只在本机）
    const composeSchedule = createComposeSchedule({
      getLanguage: () => state.uiLanguage,
      getAccount: () => state.selfHandle ?? null,
    });
    composeSchedule.start();
    // 文章编辑器：粘贴 Markdown 自动排版、大纲与字数
    const articleHelper = createArticleHelper({
      getLanguage: () => state.uiLanguage,
    });
    articleHelper.start();
    let articleHelperEnabled = true;
    const applyArticleHelper = (): void => {
      articleHelper.setEnabled(modules.write && articleHelperEnabled);
    };
    void getScheduleSettings().then((settings) => {
      articleHelperEnabled = settings.articleHelper;
      applyArticleHelper();
    });
    subscribeScheduleSettings((settings) => {
      articleHelperEnabled = settings.articleHelper;
      applyArticleHelper();
    });
    if (modules.hot) readTracker.visit(location.pathname);
    // SPA 路由切换：上一条路由的黄框账本必须作废，否则「一键拉黑本页」会把
    // 首页刷过、已经不在屏幕上的账号一起提交。清空后重扫当前 DOM 重建。
    const resetPageLedger = (): void => {
      if (state.pageMarked.size === 0) return;
      state.pageMarked.clear();
      state.notifyPageMarkedChanged();
      controller.reset();
    };
    // 全页统一巡检：地址轮询、AI 味面板巡检、主页洞察那一行、文章编辑器挂载检测
    // 共用一只每秒定时器；页面隐藏时整个停掉，切回来立即补一次（page-ticker.ts）。
    const ticker = createPageTicker();
    // X 是单页应用：地址变化没有事件，借巡检跟踪详情页
    let lastPath = location.pathname;
    ticker.add(() => {
      if (location.pathname === lastPath) return;
      lastPath = location.pathname;
      if (modules.hot) readTracker.visit(lastPath);
      resetPageLedger();
      controller.fullRescan();
    });
    ticker.add(() => {
      if (modules.aiCheck) aiCheck.tick();
    });
    ticker.add(() => {
      if (modules.profile) profileInsight.tick();
    });
    ticker.add(() => {
      if (modules.write) articleHelper.tick();
    });
    ticker.start();
    // 规则命中：本页去重、攒 5 秒交给后台，后台按节奏匿名上报（见 rule-hit-uplink.ts）
    const ruleHits = createRuleHitQueue({
      send: (hits) => send({ type: RULE_HIT_MESSAGE, hits }),
    });
    const scan = createScan({
      state,
      controller,
      fold,
      badges,
      manual,
      insight,
      authorFacts: (handle) => {
        const facts = insightStore.author(handle);
        if (!facts) return undefined;
        return {
          ...(facts.followers !== undefined ? { followers: facts.followers } : {}),
          ...(facts.followingCount !== undefined ? { following: facts.followingCount } : {}),
          ...(facts.tweets !== undefined ? { tweets: facts.tweets } : {}),
          ...(facts.createdAt !== undefined ? { createdAt: facts.createdAt } : {}),
        };
      },
      onRuleHit: (hit) => ruleHits.push(hit),
      isFilterEnabled: () => modules.filter,
    });
    const shareMenu = createShareMenu({
      getLanguage: () => state.uiLanguage,
      isEnabled: () => modules.shareMenu,
    });
    shareMenu.listen();
    // 界面净化（过滤 › 过滤设置 › 界面净化）：默认关闭，只改 X 自己的外观
    const cleanUi = createCleanUi();
    cleanUi.start();
    // 主页补全：用户点工具条图标后才慢慢往下滚，模拟人滑动的节奏
    const profileFill = createProfileFill();
    insight.listenHover();
    scanWiring.processOne = scan.scanOne;
    scanWiring.flushBadges = badges.flushPendingBadges;
    // AI 标签 / 折叠 / 入口按整页顺序判断，等这一轮脏节点扫完再画一次
    scanWiring.scanDone = aiCheck.decorate;
    const sync = createStateSync({
      state,
      controller,
      fold,
      isFilterEnabled: () => modules.filter,
    });
    // Following 全量同步（分页循环 / draft 原子替换）收敛到 following-sync。
    const followingSync = createFollowingSync();
    // 热帖：本标签页的观测每 2 秒批量交给后台，和其他 X 标签页的合并（见 shared-insight.ts）
    const insightUplink = createInsightUplink({
      send: (observations) => send({ type: INSIGHT_OBSERVE_MESSAGE, observations }),
    });
    const xhrIngest = createXhrIngest({
      state,
      controller,
      followingSync,
      resetPageDecorationsForHandles: sync.resetPageDecorationsForHandles,
      insightStore,
      insight,
      // 关掉热帖和主页后不再把观测交给后台；AI 模块关闭后也不再喂检测材料
      onInsightObserved: (observation) => {
        if (modules.hot || modules.profile) insightUplink.push(observation);
      },
      onTweets: (tweets) => {
        if (!modules.aiCheck) return;
        aiCheck.ingest(
          tweets.map((tweet) => ({
            postId: tweet.postId,
            handle: tweet.handle,
            text: tweet.snippet,
            inReplyToId: tweet.inReplyToId,
            inReplyToHandle: tweet.inReplyToHandle,
          })),
        );
      },
    });
    // 持久队列生命周期（心跳 / resume 双跑防御 / 孤儿降级）收敛到 queue-supervisor：
    // 状态机纯函数可单测，这里只注入存储适配与真实执行体。supervisor 与 runner
    // 互相引用（runQueue / runExecutor），经函数提升的端口解耦构造顺序。
    function runQueue(): void {
      void queueSupervisor.run();
    }
    const queueRunner = createBlockQueueRunner({ state, blockOne, fold, runQueue });
    const queueSupervisor = createQueueSupervisor({
      load: getPersistentBlockQueue,
      save: (session) => setPersistentBlockQueue(session as PersistentBlockQueueState),
      readHeartbeat: async () => {
        const result = await browser.storage.local.get(QUEUE_HEARTBEAT_KEY);
        return result[QUEUE_HEARTBEAT_KEY];
      },
      writeHeartbeat: (at) => {
        void browser.storage.local.set({ [QUEUE_HEARTBEAT_KEY]: at }).catch(() => {
          // 心跳写失败不打断队列
        });
      },
      runExecutor: () => queueRunner.executePersistentQueue(),
      // 心跳随上下文停：旧版本脚本不再写心跳，新版本按心跳过期把它留下的队列判成孤儿暂停
      timers: {
        setInterval: (fn, ms) => ctx.setInterval(fn, ms),
        clearInterval: (handle) => clearInterval(handle),
        setTimeout: (fn, ms) => ctx.setTimeout(fn, ms),
        clearTimeout: (handle) => clearTimeout(handle),
      },
    });

    /** 页面上的标注：黄框、理由徽章、手动标记、流速 / 量级 / 倍数（主页概况行由 profileInsight.stop 清）。 */
    const clearPageDecorations = (): void => {
      for (const cell of document.querySelectorAll(`[${MARK_ATTRIBUTE}]`)) {
        cell.removeAttribute(MARK_ATTRIBUTE);
      }
      for (const element of document.querySelectorAll('.fs-badge, [data-fs-action]')) {
        element.remove();
      }
      insight.clearAll();
    };
    ctx.onInvalidated(() => {
      ticker.stop();
      controller.dispose();
      profileInsight.stop();
      aiCheck.stop();
      shareMenu.dispose();
      composeSchedule.stop();
      articleHelper.stop();
      cleanUi.stop();
      // 扩展被重载/停用后别再继续滚页面
      profileFill.stop();
      insight.dispose();
      clearPageDecorations();
    });

    ensureStyles();
    // 开发时 WXT 重新注入脚本，上一份留下的装饰可能还挂着：先清掉「死标记」再开始扫描，
    // 否则残留装饰和弹窗会各说各话（用户看到的黄框查不到、弹窗显示 0）。
    // 正常首次加载的页面此刻没有任何 FeedSieve 装饰，清理不影响什么。
    clearPageDecorations();
    sync.refreshAllowCache();
    sync.refreshFollowingCache();
    sync.refreshBlockedCache();
    sync.refreshSelfCache();
    void sync
      .refreshCommunity()
      .catch((error) => console.error('[FeedSieve] 社区名单加载失败:', error));
    void sync.refreshKeywordHeuristics();
    void getUiLanguage().then((language) => {
      state.uiLanguage = language;
    });
    subscribeUiLanguage((language) => {
      state.uiLanguage = language;
      sync.resetPageDecorations();
      insight.refreshAll();
      profileInsight.ensureLine();
    });
    // 「流速与量级」开关只管推文上的标签和倍数；热帖模块关闭时整体不生效
    let badgesEnabled = true;
    const applyInsightEnabled = (): void => {
      insight.setEnabled(badgesEnabled && modules.hot);
    };
    const setBadgesEnabled = (enabled: boolean): void => {
      badgesEnabled = enabled;
      applyInsightEnabled();
    };
    void getInsightBadgesEnabled().then(setBadgesEnabled);
    subscribeInsightBadges(setBadgesEnabled);
    // 「主页人气行」：资料卡下那一行，默认关闭
    const setProfileLineEnabled = (enabled: boolean): void => {
      profileLineEnabled = enabled;
      profileInsight.ensureLine();
    };
    void getProfileLineEnabled().then(setProfileLineEnabled);
    subscribeProfileLineEnabled(setProfileLineEnabled);
    // 模块总开关：关掉 = 停止采集 / 注入 / 监听，并把已注入的元素撤掉；数据保留。
    // 各模块仍读 modules 闭包做兜底；这里负责开关切换时的启动 / 停止。
    function applyModules(next: ModuleSettings): void {
      const previous = modules;
      modules = next;
      if (previous.hot !== next.hot) {
        applyInsightEnabled();
        if (next.hot) controller.fullRescan();
        else insight.clearAll();
      }
      if (previous.profile !== next.profile) {
        if (next.profile) profileInsight.tick();
        else profileInsight.stop();
      }
      if (previous.write !== next.write) {
        if (next.write) {
          composeSchedule.start();
          articleHelper.start();
          applyArticleHelper();
        } else {
          composeSchedule.stop();
          articleHelper.stop();
        }
      }
      if (previous.filter !== next.filter) {
        if (next.filter) {
          cleanUi.start();
          void sync.refreshCommunity().catch(() => undefined);
        } else {
          state.detectionEnabled = false;
          sync.resetPageDecorations();
          for (const cell of document.querySelectorAll(`[${HIDDEN_TWEET_CELL_ATTRIBUTE}]`)) {
            cell.removeAttribute(HIDDEN_TWEET_CELL_ATTRIBUTE);
          }
          cleanUi.stop();
        }
      }
      if (previous.aiCheck !== next.aiCheck) {
        // aiCheck.tick 内部按 isEnabled 决定补画还是清掉页面上的 AI 标签
        aiCheck.tick();
      }
    }
    void getModuleSettings()
      .then(applyModules)
      .catch(() => applyModules(DEFAULT_MODULE_SETTINGS));
    subscribeModuleSettings(applyModules);
    // 只有一次观测的流速 = 浏览量 / 帖子年龄，会随时间下降；前台时每分钟重算一次
    ctx.setInterval(() => {
      if (modules.hot && document.visibilityState === 'visible') insight.refreshAll();
    }, 60_000);
    subscribeKeywordRules((settings) => {
      state.keywordHeuristics = createKeywordHeuristics(settings, state.keywordCatalog);
      sync.resetPageDecorations();
    });
    subscribeKeywordPackCatalog((catalog) => {
      state.keywordCatalog = catalog;
      void sync.refreshKeywordHeuristics().then(sync.resetPageDecorations);
    });
    xhrIngest.listenXhrBridge(ctx.signal);
    // 请 background SW 同步社区快照（社区名单仍按自己的节流策略更新）。
    void send({ type: 'feedsieve:community-sync' }).catch(() => {
      // SW 暂不可达（开发热重载等）：下次页面加载再试
    });
    const requestKeywordPackSync = (): void => {
      void send({ type: 'feedsieve:keyword-packs-sync' }).catch(() => {
        // 词库远程同步失败时，继续用最后一次校验通过的版本或内置版本。
      });
    };
    requestKeywordPackSync();
    ctx.setInterval(requestKeywordPackSync, KEYWORD_PACK_SYNC_MAX_AGE_MS);
    ctx.addEventListener(document, 'visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        requestKeywordPackSync();
        void sync.refreshKeywordHeuristics();
        void sync
          .refreshCommunity()
          .then(() => controller.fullRescan())
          .catch((error) => console.error('[FeedSieve] 社区名单刷新失败:', error));
      }
    });
    void queueSupervisor.pauseOrphaned(true);
    registerContentMessageHandlers({
      state,
      queueSupervisor,
      followingSync,
      startPersistentQueue: queueRunner.startPersistentQueue,
      runManualSpamBlock: manual.runManualSpamBlock,
      profileFill,
      isFilterEnabled: () => modules.filter,
      isProfileEnabled: () => modules.profile,
    });
    // 快照/设置变化（同步、换强度档）实时生效到下一次扫描；只订阅一次
    subscribeCommunity(() => {
      void sync
        .refreshCommunity()
        .then(sync.resetPageDecorations)
        .catch(() => {
          // 刷新失败保持旧索引
        });
    });

    // 页面变化监听 + 扫描调度：收敛在 PageScanController（有脏才调度，反馈环由
    // .fs-badge/.fs-manual-mark 过滤；无关 mutation 直接忽略）
    controller.observe(document.body);

    // SPA 路由变化：X 不触发页面加载，靠 History API 探测以刷新 context
    ctx.addEventListener(window, 'popstate', () => {
      resetPageLedger();
      controller.fullRescan();
    });
    ctx.addEventListener(window, 'hashchange', () => {
      resetPageLedger();
      controller.fullRescan();
    });

    controller.fullRescan();
  },
});
