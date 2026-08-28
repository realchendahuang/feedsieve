import { syncCommunitySnapshot } from '@feedsieve/community-lists';
import {
  COMMUNITY_API_BASE,
  snapshotStore,
} from '../src/lib/community-store';
import { flushContributions } from '../src/lib/contribute';

export default defineBackground(() => {
  // MV3 service worker 随时可能被回收：这里只做事件入口。

  browser.runtime.onInstalled.addListener((details) => {
    console.info(`[FeedSieve] installed (${details.reason})`);
    // 安装/更新后立即拉一次社区快照（跳过 6h 节流）
    void syncCommunitySnapshot({
      apiBase: COMMUNITY_API_BASE,
      fetchImpl: (url) => fetch(url),
      store: snapshotStore,
      force: true,
    });
  });

  browser.runtime.onStartup.addListener(() => {
    // 节流由 syncCommunitySnapshot 内部控制（6h）
    void syncCommunitySnapshot({
      apiBase: COMMUNITY_API_BASE,
      fetchImpl: (url) => fetch(url),
      store: snapshotStore,
    });
    // 补交上次网络失败时积压的社区贡献
    void flushContributions();
  });

  // 内容脚本启动时请求一次同步（同样受 6h 节流；本消息无响应消费者，fire-and-forget）
  browser.runtime.onMessage.addListener((message: unknown) => {
    if ((message as { type?: string } | null)?.type === 'feedsieve:community-sync') {
      void syncCommunitySnapshot({
        apiBase: COMMUNITY_API_BASE,
        fetchImpl: (url) => fetch(url),
        store: snapshotStore,
      });
      return false; // 同步响应：不需要回传通道
    }
    return undefined;
  });
});
