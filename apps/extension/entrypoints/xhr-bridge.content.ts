import {
  installMainWorldBridge,
  type MainWorldBridgeDocument,
  type MainWorldBridgeWindow,
} from '../src/lib/platform/main-world-bridge';

/**
 * 网络桥（MAIN world）—— 机制来自 PureTwitter。
 *
 * X 页面的时间线数据来自 GraphQL 请求（XHR + fetch 混用）；在 MAIN world 劫持两者，
 * 即可在网络层拿到权威结构化数据（handle + rest_id + bio），比 DOM 刮取稳定得多。
 * 这是规格 §3.1 允许的「最小化 main-world bridge」：只读网络响应，不触碰页面 JS runtime。
 *
 * 实现与全部安全边界（幂等安装、异常隔离、只读一次 body、JSON/体积守卫、detach）
 * 都在 src/lib/platform/main-world-bridge.ts，本文件只负责在 document_start 装上它。
 * 桥自身出任何问题都只影响扩展的数据来源，不会把异常抛进页面。
 */
export default defineContentScript({
  matches: ['https://x.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    installMainWorldBridge({
      window: window as unknown as MainWorldBridgeWindow,
      document: document as unknown as MainWorldBridgeDocument,
    });
  },
});
