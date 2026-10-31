import { mayMatchEndpoint, parseXApiResponse } from '@feedsieve/x-adapter';
import { createParseThrottle } from '../src/lib/platform/xhr-bridge-guard';
import {
  graphqlOperation,
  isScheduledOperation,
  parseScheduledList,
  parseScheduledMutation,
  requestVariables,
  type ScheduledEvent,
} from '../src/lib/compose/scheduled-parse';

/**
 * 网络桥（MAIN world）—— 机制来自 PureTwitter（docs/legacy/research/PURETWITTER_MECHANISM.md）。
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
    const REPLAY_EVENT = 'feedsieve:xhr-replay';
    /** 最近几次解析结果：直接打开帖子链接时，X 的首批数据比内容脚本的监听先到，靠它补发 */
    const RECENT_MAX = 8;
    const recent: string[] = [];

    function dispatch(detail: string): void {
      try {
        document.dispatchEvent(new CustomEvent(EVENT_NAME, { bubbles: true, detail }));
      } catch {
        // 页面可能冻结 CustomEvent；桥挂了不影响页面本身
      }
    }

    function emit(payload: unknown): void {
      const detail = JSON.stringify(payload);
      recent.push(JSON.stringify({ ...(payload as object), replay: true }));
      if (recent.length > RECENT_MAX) recent.shift();
      dispatch(detail);
    }

    // 内容脚本启动后请求补发：补发的数据带 replay 标记，接收端只给不怕重复的模块用
    document.addEventListener(REPLAY_EVENT, () => {
      for (const detail of recent) dispatch(detail);
    });

    // 预排期：X 自己拉列表、新建 / 修改 / 删除预排期帖子时顺带记下（只读，不改请求）
    const SCHEDULED_EVENT = 'feedsieve:scheduled';
    function inspectScheduled(url: string, requestBody: unknown, body: unknown): void {
      try {
        const operation = graphqlOperation(url);
        if (!isScheduledOperation(operation)) return;
        let event: ScheduledEvent | null = null;
        if (operation === 'FetchScheduledTweets') {
          const posts = parseScheduledList(body);
          event = posts ? { kind: 'list', posts } : null;
        } else {
          event = parseScheduledMutation(operation!, requestVariables(url, requestBody), body);
        }
        if (event) {
          document.dispatchEvent(
            new CustomEvent(SCHEDULED_EVENT, { bubbles: true, detail: JSON.stringify(event) }),
          );
        }
      } catch {
        // 解析失败不影响页面
      }
    }

    // 时间线解析节流：只降被动滚动时的高频轮询开销，不影响其它端点（见 guard 模块注释）
    const parseThrottle = createParseThrottle();

    function inspect(url: string, body: unknown): void {
      try {
        // 节流窗口内的重复时间线轮询直接跳过（只降开销，不影响正确性）
        if (!parseThrottle.allow(url)) {
          return;
        }
        const parsed = parseXApiResponse(url, body);
        if (parsed.matchedEndpoints.length > 0) {
          // 只有真正解析过才 mark，否则窗口永不解除
          parseThrottle.mark(url);
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
        if (isScheduledOperation(graphqlOperation(url))) {
          const init = args[1];
          const requestBody = typeof init?.body === 'string' ? init.body : null;
          void response
            .clone()
            .json()
            .then((body) => inspectScheduled(url, requestBody, body))
            .catch(() => {});
        }
        if (
          url.includes('/i/api/') ||
          url.includes('api.x.com') ||
          url.includes('api.twitter.com')
        ) {
          // 先按 URL 特征过滤：只 clone+解析已知端点，私信/通知等大响应不做二次 JSON.parse
          if (mayMatchEndpoint(url)) {
            // clone 后异步读 body，不消费原响应（页面照常拿到数据）
            void response
              .clone()
              .json()
              .then((body) => inspect(url, body))
              .catch(() => {});
          }
        }
      } catch {
        // 检查自身异常不影响请求返回
      }
      return response;
    } as typeof fetch;

    // ---------- XHR 钩子（PureTwitter 同款，覆盖仍走 XHR 的端点） ----------
    const xhrProto = XMLHttpRequest.prototype;
    const origSend = xhrProto.send;

    xhrProto.send = function (this: XMLHttpRequest, ...args: unknown[]) {
      const requestBody = typeof args[0] === 'string' ? args[0] : null;
      this.addEventListener('load', () => {
        try {
          if (this.responseType === 'blob') {
            return;
          }
          if (isScheduledOperation(graphqlOperation(this.responseURL))) {
            const scheduledBody =
              this.responseType === '' || this.responseType === 'text'
                ? JSON.parse(this.responseText as string)
                : this.response;
            inspectScheduled(this.responseURL, requestBody, scheduledBody);
          }
          if (!mayMatchEndpoint(this.responseURL)) {
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
