import { installMuteBridge, type MuteBridgeWindow } from '../src/lib/mute/mute-bridge';

/**
 * X 原生静音词的 transaction id 生成桥（MAIN world）。
 *
 * X 的 `/i/api/1.1/mutes/keywords/*` 需要 `x-client-transaction-id`，这个值由
 * 页面自己的 webpack 签名模块按「路径 + 方法」生成。隔离世界拿不到页面 JS，
 * 所以这里只做一件事：收到固定路径的请求，调用 X 自己的签名器，把结果交回去。
 *
 * 真正的 fetch 仍在隔离世界执行，且只允许 list/create/destroy 三个端点。
 * 不提供任意 URL 的签名能力，避免被页面脚本当成通用签名器。
 */
export default defineContentScript({
  matches: ['https://x.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    installMuteBridge({
      window: window as unknown as MuteBridgeWindow,
      document,
    });
  },
});
