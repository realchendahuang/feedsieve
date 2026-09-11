import { syncCommunitySnapshot } from '@feedsieve/community-lists';
import {
  COMMUNITY_API_BASE,
  COMMUNITY_SYNC_SOURCES,
  getCommunityKillSwitch,
  snapshotStore,
  type OfficialPauseState,
} from '../src/lib/community-store';
import { flushContributions } from '../src/lib/contribute';
import { syncKeywordPackCatalog } from '../src/lib/keyword-packs';
import { getChromeSidePanel } from '../src/lib/sidepanel';

export default defineBackground(() => {
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
    const state: OfficialPauseState =
      (await getCommunityKillSwitch()) ?? { destructive_actions_disabled: false };
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
  });

  // 内容脚本启动/每 15 分钟/重新回到前台时请求关键词同步；popup 手动同步带 force。
  browser.runtime.onMessage.addListener((message: unknown) => {
    const msg = message as { type?: string; force?: boolean } | null;
    if (msg?.type === 'feedsieve:community-sync') {
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
