import { parseXApiResponse } from '@feedsieve/x-adapter';

/**
 * XHR 桥（MAIN world）—— 机制来自 PureTwitter（docs/research/PURETWITTER_MECHANISM.md）。
 *
 * X 页面的时间线数据来自 GraphQL XHR；劫持 XHR 即可在网络层拿到权威结构化数据
 * （handle + rest_id + bio），比 DOM 刮取稳定得多。这是规格 §3.1 允许的
 * 「最小化 main-world bridge」：只读网络响应，不触碰页面 JS runtime。
 *
 * 与页面唯一的通信方式是 CustomEvent（MAIN world 无法用 chrome.*）。
 */
export default defineContentScript({
  matches: ['https://x.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    const EVENT_NAME = 'feedsieve:xhr-items';

    const xhrProto = XMLHttpRequest.prototype;
    const origSend = xhrProto.send;
    const origSetHeader = xhrProto.setRequestHeader;

    xhrProto.setRequestHeader = function (this: XMLHttpRequest, name: string, value: string) {
      // 网页端发请求必带 authorization 头；顺手捕获留给未来需要时使用
      if (name === 'authorization' && value) {
        try {
          document.dispatchEvent(
            new CustomEvent('feedsieve:auth-header', { detail: { captured: true } }),
          );
        } catch {
          // 页面可能冻结 CustomEvent；桥挂了不影响页面本身
        }
      }
      return origSetHeader.apply(this, [name, value] as never);
    };

    xhrProto.send = function (this: XMLHttpRequest, ...args: unknown[]) {
      this.addEventListener('load', () => {
        try {
          if (this.responseType === 'blob') {
            return;
          }
          const body =
            this.responseType === '' || this.responseType === 'text'
              ? JSON.parse(this.responseText as string)
              : this.response;
          const parsed = parseXApiResponse(this.responseURL, body);
          if (parsed.matchedEndpoints.length > 0) {
            document.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: parsed }));
          }
        } catch {
          // 非 JSON 响应 / 解析失败：静默，绝不影响页面
        }
      });
      return (origSend as (this: XMLHttpRequest, ...args: unknown[]) => void).apply(this, args);
    };
  },
});
