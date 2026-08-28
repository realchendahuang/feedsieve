import { syncCommunitySnapshot } from '@feedsieve/community-lists';
import {
  COMMUNITY_SYNC_SOURCES,
  snapshotStore,
} from '../src/lib/community-store';
import { flushContributions } from '../src/lib/contribute';

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

  browser.runtime.onInstalled.addListener((details) => {
    console.info(`[FeedSieve] installed (${details.reason})`);
    // 安装/更新后立即拉一次社区快照（跳过 6h 节流）
    void sync(true);
  });

  browser.runtime.onStartup.addListener(() => {
    // 节流由 syncCommunitySnapshot 内部控制（6h）
    void sync(false);
    // 补交上次网络失败时积压的社区贡献
    void flushContributions();
  });

  // 内容脚本启动时请求一次同步（6h 节流）；popup 手动同步带 force，并回传结果
  browser.runtime.onMessage.addListener((message: unknown) => {
    const msg = message as { type?: string; force?: boolean } | null;
    if (msg?.type === 'feedsieve:community-sync') {
      return sync(msg.force === true).then((outcome) => ({
        type: 'feedsieve:community-sync',
        outcome,
      }));
    }
    return undefined;
  });
});
