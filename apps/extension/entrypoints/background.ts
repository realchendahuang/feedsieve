import { syncCommunitySnapshot } from '@feedsieve/community-lists';
import { COMMUNITY_SYNC_SOURCES, snapshotStore } from '../src/lib/community-store';
import { flushContributions } from '../src/lib/contribute';
import { syncKeywordPackCatalog } from '../src/lib/keyword-packs';

const COMMUNITY_SYNC_ALARM = 'feedsieve-community-sync';
const KEYWORD_PACK_SYNC_ALARM = 'feedsieve-keyword-pack-sync';
const COMMUNITY_SYNC_PERIOD_MINUTES = 6 * 60;
const KEYWORD_PACK_SYNC_PERIOD_MINUTES = 15;

export default defineBackground(() => {
  // MV3 service worker 随时可能被回收：这里只做事件入口。

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

  async function ensureSyncAlarms(): Promise<void> {
    const [communityAlarm, keywordAlarm] = await Promise.all([
      browser.alarms.get(COMMUNITY_SYNC_ALARM),
      browser.alarms.get(KEYWORD_PACK_SYNC_ALARM),
    ]);
    if (!communityAlarm) {
      await browser.alarms.create(COMMUNITY_SYNC_ALARM, {
        delayInMinutes: COMMUNITY_SYNC_PERIOD_MINUTES,
        periodInMinutes: COMMUNITY_SYNC_PERIOD_MINUTES,
      });
    }
    if (!keywordAlarm) {
      await browser.alarms.create(KEYWORD_PACK_SYNC_ALARM, {
        delayInMinutes: KEYWORD_PACK_SYNC_PERIOD_MINUTES,
        periodInMinutes: KEYWORD_PACK_SYNC_PERIOD_MINUTES,
      });
    }
  }

  async function syncWithJitter(syncTask: () => Promise<unknown>): Promise<void> {
    // Spread clients that were installed at the same time without delaying
    // explicit user-triggered sync requests.
    const jitterMs = Math.floor(Math.random() * 30_000);
    await new Promise((resolve) => setTimeout(resolve, jitterMs));
    await syncTask();
  }

  void ensureSyncAlarms().catch((error) => {
    console.warn('[FeedSieve] could not schedule sync alarms:', error);
  });

  browser.runtime.onInstalled.addListener((details) => {
    console.info(`[FeedSieve] installed (${details.reason})`);
    void ensureSyncAlarms();
    // 安装/更新后立即拉一次社区快照和关键词包。
    void sync(true);
    void syncKeywordPacks(true);
    // 升级后补传历史黑名单/白名单；同步状态会防止重复上传。
    void flushContributions();
  });

  browser.runtime.onStartup.addListener(() => {
    void ensureSyncAlarms();
    // 社区名单与关键词包各自控制节流；关键词包当前每 15 分钟可检查一次 manifest。
    void sync(false);
    void syncKeywordPacks(false);
    // 补交上次网络失败时积压的社区贡献
    void flushContributions();
  });

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === COMMUNITY_SYNC_ALARM) {
      void syncWithJitter(() => sync(false));
    } else if (alarm.name === KEYWORD_PACK_SYNC_ALARM) {
      void syncWithJitter(() => syncKeywordPacks(false));
    }
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
    if (msg?.type === 'feedsieve:labels-sync') {
      return flushContributions().then(() => ({ type: 'feedsieve:labels-sync', ok: true }));
    }
    return undefined;
  });
});
