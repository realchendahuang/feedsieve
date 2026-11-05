import { describe, expect, it, vi } from 'vitest';
import {
  BRIDGE_MARKER,
  MAX_BODY_BYTES,
  SCHEDULED_EVENT,
  XHR_ITEMS_EVENT,
  XHR_REPLAY_EVENT,
  installMainWorldBridge,
  type BridgeFetch,
  type MainWorldBridgeDocument,
  type MainWorldBridgeWindow,
} from './main-world-bridge';

const TIMELINE_URL = 'https://x.com/i/api/graphql/abc123/HomeTimeline?variables=%7B%7D';
const SCHEDULED_URL = 'https://x.com/i/api/graphql/def456/FetchScheduledTweets?variables=%7B%7D';
const OTHER_URL = 'https://x.com/i/api/graphql/ghi789/NoSuchOperation?variables=%7B%7D';

/** 一个最小的 XHR 替身：只为验证「透传 send + load 时读响应」。 */
function createXhrClass() {
  class FakeXhr extends EventTarget {
    responseURL = '';
    responseType: '' | 'text' | 'json' | 'blob' = '';
    response: unknown = null;
    responseText = '';
    headers = new Map<string, string>();
    /** 原生 send 收到的参数（验证透传） */
    sent: unknown[][] = [];

    getResponseHeader(name: string): string | null {
      return this.headers.get(name.toLowerCase()) ?? null;
    }

    send(...args: unknown[]): void {
      this.sent.push(args);
    }
  }
  return FakeXhr;
}

function createWindow(
  fetchImpl: BridgeFetch,
  XhrClass: ReturnType<typeof createXhrClass>,
): MainWorldBridgeWindow {
  return { fetch: fetchImpl, XMLHttpRequest: XhrClass } as unknown as MainWorldBridgeWindow;
}

function createDocument(): { document: MainWorldBridgeDocument; target: EventTarget } {
  const target = new EventTarget();
  return { document: target as unknown as MainWorldBridgeDocument, target };
}

