import { flushTrainingSamples } from '../src/lib/community/training-samples';
import { registerRuntimeDataWorker } from '../src/lib/platform/runtime-data';
import { syncCommunitySnapshot } from '@feedsieve/community-lists';
import {
  COMMUNITY_API_BASE,
  COMMUNITY_SYNC_SOURCES,
  getCommunityKillSwitch,
  snapshotStore,
  type OfficialPauseState,
} from '../src/lib/community/community-store';
import { flushContributions } from '../src/lib/community/contribute';
import { syncKeywordPackCatalog } from '../src/lib/detection/keyword-packs';
import { getChromeSidePanel } from '../src/lib/platform/sidepanel';
import {
  createSharedInsight,
  INSIGHT_OBSERVE_MESSAGE,
  INSIGHT_UPDATED_MESSAGE,
} from '../src/lib/insight/shared-insight';
import { createHotUplink } from '../src/lib/insight/hot-uplink';
import { createRuleHitUplink, RULE_HIT_MESSAGE } from '../src/lib/community/rule-hit-uplink';
import { createProfileSync } from '../src/lib/insight/profile-sync';
import { isHotSort } from '../src/lib/insight/tweet-stats';
import { createProfileCatalog, PROFILE_UPDATED_MESSAGE } from '../src/lib/insight/profile-catalog';
import { summarizeProfile } from '../src/lib/insight/profile-summary';
import { PANEL_VIEW_REQUEST_KEY } from '../src/lib/platform/panel-route';
import { INSIGHT_READ_MESSAGE, INSIGHT_SEEN_MESSAGE } from '../src/lib/insight/read-tracker';
import { getSelfHandle } from '../src/lib/community/following-allowlist';
import { getCommunitySettings } from '../src/lib/community/community-store';
import { handleAiCheckMessage } from '../src/lib/ai-check/client';

