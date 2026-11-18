/**
 * X 原生静音词的 transaction id 生成桥实现（供 MAIN world 入口挂载与单测共用）。
 *
 * 安全边界：
 * - 只允许 list / create / destroy 三个固定路径与方法组合，不暴露通用签名能力；
 * - 优先从 webpack 已缓存模块（req.c）定位签名器；冷启动尚未缓存时按不可混淆的
 *   头字段常量在模块工厂表（req.m）中按需加载，不再依赖随发版漂移的硬编码模块号；
 * - 导出键名若被压缩器改写，按同模块的 host 校验函数特征 + 唯一三参签名函数兜底；
 * - 所有异常全部吞在桥内部，绝不抛向宿主页面。
 */

export const MUTE_TID_REQUEST_EVENT = 'feedsieve:mute-transaction-id';
export const MUTE_TID_RESULT_EVENT = 'feedsieve:mute-transaction-id-result';

const ALLOWED = new Map<string, 'GET' | 'POST'>([
  ['/1.1/mutes/keywords/list.json', 'GET'],
  ['/1.1/mutes/keywords/create.json', 'POST'],
  ['/1.1/mutes/keywords/destroy.json', 'POST'],
]);

type Signer = (site: string, path: string, method: string) => Promise<string> | string;

interface WebpackRequire {
  (id: number | string): unknown;
  c?: Record<string, { exports?: Record<string, unknown> }>;
  m?: Record<string, (...args: unknown[]) => unknown>;
}

export interface MuteBridgeWindow {
  __fsMuteBridge?: boolean;
  webpackChunk_twitter_responsive_web?: Array<[unknown, unknown, (req: unknown) => void]>;
}

const COLD_START_RETRIES = 8;
const COLD_START_RETRY_MS = 250;

function isHostValidator(fn: unknown): boolean {
  if (typeof fn !== 'function' || fn.length !== 1) return false;
  try {
    return (
      (fn as (host: string) => unknown)('https://x.com') === true &&
      (fn as (host: string) => unknown)('https://example.invalid') === false
    );
  } catch {
    return false;
  }
}

export function signerFromExports(exports: Record<string, unknown> | undefined): Signer | null {
  if (!exports || typeof exports !== 'object') return null;
  if (typeof exports.kc === 'function' && typeof exports._E === 'function') {
    return exports.kc as Signer;
  }
  const fns = Object.values(exports).filter(
    (value): value is (...args: unknown[]) => unknown => typeof value === 'function',
  );
  if (!fns.some(isHostValidator)) return null;
  const threeArgFns = fns.filter((fn) => fn.length === 3);
  return threeArgFns.length === 1 ? (threeArgFns[0] as unknown as Signer) : null;
}

function isTransactionFactory(factory: unknown): boolean {
  if (typeof factory !== 'function') return false;
  try {
    const source = Function.prototype.toString.call(factory);
    return (
      source.includes('x-client-transaction-id') &&
      source.includes('rweb_client_transaction_id_enabled')
    );
  } catch {
    return false;
  }
}

export interface InstallMuteBridgeOptions {
  window: MuteBridgeWindow;
  document: Document;
  retryDelayMs?: number;
  maxRetries?: number;
}

export function installMuteBridge(options: InstallMuteBridgeOptions): void {
  const {
    window: win,
    document: doc,
    retryDelayMs = COLD_START_RETRY_MS,
    maxRetries = COLD_START_RETRIES,
  } = options;

  if (win.__fsMuteBridge) return;
  win.__fsMuteBridge = true;

  let runtimeRequire: WebpackRequire | null = null;
  let signer: Signer | null = null;

  function getRequire(): WebpackRequire | null {
    if (runtimeRequire) return runtimeRequire;
    try {
      const chunks = win.webpackChunk_twitter_responsive_web;
      if (!Array.isArray(chunks)) return null;
      chunks.push([
        [Math.floor(Math.random() * 1e9)],
        {},
        (req) => {
          runtimeRequire = req as WebpackRequire;
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
      for (const mod of Object.values(req.c ?? {})) {
        const hit = signerFromExports(mod?.exports);
        if (hit) {
          signer = hit;
          return signer;
        }
      }
      for (const [rawId, factory] of Object.entries(req.m ?? {})) {
        if (!isTransactionFactory(factory)) continue;
        const numericId = Number(rawId);
        const loaded = req(Number.isNaN(numericId) ? rawId : numericId) as
          | Record<string, unknown>
          | undefined;
        const hit = signerFromExports(loaded);
        if (hit) {
          signer = hit;
          return signer;
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  async function resolveSignerWithRetry(): Promise<Signer | null> {
    const immediate = getSigner();
    if (immediate) return immediate;
    for (let attempt = 0; attempt < maxRetries; attempt += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, retryDelayMs));
      const next = getSigner();
      if (next) return next;
    }
    return null;
  }

  async function transactionId(path: string, method: string): Promise<string> {
    const kc = await resolveSignerWithRetry();
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
      doc.dispatchEvent(
        new CustomEvent(MUTE_TID_RESULT_EVENT, {
          bubbles: true,
          detail: JSON.stringify({ id, ...payload }),
        }),
      );
    } catch {
      // 页面冻结 CustomEvent 时静默；隔离世界会按超时处理
    }
  }

  try {
    doc.addEventListener(MUTE_TID_REQUEST_EVENT, (event) => {
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
}
