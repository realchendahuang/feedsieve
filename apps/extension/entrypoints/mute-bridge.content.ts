/**
 * X 原生静音词的 transaction id 生成桥（MAIN world）。
 *
 * X 的 `/i/api/1.1/mutes/keywords/*` 需要 `x-client-transaction-id`，这个值由
 * 页面自己的 webpack 签名模块按「路径 + 方法」生成。隔离世界拿不到页面 JS，
 * 所以这里只做一件事：收到固定路径的请求，调用 X 自己的 `kc()`，把结果交回去。
 *
 * 真正的 fetch 仍在隔离世界执行，且只允许 list/create/destroy 三个端点。
 * 不提供任意 URL 的签名能力，避免被页面脚本当成通用签名器。
 */
export default defineContentScript({
  matches: ['https://x.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    const REQUEST = 'feedsieve:mute-transaction-id';
    const RESULT = 'feedsieve:mute-transaction-id-result';
    const ALLOWED = new Map<string, 'GET' | 'POST'>([
      ['/1.1/mutes/keywords/list.json', 'GET'],
      ['/1.1/mutes/keywords/create.json', 'POST'],
      ['/1.1/mutes/keywords/destroy.json', 'POST'],
    ]);

    type Signer = (site: string, path: string, method: string) => Promise<string> | string;
    let runtimeRequire: ((id: number) => unknown) | null = null;
    let signer: Signer | null = null;

    function getRequire(): ((id: number) => unknown) | null {
      if (runtimeRequire) return runtimeRequire;
      try {
        const chunks = (
          window as unknown as {
            webpackChunk_twitter_responsive_web?: Array<[unknown, unknown, (req: unknown) => void]>;
          }
        ).webpackChunk_twitter_responsive_web;
        if (!Array.isArray(chunks)) return null;
        // push 会触发 X 自己的 webpack runtime 处理 chunk；runtime 冻结 / 改版时静默失败，
        // 隔离世界按超时处理（桥挂掉不能影响页面）。
        chunks.push([
          [Math.floor(Math.random() * 1e9)],
          {},
          (req) => {
            runtimeRequire = req as (id: number) => unknown;
          },
        ]);
        return runtimeRequire;
      } catch {
        return null;
      }
    }

    function getSigner(): Signer | null {
      if (signer) return signer;
      try {
        const req = getRequire();
        if (!req) return null;
        const modules = (
          req as unknown as { c?: Record<string, { exports?: Record<string, unknown> }> }
        ).c;
        const cached = Object.values(modules ?? {}).find((module) => {
          const exports = module?.exports;
          return typeof exports?.kc === 'function' && typeof exports?._E === 'function';
        });
        let fallback = cached?.exports;
        if (!fallback) {
          fallback = req(991160) as Record<string, unknown> | undefined;
        }
        const kc = fallback?.kc;
        if (typeof kc !== 'function') return null;
        signer = kc as Signer;
        return signer;
      } catch {
        // X 改了模块 id / runtime 不可用：返回不可用，隔离世界按错误处理
        return null;
      }
    }

    async function transactionId(path: string, method: string): Promise<string> {
      const kc = getSigner();
      if (!kc) throw new Error('signer_unavailable');
      const value = await kc('https://x.com', path, method);
      if (typeof value !== 'string' || !value) throw new Error('signer_failed');
      try {
        if (atob(value).startsWith('e:')) throw new Error('signer_failed');
      } catch (error) {
        if (error instanceof Error && error.message === 'signer_failed') throw error;
      }
      return value;
    }

    function respond(id: string, payload: Record<string, unknown>): void {
      try {
        document.dispatchEvent(
          new CustomEvent(RESULT, { bubbles: true, detail: JSON.stringify({ id, ...payload }) }),
        );
      } catch {
        // 页面冻结 CustomEvent 时静默；隔离世界会按超时处理
      }
    }

    if ((window as unknown as { __fsMuteBridge?: boolean }).__fsMuteBridge) return;
    (window as unknown as { __fsMuteBridge?: boolean }).__fsMuteBridge = true;

    try {
      document.addEventListener(REQUEST, (event) => {
        let detail: { id?: unknown; path?: unknown; method?: unknown };
        try {
          detail = JSON.parse((event as CustomEvent<string>).detail) as {
            id?: unknown;
            path?: unknown;
            method?: unknown;
          };
        } catch {
          return;
        }
        const id = typeof detail.id === 'string' ? detail.id : '';
        const path = typeof detail.path === 'string' ? detail.path : '';
        const method = typeof detail.method === 'string' ? detail.method.toUpperCase() : '';
        if (!id) return;
        if (ALLOWED.get(path) !== method) {
          respond(id, { error: 'unsupported_path' });
          return;
        }
        void transactionId(path, method)
          .then((tid) => respond(id, { tid }))
          .catch((error: unknown) => {
            respond(id, { error: error instanceof Error ? error.message : String(error) });
          });
      });
    } catch {
      // 页面冻结 document：桥静默失效，隔离世界按超时处理
    }
  },
});
