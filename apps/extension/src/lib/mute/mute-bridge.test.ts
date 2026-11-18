// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  installMuteBridge,
  MUTE_TID_REQUEST_EVENT,
  MUTE_TID_RESULT_EVENT,
  type MuteBridgeWindow,
} from './mute-bridge';

function createMockRuntime(options: {
  cached?: Record<string, { exports?: Record<string, unknown> }>;
  factories?: Record<string, (mod: { exports: Record<string, unknown> }) => void>;
}) {
  const cache: Record<string, { exports?: Record<string, unknown> }> = { ...(options.cached ?? {}) };
  const factories = options.factories ?? {};
  const req = ((id: number | string) => {
    const key = String(id);
    if (cache[key]?.exports) return cache[key]!.exports;
    const fn = factories[key];
    if (!fn) throw new TypeError('missing webpack module');
    const mod = { exports: {} as Record<string, unknown> };
    fn(mod);
    cache[key] = mod;
    return mod.exports;
  }) as unknown as {
    (id: number | string): unknown;
    c: Record<string, { exports?: Record<string, unknown> }>;
    m: Record<string, (...args: unknown[]) => unknown>;
  };
  req.c = cache;
  req.m = factories as unknown as Record<string, (...args: unknown[]) => unknown>;

  const chunks: Array<[unknown, unknown, (r: unknown) => void]> = [];
  chunks.push = ((...items: Array<[unknown, unknown, (r: unknown) => void]>) => {
    for (const item of items) item[2]?.(req);
    return Array.prototype.push.apply(chunks, items);
  }) as typeof chunks.push;
  return { chunks, cache };
}

function sendBridgeRequest(doc: Document, id: string, path: string, method: string) {
  return new Promise<{ id: string; tid?: string; error?: string }>((resolve) => {
    const handler = (event: Event) => {
      const payload = JSON.parse((event as CustomEvent<string>).detail) as {
        id: string;
        tid?: string;
        error?: string;
      };
      if (payload.id !== id) return;
      doc.removeEventListener(MUTE_TID_RESULT_EVENT, handler);
      resolve(payload);
    };
    doc.addEventListener(MUTE_TID_RESULT_EVENT, handler);
    doc.dispatchEvent(
      new CustomEvent(MUTE_TID_REQUEST_EVENT, {
        bubbles: true,
        detail: JSON.stringify({ id, path, method }),
      }),
    );
  });
}

describe('mute-bridge (MAIN world transaction signer)', () => {
  it('resolves signer from req.c when already cached and blocks unsupported paths', async () => {
    const doc = document.implementation.createHTMLDocument('t1');
    const { chunks } = createMockRuntime({
      cached: {
        '265390': {
          exports: {
            _E: (host: string) => host.endsWith('x.com'),
            kc: async (_site: string, path: string, method: string) => `tid:${method}:${path}`,
          },
        },
      },
    });
    const win: MuteBridgeWindow = { webpackChunk_twitter_responsive_web: chunks };
    installMuteBridge({ window: win, document: doc, retryDelayMs: 5, maxRetries: 2 });

    const ok = await sendBridgeRequest(doc, 'r1', '/1.1/mutes/keywords/list.json', 'GET');
    expect(ok).toEqual({ id: 'r1', tid: 'tid:GET:/1.1/mutes/keywords/list.json' });

    const blocked = await sendBridgeRequest(doc, 'r2', '/1.1/statuses/update.json', 'POST');
    expect(blocked).toEqual({ id: 'r2', error: 'unsupported_path' });

    const wrongMethod = await sendBridgeRequest(doc, 'r3', '/1.1/mutes/keywords/list.json', 'POST');
    expect(wrongMethod).toEqual({ id: 'r3', error: 'unsupported_path' });
  });

  it('instantiates un-cached signer module from req.m even when export keys are mangled', async () => {
    const doc = document.implementation.createHTMLDocument('t2');
    const factory265390 = function (mod: { exports: Record<string, unknown> }) {
      const header = 'x-client-transaction-id';
      const flag = 'rweb_client_transaction_id_enabled';
      void header;
      void flag;
      mod.exports = {
        mangledHost: (h: string) => /^https:\/\/x\.com$/.test(h),
        mangledMiddleware: (flags: unknown) => () => flags,
        mangledSigner: async (site: string, path: string, method: string) =>
          `mangled:${site}:${method}:${path}`,
      };
    };
    const { chunks, cache } = createMockRuntime({
      factories: {
        '100001': (mod) => {
          mod.exports = { unrelated: true };
        },
        '265390': factory265390,
      },
    });
    expect(cache['265390']).toBeUndefined();

    const win: MuteBridgeWindow = { webpackChunk_twitter_responsive_web: chunks };
    installMuteBridge({ window: win, document: doc, retryDelayMs: 5, maxRetries: 2 });

    const res = await sendBridgeRequest(doc, 'm1', '/1.1/mutes/keywords/create.json', 'POST');
    expect(res).toEqual({
      id: 'm1',
      tid: 'mangled:https://x.com:POST:/1.1/mutes/keywords/create.json',
    });
    expect(cache['265390']).toBeDefined();
  });

  it('retries briefly during cold start before webpack runtime finishes mounting and rejects e: error tokens', async () => {
    const doc = document.implementation.createHTMLDocument('t3');
    const win: MuteBridgeWindow = {};
    installMuteBridge({ window: win, document: doc, retryDelayMs: 15, maxRetries: 6 });

    let failMode = false;
    setTimeout(() => {
      const { chunks } = createMockRuntime({
        cached: {
          '265390': {
            exports: {
              _E: (host: string) => host.includes('x.com'),
              kc: async () => (failMode ? btoa('e:TypeError') : btoa('ok-tid-token')),
            },
          },
        },
      });
      win.webpackChunk_twitter_responsive_web = chunks;
    }, 25);

    const coldOk = await sendBridgeRequest(doc, 'c1', '/1.1/mutes/keywords/list.json', 'GET');
    expect(coldOk).toEqual({ id: 'c1', tid: btoa('ok-tid-token') });

    failMode = true;
    const errToken = await sendBridgeRequest(doc, 'c2', '/1.1/mutes/keywords/destroy.json', 'POST');
    expect(errToken).toEqual({ id: 'c2', error: 'signer_failed' });
  });
});
