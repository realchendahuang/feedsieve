/**
 * x.com MAIN world 网络桥（只读）。
 *
 * 机制来自 PureTwitter：X 时间线的权威数据来自 GraphQL 请求（XHR + fetch 混用），
 * 在 MAIN world 把两者各包一层，就能只读地拿到结构化数据（handle + rest_id + bio），
 * 比 DOM 刮取稳定得多。这是规格 §3.1 允许的「最小化 main-world bridge」：
 * 只读响应，不触碰页面 JS runtime。
 *
 * 与页面唯一的通信方式是 CustomEvent（MAIN world 拿不到 chrome.*）：
 * 必须 dispatch 到 document（两个 world 共享 document；window 是各 world 独立的），
 * 且 detail 用 JSON 字符串 —— primitive 跨 world 传递在任何引擎语义下都安全。
 *
 * ## 2026-11 加固（排查用户反馈「开了扩展后 x.com 只剩 X 的兜底错误页」之后）
 *
 * 结论是那个错误页和本桥无关（X 的外壳脚本没加载成功才会出现），但桥是扩展在页面
 * 主线程里唯一改运行时的地方，按「即使桥自身有 bug 也绝不影响页面」重新实现：
 *
 * - 安装幂等：同一 world 只装一次；扩展热重载 / 二次注入不会叠加包裹。
 * - 全链路异常隔离：安装、取 URL、clone、解析、派发各自 try/catch，只记内部计数，
 *   不把异常抛进页面（包括 fetch 的 Promise 链）。
 * - 一次 clone：同一个响应最多 clone 一次，预排期与时间线两条解析链路共用一份 JSON。
 * - 只碰 JSON：content-type 明确非 JSON、无 body、体积超过上限、并发解析数超过上限的
 *   响应直接跳过 —— 不在页面主线程上搬大对象。
 * - detach()：能还原原始 fetch / XHR.send（扩展停用、排查现场用）。
 * - 诊断：window.__feedsieveMainBridge.state 可在控制台查看安装时间与跳过/异常计数。
 *
 * 桥挂掉只影响扩展自己的数据来源，不影响页面：所有异常都在桥这一侧消化。
 */

import { mayMatchEndpoint, parseXApiResponse } from '@feedsieve/x-adapter';
import { createParseThrottle, type ParseThrottle } from './xhr-bridge-guard';
import {
  graphqlOperation,
  isScheduledOperation,
  parseScheduledList,
  parseScheduledMutation,
  requestVariables,
  type ScheduledEvent,
} from '../compose/scheduled-parse';

/** MAIN world 解析结果事件（ISOLATED world 的 xhr-ingest 消费）。 */
export const XHR_ITEMS_EVENT = 'feedsieve:xhr-items';
/** 内容脚本启动后请求补发最近几次结果（直接打开帖子时首批数据比监听先到）。 */
export const XHR_REPLAY_EVENT = 'feedsieve:xhr-replay';
/** 预排期列表 / 新建 / 修改 / 删除（只读，供「落笔」模块记录）。 */
export const SCHEDULED_EVENT = 'feedsieve:scheduled';
/** MAIN world 安装标记：同时是幂等键，也是排查现场用的全局对象名。 */
export const BRIDGE_MARKER = '__feedsieveMainBridge';

/** 响应体超过这个字节数就不解析：时间线单页远小于它，超过的多半是媒体 / 长线程。 */
export const MAX_BODY_BYTES = 8 * 1024 * 1024;
/** 同时解析的响应数上限；超过就跳过本次（重复数据下一轮轮询还会来）。 */
export const MAX_INFLIGHT_PARSES = 3;
/** 最近解析结果缓存条数。 */
export const RECENT_MAX = 8;

/** fetch 的类型（`typeof fetch` 在测试环境里不好伪造，这里用最小形状）。 */
export type BridgeFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** XHR.send 的最小形状（只关心透传，参数原样交回原生实现）。 */
export type BridgeSend = (this: XMLHttpRequest, ...args: unknown[]) => unknown;

