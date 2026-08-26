export default defineBackground(() => {
  // MV3 service worker 随时可能被回收：这里只做事件入口。
  // 队列协调、快照更新等持久化逻辑在后续阶段接入（TECHNICAL_SPEC.md §3.2）。
  browser.runtime.onInstalled.addListener((details) => {
    console.info(`[FeedSieve] installed (${details.reason})`);
  });
});