function jsonResponse(
  body: unknown,
  init: { contentType?: string | null; contentLength?: string } = {},
): Response {
  const headers = new Headers();
  if (init.contentType !== null) {
    headers.set('content-type', init.contentType ?? 'application/json; charset=utf-8');
  }
  if (init.contentLength) headers.set('content-length', init.contentLength);
  return new Response(JSON.stringify(body), { status: 200, headers });
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** 记录 document 上派发的 CustomEvent detail。 */
function collect(target: EventTarget, type: string): string[] {
  const details: string[] = [];
  target.addEventListener(type, (event) => {
    details.push((event as CustomEvent<string>).detail);
  });
  return details;
}

function install(
  overrides: {
    fetchImpl?: BridgeFetch;
    XhrClass?: ReturnType<typeof createXhrClass>;
    now?: () => number;
    document?: MainWorldBridgeDocument;
    maxBodyBytes?: number;
    maxInflightParses?: number;
  } = {},
) {
  const fetchImpl = overrides.fetchImpl ?? (async () => jsonResponse({}));
  const XhrClass = overrides.XhrClass ?? createXhrClass();
  const win = createWindow(fetchImpl, XhrClass);
  const { document, target } = createDocument();
  const bridge = installMainWorldBridge({
    window: win,
    document: overrides.document ?? document,
    ...(overrides.now ? { now: overrides.now } : {}),
    ...(overrides.maxBodyBytes !== undefined ? { maxBodyBytes: overrides.maxBodyBytes } : {}),
    ...(overrides.maxInflightParses !== undefined
      ? { maxInflightParses: overrides.maxInflightParses }
      : {}),
  });
  return { bridge, win, XhrClass, document, target };
}

describe('installMainWorldBridge', () => {
  it('重复安装返回同一个 handle，不会叠加包裹 fetch', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}));
    const XhrClass = createXhrClass();
    const win = createWindow(fetchImpl as unknown as BridgeFetch, XhrClass);
    const { document } = createDocument();

    const first = installMainWorldBridge({ window: win, document });
    const second = installMainWorldBridge({ window: win, document });

    expect(second).toBe(first);
    expect(win[BRIDGE_MARKER]).toBe(first);
    expect(win.fetch).not.toBe(fetchImpl);

    await win.fetch(OTHER_URL);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(first.state.errors).toBe(0);
  });

  it('匹配端点：原样返回页面拿到的 Response，并派发一次解析结果', async () => {
    const response = jsonResponse({});
    const fetchImpl = vi.fn(async () => response);
    const { bridge, win, target } = install({
      fetchImpl: fetchImpl as unknown as BridgeFetch,
    });
    const details = collect(target, XHR_ITEMS_EVENT);

    const returned = await win.fetch(TIMELINE_URL);
    await flush();

    expect(returned).toBe(response);
    expect(bridge.state.parsed).toBe(1);
    expect(details).toHaveLength(1);
    const payload = JSON.parse(details[0]!) as {
      matchedEndpoints: string[];
      sourceUrl: string;
    };
    expect(payload.matchedEndpoints).toEqual(['HomeTimeline']);
    expect(payload.sourceUrl).toBe(TIMELINE_URL);
  });

  it('不匹配的 URL 不 clone、不解析', async () => {
    const response = jsonResponse({});
    const clone = vi.spyOn(response, 'clone');
    const { bridge, win } = install({
      fetchImpl: (async () => response) as unknown as BridgeFetch,
    });

    await win.fetch(OTHER_URL);
    await flush();

    expect(clone).not.toHaveBeenCalled();
    expect(bridge.state.parsed).toBe(0);
    expect(bridge.state.skipped).toBe(0);
  });

  it('content-type 明确不是 JSON 时跳过（不 clone）', async () => {
    const response = new Response('<!doctype html>', {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
    const clone = vi.spyOn(response, 'clone');
    const { bridge, win, target } = install({
      fetchImpl: (async () => response) as unknown as BridgeFetch,
    });
    const details = collect(target, XHR_ITEMS_EVENT);

    const returned = await win.fetch(TIMELINE_URL);
    await flush();

    expect(returned).toBe(response);
    expect(clone).not.toHaveBeenCalled();
    expect(details).toHaveLength(0);
    expect(bridge.state.skipped).toBe(1);
  });

  it('content-length 超过上限时跳过', async () => {
    const response = jsonResponse({}, { contentLength: String(MAX_BODY_BYTES + 1) });
    const clone = vi.spyOn(response, 'clone');
    const { bridge, win } = install({
      fetchImpl: (async () => response) as unknown as BridgeFetch,
    });

    await win.fetch(TIMELINE_URL);
    await flush();

    expect(clone).not.toHaveBeenCalled();
    expect(bridge.state.skipped).toBe(1);
  });

  it('opaque 响应（读不到 header / body）直接跳过', async () => {
    const opaque = {
      type: 'opaque',
      body: null,
      headers: new Headers(),
      clone: () => {
        throw new Error('opaque 不该被 clone');
      },
      url: TIMELINE_URL,
    } as unknown as Response;
    const { bridge, win } = install({
      fetchImpl: (async () => opaque) as unknown as BridgeFetch,
    });

    await win.fetch(TIMELINE_URL);
    await flush();

    expect(bridge.state.skipped).toBe(1);
    expect(bridge.state.errors).toBe(0);
  });

  it('时间线节流：窗口内的重复轮询不 clone，窗口过后恢复', async () => {
    let at = 1_000_000;
    const response = jsonResponse({});
    const clone = vi.spyOn(response, 'clone');
    const { bridge, win } = install({
      fetchImpl: (async () => response) as unknown as BridgeFetch,
      now: () => at,
    });

    await win.fetch(TIMELINE_URL);
    await flush();
    expect(clone).toHaveBeenCalledTimes(1);

    at += 200;
    await win.fetch(TIMELINE_URL);
    await flush();
    expect(clone).toHaveBeenCalledTimes(1);

    at += 1000;
    await win.fetch(TIMELINE_URL);
    await flush();
    expect(clone).toHaveBeenCalledTimes(2);
    expect(bridge.state.parsed).toBe(2);
  });

  it('并发解析超过上限时跳过新的响应（避免主线程同时搬多个大对象）', async () => {
    let clones = 0;
    const neverEnding = {
      type: 'basic',
      body: {},
      headers: new Headers({ 'content-type': 'application/json' }),
      clone: () => {
        clones += 1;
        return { json: () => new Promise(() => undefined) };
      },
      url: TIMELINE_URL,
    } as unknown as Response;
    const { bridge, win } = install({
      fetchImpl: (async () => neverEnding) as unknown as BridgeFetch,
      maxInflightParses: 1,
    });

    await win.fetch(TIMELINE_URL);
    await win.fetch(TIMELINE_URL);
    await flush();

    expect(clones).toBe(1);
    expect(bridge.state.skipped).toBe(1);
  });

  it('fetch 自身的异常原样透传（不吃掉、不改变错误）', async () => {
    const boom = new Error('network down');
    const { win } = install({
      fetchImpl: (async () => {
        throw boom;
      }) as unknown as BridgeFetch,
    });

    await expect(win.fetch(TIMELINE_URL)).rejects.toBe(boom);
  });

  it('clone 抛错只记内部计数：页面仍拿到原响应', async () => {
    const response = {
      type: 'basic',
      body: {},
      headers: new Headers({ 'content-type': 'application/json' }),
      clone: () => {
        throw new Error('clone failed');
      },
      url: TIMELINE_URL,
    } as unknown as Response;
    const { bridge, win } = install({
      fetchImpl: (async () => response) as unknown as BridgeFetch,
    });

    const returned = await win.fetch(TIMELINE_URL);
    await flush();

    expect(returned).toBe(response);
    expect(bridge.state.errors).toBe(1);
  });

  it('document.dispatchEvent 被页面冻结时也不影响 fetch 返回', async () => {
    const response = jsonResponse({});
    const frozenDocument = {
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => {
        throw new Error('frozen');
      },
    } as unknown as MainWorldBridgeDocument;
    const { bridge, win } = install({
      fetchImpl: (async () => response) as unknown as BridgeFetch,
      document: frozenDocument,
    });

    const returned = await win.fetch(TIMELINE_URL);
    await flush();

    expect(returned).toBe(response);
    expect(bridge.state.errors).toBeGreaterThan(0);
  });

  it('内容脚本启动后请求补发：最近几次结果会重放一次', async () => {
    const { win, target } = install();
    const details = collect(target, XHR_ITEMS_EVENT);

    await win.fetch(TIMELINE_URL);
    await flush();
    expect(details).toHaveLength(1);

    target.dispatchEvent(new CustomEvent(XHR_REPLAY_EVENT));
    expect(details).toHaveLength(2);
    expect(JSON.parse(details[1]!).replay).toBe(true);
  });

  it('预排期接口走 SCHEDULED_EVENT，且只 clone 一次', async () => {
    const response = jsonResponse({ data: { viewer: { scheduled_tweet_list: [] } } });
    const clone = vi.spyOn(response, 'clone');
    const { win, target } = install({
      fetchImpl: (async () => response) as unknown as BridgeFetch,
    });
    const scheduled = collect(target, SCHEDULED_EVENT);

    await win.fetch(SCHEDULED_URL);
    await flush();

    expect(clone).toHaveBeenCalledTimes(1);
    expect(scheduled).toHaveLength(1);
    expect((JSON.parse(scheduled[0]!) as { kind: string }).kind).toBe('list');
  });

  it('XHR：send 原样透传，load 时解析并派发；blob 响应跳过', async () => {
    const { XhrClass, target } = install();
    const details = collect(target, XHR_ITEMS_EVENT);

    const xhr = new XhrClass();
    xhr.responseURL = TIMELINE_URL;
    xhr.responseText = '{}';
    xhr.headers.set('content-type', 'application/json');
    xhr.send('{"variables":{}}');
    expect(xhr.sent).toEqual([['{"variables":{}}']]);

    xhr.dispatchEvent(new Event('load'));
    await flush();
    expect(details).toHaveLength(1);

    const blobXhr = new XhrClass();
    blobXhr.responseURL = TIMELINE_URL;
    blobXhr.responseType = 'blob';
    blobXhr.send();
    blobXhr.dispatchEvent(new Event('load'));
    await flush();
    expect(details).toHaveLength(1);
  });

  it('detach 还原原始 fetch / XHR.send，之后可重新安装', async () => {
    const fetchImpl = (async () => jsonResponse({})) as unknown as BridgeFetch;
    const XhrClass = createXhrClass();
    const originalSend = XhrClass.prototype.send;
    const { bridge, win, document } = install({ fetchImpl, XhrClass });

    expect(win.fetch).not.toBe(fetchImpl);
    expect(XhrClass.prototype.send).not.toBe(originalSend);

    bridge.detach();

    expect(win.fetch).toBe(fetchImpl);
    expect(XhrClass.prototype.send).toBe(originalSend);
    expect(win[BRIDGE_MARKER]).toBeUndefined();

    const reinstalled = installMainWorldBridge({ window: win, document });
    expect(reinstalled).not.toBe(bridge);
    expect(win.fetch).not.toBe(fetchImpl);
  });
});