export interface MainWorldBridgeWindow {
  fetch: BridgeFetch;
  XMLHttpRequest?: { prototype: { send: BridgeSend } };
  [key: string]: unknown;
}

export interface MainWorldBridgeDocument {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
  dispatchEvent(event: Event): boolean;
}

export interface MainWorldBridgeState {
  /** 安装时刻（Unix 毫秒） */
  installedAt: number;
  /** 实际 clone + 解析的响应数 */
  parsed: number;
  /** 因非 JSON / 超大 / 无 body / 并发上限 / 非文本 XHR 跳过的响应数 */
  skipped: number;
  /** 桥自身吞掉的异常数（只影响扩展数据，不影响页面） */
  errors: number;
  /** 最近一次异常时刻；没有异常为 null */
  lastErrorAt: number | null;
}

export interface MainWorldBridge {
  readonly state: MainWorldBridgeState;
  /** 还原原始 fetch / XHR.send，并允许重新安装。 */
  detach(): void;
}

export interface MainWorldBridgeOptions {
  window: MainWorldBridgeWindow;
  document: MainWorldBridgeDocument;
  now?: () => number;
  maxBodyBytes?: number;
  maxInflightParses?: number;
}

/**
 * 安装只读网络桥。返回的 handle 可 detach；重复调用返回同一个 handle。
 *
 * 绝不抛异常：任何安装步骤失败都只记 state.errors，扩展其余功能照常工作。
 */