export default defineBackground(() => {
  registerRuntimeDataWorker();

  // 热帖：所有 X 标签页的观测在这里合并，存在 storage.session（浏览器关闭即清空、不上传）。
  // 有新数据时广播一次，开着的弹窗 / 侧边栏自己重新取，不需要用户手动刷新。
  const sharedInsight = createSharedInsight({
    storage: {
      get: (key) => browser.storage.session.get(key),
      set: (items) => browser.storage.session.set(items),
    },
    broadcast: () => {
      void browser.runtime.sendMessage({ type: INSIGHT_UPDATED_MESSAGE }).catch(() => {
        // 没有打开的弹窗 / 侧边栏：没人接收是正常的
      });
    },
  });
  // 主页洞察：打开过的博主主页各建一份本地帖子库（storage.local），和服务端的众包帖子库双向增量同步
  const profileCatalog = createProfileCatalog({
    storage: {
      get: (keys) => browser.storage.local.get(keys),
      set: (items) => browser.storage.local.set(items),
      remove: (keys) => browser.storage.local.remove(keys),
    },
    broadcast: (handles) => {
      void browser.runtime.sendMessage({ type: PROFILE_UPDATED_MESSAGE, handles }).catch(() => {
        // 没有打开的弹窗 / 侧边栏
      });
    },
  });

  // 全站热榜上报：只用 X 已经返回的数据，直接从后台发往福滤娃服务器，不经过 x.com 页面
  const hotUplink = createHotUplink({
    isAllowed: async () => {
      const settings = await getCommunitySettings();
      return settings.autoContribute && settings.hotContribute;
    },
    getSelfHandle: () => getSelfHandle(),
    velocityOf: (postId) => sharedInsight.velocityOf(postId),
    post: (body) =>
      fetch(`${COMMUNITY_API_BASE}/v1/observations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'omit',
        signal: AbortSignal.timeout(15_000),
      }),
    storage: {
      get: (key) => browser.storage.local.get(key),
      set: (items) => browser.storage.local.set(items),
    },
    stateStorage: {
      get: (key) => browser.storage.session.get(key),
      set: (items) => browser.storage.session.set(items),
    },
  });
  // 规则命中：所有标签页的黄框命中在这里合并，按节奏匿名上报（不是票，见 rule-hit-uplink.ts）
  const ruleHitUplink = createRuleHitUplink({
    isAllowed: async () => {
      const settings = await getCommunitySettings();
      return settings.autoContribute && settings.hitContribute;
    },
    post: (body) =>
      fetch(`${COMMUNITY_API_BASE}/v1/rule-hits`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'omit',
        signal: AbortSignal.timeout(15_000),
      }),
    storage: {
      get: (key) => browser.storage.local.get(key),
      set: (items) => browser.storage.local.set(items),
    },
    stateStorage: {
      get: (key) => browser.storage.session.get(key),
      set: (items) => browser.storage.session.set(items),
    },
  });
  // 主页洞察众包：一个人看过的博主帖子，其他人打开同一个主页直接拿到（见 profile-sync.ts）。
  // 「仅本地运行」时不拉也不报
  const profileSync = createProfileSync({
    catalog: profileCatalog,
    isAllowed: async () => (await getCommunitySettings()).autoContribute,
    getSelfHandle: () => getSelfHandle(),
    post: (body) =>
      fetch(`${COMMUNITY_API_BASE}/v1/profile-observations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'omit',
        signal: AbortSignal.timeout(15_000),
      }),
    fetchProfile: (handle, cursor) =>
      fetch(
        `${COMMUNITY_API_BASE}/v1/profiles/${encodeURIComponent(handle)}${
          cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
        }`,
        { credentials: 'omit', signal: AbortSignal.timeout(15_000) },
      ),
    storage: {
      get: (key) => browser.storage.local.get(key),
      set: (items) => browser.storage.local.set(items),
    },
    stateStorage: {
      get: (key) => browser.storage.session.get(key),
      set: (items) => browser.storage.session.set(items),
    },
  });
  browser.runtime.onMessage.addListener((message: unknown, sender) => {
    // 只接收本扩展自己的内容脚本和页面
    if (sender.id !== browser.runtime.id) return undefined;
    const msg = message as { type?: string; observations?: unknown; sort?: unknown } | null;
    if (msg?.type === RULE_HIT_MESSAGE) {
      return ruleHitUplink.observe((msg as { hits?: unknown }).hits).then(() => ({ ok: true }));
    }
    if (msg?.type === INSIGHT_OBSERVE_MESSAGE) {
      // 先合并进共享 store，上报时才能按汇总后的流速挑出正在火的帖子
      return sharedInsight.ingest(msg.observations).then((recorded) => {
        void hotUplink.observe(msg.observations).catch(() => undefined);
        // 用户在刷 X：顺手看看规则命中是不是到了该上报的时候
        void ruleHitUplink.observe([]).catch(() => undefined);
        // 先进本机帖子库（打开主页时在这里建档），再拉服务端的、报新的
        void profileCatalog
          .ingest(msg.observations)
          .then(() => profileSync.observe(msg.observations))
          .catch(() => undefined);
        return { recorded };
      });
    }
    const handle = (message as { handle?: unknown }).handle;
    if (msg?.type === 'feedsieve:profile-get') {
      if (typeof handle !== 'string') return null;
      // 侧边栏打开时也拉一次（10 分钟内拉过的不重复拉），拉到后经 PROFILE_UPDATED 刷新
      void profileSync.pull(handle.toLowerCase());
      return profileCatalog.get(handle.toLowerCase());
    }
    if (msg?.type === 'feedsieve:profile-summary') {
      if (typeof handle !== 'string') return null;
      return profileCatalog
        .get(handle.toLowerCase())
        .then((entry) => (entry ? summarizeProfile(entry, Date.now()) : null));
    }
    if (msg?.type === 'feedsieve:profile-clear') {
      return profileCatalog.clear().then(() => ({ cleared: true }));
    }
    if (msg?.type === 'feedsieve:profile-count') {
      return profileCatalog.size();
    }
    if (msg?.type === 'feedsieve:open-profile-panel') {
      // 主页资料卡下的那一行被点击：打开侧边栏并落到「主页」视图。
      // sidePanel.open 要求用户手势；内容脚本里点击转发过来时浏览器不一定认，失败就算了
      const windowId = sender.tab?.windowId;
      const open = getChromeSidePanel()?.open;
      if (windowId === undefined || !open) return Promise.resolve({ opened: false });
      // 先发起写入、不等它：await 之后再 open 会丢掉用户手势。侧边栏启动时读它，已开着的侧边栏监听变化
      void browser.storage.session
        .set({ [PANEL_VIEW_REQUEST_KEY]: { view: 'profile', at: Date.now() } })
        .catch(() => undefined);
      return open({ windowId }).then(
        () => ({ opened: true }),
        () => ({ opened: false }),
      );
    }
    if (msg?.type === 'feedsieve:open-tab') {
      // 内容脚本请求新开标签（例如 AI 味检测去回复页，不跳走当前页）。
      // 只允许 x.com 的回复页，避免变成任意 URL 跳板。
      const url = (msg as { url?: unknown }).url;
      if (
        typeof url !== 'string' ||
        !/^https:\/\/x\.com\/[a-z0-9_]+\/with_replies(?:\?[^#]*)?$/i.test(url)
      ) {
        return Promise.resolve({ ok: false });
      }
      return browser.tabs.create({ url, active: true }).then(
        () => ({ ok: true }),
        () => ({ ok: false }),
      );
    }
    if (msg?.type === 'feedsieve:hot-posts') {
      return sharedInsight.hotList(isHotSort(msg.sort) ? msg.sort : 'heat');
    }
    if (msg?.type === 'feedsieve:hot-brief') {
      return sharedInsight.brief();
    }
    if (msg?.type === INSIGHT_READ_MESSAGE) {
      return sharedInsight
        .markRead((message as { postIds?: unknown }).postIds)
        .then((added) => ({ added }));
    }
    if (msg?.type === INSIGHT_SEEN_MESSAGE) {
      return sharedInsight
        .markSeen((message as { posts?: unknown }).posts)
        .then((recorded) => ({ recorded }));
    }
    if (msg?.type === 'feedsieve:hot-read-ids') {
      return sharedInsight.readIds();
    }
    // AI 味检测：判定 / 投票转发到福滤娃服务器（见 ai-check/client.ts）
    return handleAiCheckMessage(message);
  });
  // MV3 service worker 随时可能被回收：这里只做事件入口。
  // 名单/词库同步不做定时 alarm：数据只在 X 页面打开时才被消费，
  // content script 启动、每 15 分钟、回到前台与 popup 打开都会触发同步，
  // 无需浏览器级定时唤醒（也避免 CWS 多解释一个 alarms 权限）。

  /**
   * 官方暂停开关实时检查，带 30s 内存 TTL：批量队列突发（每任务一问）
   * 只产生一次请求；网络失败回退本地验签快照（只会更保守）。
   */
  let officialPauseCheck: { at: number; state: OfficialPauseState } | null = null;
  const OFFICIAL_PAUSE_CHECK_TTL_MS = 30_000;

  async function checkOfficialPauseNow(): Promise<OfficialPauseState> {
    const now = Date.now();
    if (officialPauseCheck && now - officialPauseCheck.at < OFFICIAL_PAUSE_CHECK_TTL_MS) {
      return officialPauseCheck.state;
    }
    officialPauseCheck = null;
    try {
      const res = await fetch(`${COMMUNITY_API_BASE}/v1/kill-switch`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(5_000),
      });
      if (res.ok) {
        const body = (await res.json()) as {
          destructive_actions_disabled?: unknown;
          reason?: string;
          disabled_since?: string;
        };
        const state: OfficialPauseState =
          body?.destructive_actions_disabled === true
            ? {
                destructive_actions_disabled: true,
                reason: body.reason,
                disabled_since: body.disabled_since,
              }
            : { destructive_actions_disabled: false };
        officialPauseCheck = { at: now, state };
        return state;
      }
    } catch {
      // 网络不可达：回退本地快照
    }
    const state: OfficialPauseState = (await getCommunityKillSwitch()) ?? {
      destructive_actions_disabled: false,
    };
    officialPauseCheck = { at: now, state };
    return state;
  }

  function sync(force: boolean) {
    return syncCommunitySnapshot({
      sources: COMMUNITY_SYNC_SOURCES,
      fetchImpl: (url) => fetch(url),
      store: snapshotStore,
      force,
    });
  }

  function syncKeywordPacks(force: boolean) {
    return syncKeywordPackCatalog({ force });
  }

  browser.runtime.onInstalled.addListener((details) => {
    console.info(`[FeedSieve] installed (${details.reason})`);
    // 安装/更新后立即拉一次社区快照和关键词包。
    void sync(true);
    void syncKeywordPacks(true);
    // 升级后补传历史黑名单/白名单；同步状态会防止重复上传。
    void flushContributions();
    void flushTrainingSamples();
    // 默认点击图标打开浮层（popup），支持用户在浮层内一键切换为侧边栏
    const sidePanel = getChromeSidePanel();
    if (sidePanel?.setPanelBehavior) {
      sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
    }
  });

  browser.runtime.onStartup.addListener(() => {
    // 社区名单与关键词包各自控制节流；关键词包当前每 15 分钟可检查一次 manifest。
    void sync(false);
    void syncKeywordPacks(false);
    // 补交上次网络失败时积压的社区贡献
    void flushContributions();
    void flushTrainingSamples();
  });

  // 内容脚本启动/每 15 分钟/重新回到前台时请求关键词同步；popup 手动同步带 force。
  browser.runtime.onMessage.addListener((message: unknown) => {
    const msg = message as { type?: string; force?: boolean } | null;
    if (msg?.type === 'feedsieve:samples-flush')
      return flushTrainingSamples().then(() => ({ ok: true }));
    if (msg?.type === 'feedsieve:community-sync') {
      void flushTrainingSamples();
      return sync(msg.force === true).then((outcome) => ({
        type: 'feedsieve:community-sync',
        outcome,
      }));
    }
    if (msg?.type === 'feedsieve:keyword-packs-sync') {
      return syncKeywordPacks(msg.force === true).then((outcome) => ({
        type: 'feedsieve:keyword-packs-sync',
        outcome,
      }));
    }
    if (msg?.type === 'feedsieve:official-pause-check') {
      // 破坏性操作前的官方暂停实时门控（popup 打开与 content 执行前都会问）。
      return checkOfficialPauseNow().then((state) => ({
        type: 'feedsieve:official-pause-check',
        paused: state.destructive_actions_disabled,
        reason: state.destructive_actions_disabled ? state.reason : undefined,
        disabledSince: state.destructive_actions_disabled ? state.disabled_since : undefined,
      }));
    }
    if (msg?.type === 'feedsieve:labels-sync') {
      return flushContributions().then(() => ({ type: 'feedsieve:labels-sync', ok: true }));
    }
    return undefined;
  });
});
