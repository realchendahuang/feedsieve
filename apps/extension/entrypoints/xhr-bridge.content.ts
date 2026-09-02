import { parseXApiResponse } from '@feedsieve/x-adapter';

/**
 * 网络桥（MAIN world）—— 机制来自 PureTwitter（docs/research/PURETWITTER_MECHANISM.md）。
 *
 * X 页面的时间线数据来自 GraphQL 请求（XHR + fetch 混用）；在 MAIN world 劫持两者，
 * 即可在网络层拿到权威结构化数据（handle + rest_id + bio），比 DOM 刮取稳定得多。
 * 这是规格 §3.1 允许的「最小化 main-world bridge」：只读网络响应，不触碰页面 JS runtime。
 *
 * 与页面唯一的通信方式是 CustomEvent（MAIN world 无法用 chrome.*）。
 * 注意：必须 dispatch 到 document（两个 world 共享 document；window 是各 world 独立的），
 * 且 detail 用 JSON 字符串——primitive 跨 world 传递在任何引擎语义下都安全。
 */
export default defineContentScript({
  matches: ['https://x.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    const EVENT_NAME = 'feedsieve:xhr-items';

    function emit(payload: unknown): void {
      try {
        document.dispatchEvent(
          new CustomEvent(EVENT_NAME, {
            bubbles: true,
            detail: JSON.stringify(payload),
          }),
        );
      } catch {
        // 页面可能冻结 CustomEvent；桥挂了不影响页面本身
      }
    }

    function inspect(url: string, body: unknown): void {
      try {
        const parsed = parseXApiResponse(url, body);
        if (parsed.matchedEndpoints.length > 0) {
          emit({ ...parsed, sourceUrl: url });
        }
      } catch {
        // 非 JSON / 解析失败：静默，绝不影响页面
      }
    }

    // ---------- fetch 钩子（X 的部分 GraphQL 请求走 fetch） ----------
    const origFetch = window.fetch;
    window.fetch = async function patchedFetch(this: unknown, ...args: Parameters<typeof fetch>) {
      const response = await origFetch.apply(this ?? window, args);
      try {
        const input = args[0];
        const url =
          typeof input === 'string'
            ? input
            : ((input instanceof Request ? input.url : response.url) ?? '');
        if (
          url.includes('/i/api/') ||
          url.includes('api.x.com') ||
          url.includes('api.twitter.com')
        ) {
          // clone 后异步读 body，不消费原响应（页面照常拿到数据）
          void response
            .clone()
            .json()
            .then((body) => inspect(url, body))
            .catch(() => {});
        }
      } catch {
        // 检查自身异常不影响请求返回
      }
      return response;
    } as typeof fetch;

    // ---------- XHR 钩子（PureTwitter 同款，覆盖仍走 XHR 的端点） ----------
    const xhrProto = XMLHttpRequest.prototype;
    const origSend = xhrProto.send;
    const origSetHeader = xhrProto.setRequestHeader;

    xhrProto.setRequestHeader = function (this: XMLHttpRequest, name: string, value: string) {
      // 网页端发请求必带 authorization 头；顺手捕获留给未来需要时使用
      if (name === 'authorization' && value) {
        try {
          document.dispatchEvent(
            new CustomEvent('feedsieve:auth-header', { bubbles: true, detail: '1' }),
          );
        } catch {
          // 忽略
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
          inspect(this.responseURL, body);
        } catch {
          // 非 JSON 响应：静默
        }
      });
      return (origSend as (this: XMLHttpRequest, ...args: unknown[]) => void).apply(this, args);
    };
  },
});