export function installMainWorldBridge(options: MainWorldBridgeOptions): MainWorldBridge {
  const win = options.window;
  const doc = options.document;
  const existing = win[BRIDGE_MARKER];
  if (isBridge(existing)) return existing;

  const now = options.now ?? (() => Date.now());
  const maxBodyBytes = options.maxBodyBytes ?? MAX_BODY_BYTES;
  const maxInflight = options.maxInflightParses ?? MAX_INFLIGHT_PARSES;
  const parseThrottle: ParseThrottle = createParseThrottle(options.now ? { now: options.now } : {});

  const state: MainWorldBridgeState = {
    installedAt: now(),
    parsed: 0,
    skipped: 0,
    errors: 0,
    lastErrorAt: null,
  };
  const recent: string[] = [];
  let inflight = 0;
  let detached = false;

  const noteError = (): void => {
    state.errors += 1;
    state.lastErrorAt = now();
  };

  // ---------- 跨 world 派发 ----------

  const dispatch = (type: string, detail: string): void => {
    try {
      doc.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));
    } catch {
      noteError();
    }
  };

  const emit = (payload: Record<string, unknown>): void => {
    let detail: string;
    try {
      detail = JSON.stringify(payload);
      recent.push(JSON.stringify({ ...payload, replay: true }));
      if (recent.length > RECENT_MAX) recent.shift();
    } catch {
      noteError();
      return;
    }
    dispatch(XHR_ITEMS_EVENT, detail);
  };

  const replayListener: EventListener = () => {
    for (const detail of recent) dispatch(XHR_ITEMS_EVENT, detail);
  };
  try {
    doc.addEventListener(XHR_REPLAY_EVENT, replayListener);
  } catch {
    noteError();
  }

  // ---------- 解析 ----------

  const inspectScheduled = (url: string, requestBody: unknown, body: unknown): void => {
    try {
      const operation = graphqlOperation(url);
      if (!isScheduledOperation(operation)) return;
      let event: ScheduledEvent | null = null;
      if (operation === 'FetchScheduledTweets') {
        const posts = parseScheduledList(body);
        event = posts ? { kind: 'list', posts } : null;
      } else {
        event = parseScheduledMutation(
          operation as string,
          requestVariables(url, requestBody),
          body,
        );
      }
      if (event) dispatch(SCHEDULED_EVENT, JSON.stringify(event));
    } catch {
      noteError();
    }
  };

  const inspectTimeline = (url: string, body: unknown): void => {
    try {
      const parsed = parseXApiResponse(url, body);
      if (parsed.matchedEndpoints.length === 0) return;
      // 只有真正解析过才 mark，否则节流窗口永不解除
      parseThrottle.mark(url);
      emit({ ...parsed, sourceUrl: url });
    } catch {
      noteError();
    }
  };

  const isJsonContentType = (contentType: string): boolean => {
    const lower = contentType.toLowerCase();
    return lower.includes('json') || lower.includes('text/plain');
  };

  /** 只读一次 body：两条解析链路共用同一个克隆；任何不满足条件的响应直接跳过。 */
  const readResponseJson = (response: Response, onBody: (body: unknown) => void): void => {
    let counted = false;
    try {
      if (!response) {
        state.skipped += 1;
        return;
      }
      if (response.type === 'opaque' || response.type === 'opaqueredirect') {
        state.skipped += 1;
        return;
      }
      if (!response.body) {
        state.skipped += 1;
        return;
      }
      let contentType = '';
      try {
        contentType = response.headers.get('content-type') ?? '';
      } catch {
        // 读不到 header（跨域 / 被冻结）时按 JSON 试一次
      }
      if (contentType && !isJsonContentType(contentType)) {
        state.skipped += 1;
        return;
      }
      let declared = Number.NaN;
      try {
        declared = Number(response.headers.get('content-length') ?? '');
      } catch {
        // 没有 content-length 时不做体积判断
      }
      if (Number.isFinite(declared) && declared > maxBodyBytes) {
        state.skipped += 1;
        return;
      }
      if (inflight >= maxInflight) {
        state.skipped += 1;
        return;
      }
      const clone = response.clone();
      counted = true;
      inflight += 1;
      state.parsed += 1;
      void clone
        .json()
        .then((body: unknown) => {
          try {
            onBody(body);
          } catch {
            noteError();
          }
        })
        .catch(() => {
          // 非 JSON 响应（X 偶尔返回空 body / HTML 错误页）：静默
          state.skipped += 1;
        })
        .finally(() => {
          inflight = Math.max(0, inflight - 1);
        });
    } catch {
      if (counted) inflight = Math.max(0, inflight - 1);
      noteError();
    }
  };

  /** 两条解析链路共用的入口：先判断要不要读 body，再读一次、分发给需要的链路。 */
  const inspectUrl = (
    url: string,
    requestBody: unknown,
    readBody: (onBody: (body: unknown) => void) => void,
  ): void => {
    if (!url) return;
    const operation = graphqlOperation(url);
    const wantsScheduled = isScheduledOperation(operation);
    // 节流放在 clone 之前：被节流掉的时间线轮询连 body 都不读
    const wantsTimeline = mayMatchEndpoint(url) && parseThrottle.allow(url);
    if (!wantsScheduled && !wantsTimeline) return;
    readBody((body) => {
      if (wantsScheduled) inspectScheduled(url, requestBody, body);
      if (wantsTimeline) inspectTimeline(url, body);
    });
  };

  // ---------- fetch 钩子（X 的部分 GraphQL 请求走 fetch） ----------

  let originalFetch: BridgeFetch | null = null;
  let patchedFetch: BridgeFetch | null = null;

  const inspectFetchResponse = (response: Response, args: Parameters<BridgeFetch>): void => {
    try {
      const input = args[0];
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input instanceof Request
              ? input.url
              : (response?.url ?? '');
      const init = args[1];
      const requestBody = typeof init?.body === 'string' ? init.body : null;
      inspectUrl(url, requestBody, (onBody) => readResponseJson(response, onBody));
    } catch {
      noteError();
    }
  };

  try {
    const current = win.fetch;
    if (typeof current === 'function') {
      originalFetch = current;
      const wrapped: BridgeFetch = function patchedFetch(
        this: unknown,
        ...args: Parameters<BridgeFetch>
      ) {
        const pending = current.apply(this ?? win, args);
        // 原生 fetch 恒为 Promise；页面/其它扩展换成 thenable 也按 Promise 语义处理
        if (!pending || typeof pending.then !== 'function') return pending;
        return pending.then((response: Response) => {
          inspectFetchResponse(response, args);
          return response;
        });
      } as BridgeFetch;
      patchedFetch = wrapped;
      win.fetch = wrapped;
    }
  } catch {
    noteError();
  }

  // ---------- XHR 钩子（覆盖仍走 XHR 的端点） ----------

  let originalSend: BridgeSend | null = null;
  let patchedSend: BridgeSend | null = null;

  const inspectXhr = (xhr: XMLHttpRequest, requestBody: string | null): void => {
    try {
      const url = xhr.responseURL;
      if (!url) return;
      const responseType = xhr.responseType;
      // blob / arraybuffer / document 不是 JSON，直接跳过
      if (responseType !== '' && responseType !== 'text' && responseType !== 'json') {
        state.skipped += 1;
        return;
      }
      const operation = graphqlOperation(url);
      const wantsScheduled = isScheduledOperation(operation);
      const wantsTimeline = mayMatchEndpoint(url) && parseThrottle.allow(url);
      if (!wantsScheduled && !wantsTimeline) return;
      let contentType = '';
      try {
        contentType = xhr.getResponseHeader('content-type') ?? '';
      } catch {
        // header 不可读时按 JSON 试一次
      }
      if (contentType && !isJsonContentType(contentType)) {
        state.skipped += 1;
        return;
      }
      let declared = Number.NaN;
      try {
        declared = Number(xhr.getResponseHeader('content-length') ?? '');
      } catch {
        // 忽略
      }
      if (Number.isFinite(declared) && declared > maxBodyBytes) {
        state.skipped += 1;
        return;
      }
      let body: unknown;
      try {
        body = responseType === 'json' ? xhr.response : JSON.parse(xhr.responseText);
      } catch {
        state.skipped += 1;
        return;
      }
      if (wantsScheduled) inspectScheduled(url, requestBody, body);
      if (wantsTimeline) inspectTimeline(url, body);
    } catch {
      noteError();
    }
  };

  try {
    const proto = win.XMLHttpRequest?.prototype;
    const send = proto?.send;
    if (proto && typeof send === 'function') {
      originalSend = send;
      const wrapped: BridgeSend = function patchedSend(this: XMLHttpRequest, ...args: unknown[]) {
        try {
          const requestBody = typeof args[0] === 'string' ? args[0] : null;
          this.addEventListener('load', () => {
            inspectXhr(this, requestBody);
          });
        } catch {
          noteError();
        }
        return send.apply(this, args);
      };
      patchedSend = wrapped;
      proto.send = wrapped;
    }
  } catch {
    noteError();
  }

  // ---------- 收尾 ----------

  const detach = (): void => {
    if (detached) return;
    detached = true;
    try {
      if (patchedFetch && originalFetch && win.fetch === patchedFetch) {
        win.fetch = originalFetch;
      }
    } catch {
      noteError();
    }
    try {
      const proto = win.XMLHttpRequest?.prototype;
      if (patchedSend && originalSend && proto && proto.send === patchedSend) {
        proto.send = originalSend;
      }
    } catch {
      noteError();
    }
    try {
      doc.removeEventListener(XHR_REPLAY_EVENT, replayListener);
    } catch {
      noteError();
    }
    try {
      delete win[BRIDGE_MARKER];
    } catch {
      // 页面冻结 window 时无法清理标记；detach 已尽量完成
    }
  };

  const bridge: MainWorldBridge = { state, detach };
  try {
    win[BRIDGE_MARKER] = bridge;
  } catch {
    // 页面冻结 window：桥仍可用，只是没有幂等标记
  }
  return bridge;
}

/** 判断全局标记是不是同一版本的桥（防止旧版本残留对象被当成 handle）。 */
function isBridge(value: unknown): value is MainWorldBridge {
  return (
    typeof value === 'object' &&
    value !== null &&
    'state' in value &&
    'detach' in value &&
    typeof (value as { detach?: unknown }).detach === 'function'
  );
}
