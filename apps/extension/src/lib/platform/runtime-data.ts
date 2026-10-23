/** Packaged data is read only by the extension worker, never fetched from X. */
export const RUNTIME_DATA_PATHS = [
  '/community/lists/official.json',
  '/community/keyword-packs/official.json',
  '/community/keyword-packs/variant-tables.json',
] as const;
type DataPath = (typeof RUNTIME_DATA_PATHS)[number];
export const RUNTIME_DATA_MESSAGE = 'feedsieve:runtime-data';
const inflight = new Map<DataPath, Promise<unknown>>();
let workerReader: ((path: DataPath) => Promise<unknown>) | undefined;

function cacheKey(path: DataPath): string {
  return `bundledData:${path}`;
}

/**
 * Extension version used to version the packaged-data cache.
 * `runtime.getManifest` is absent in partial runtime shims (preview harness,
 * page-world bridge, stubbed test runtimes); reading it unguarded turned every
 * packaged-data load into a TypeError and silently emptied the bundled list.
 * Fall back to a fixed tag: it still invalidates the cache across versions in
 * contexts that do expose the manifest, and keeps the data readable in those
 * that do not.
 */
function runtimeVersion(): string {
  try {
    return browser.runtime.getManifest?.().version ?? '0';
  } catch {
    return '0';
  }
}

/** Register synchronously on every SW startup, before any asynchronous work. */
export function registerRuntimeDataWorker(): void {
  workerReader = (path) => {
    const existing = inflight.get(path);
    if (existing) return existing;
    const pending = (async () => {
      const response = await fetch(browser.runtime.getURL(path), {
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`Packaged resource ${path}: HTTP ${response.status}`);
      const data: unknown = await response.json();
      // Separate from signed remote snapshots: never modifies synced_at or throttling.
      await browser.storage.local
        .set({
          [cacheKey(path)]: { version: runtimeVersion(), data },
        })
        .catch((error) => {
          // Quota/storage failures must not discard already readable packaged data.
          console.error('[FeedSieve] 随包缓存写入失败，使用本次后台读取结果:', error);
        });
      return data;
    })().finally(() => inflight.delete(path));
    inflight.set(path, pending);
    return pending;
  };
  browser.runtime.onMessage.addListener((message: unknown, sender) => {
    const msg = message as { type?: unknown; path?: unknown } | null;
    if (msg?.type !== RUNTIME_DATA_MESSAGE) return undefined;
    if (sender.id !== browser.runtime.id || !RUNTIME_DATA_PATHS.includes(msg.path as DataPath)) {
      return Promise.resolve({ ok: false, error: 'Invalid packaged resource request' });
    }
    return workerReader!(msg.path as DataPath).then(
      (data) => ({ ok: true, data }),
      (error: unknown) => ({ ok: false, error: String(error) }),
    );
  });
}

export async function loadRuntimeData(path: DataPath): Promise<unknown> {
  const key = cacheKey(path);
  const cached = await browser.storage.local.get(key).catch((error) => {
    console.error('[FeedSieve] 随包缓存读取失败，回退后台资源:', error);
    return {} as Record<string, unknown>;
  });
  const stored = cached[key] as { version?: string; data?: unknown } | undefined;
  if (stored?.version === runtimeVersion() && stored.data !== undefined) {
    return stored.data;
  }
  if (workerReader) return workerReader(path);
  // Messaging wakes a suspended MV3 worker. Bound hangs so independent loaders can recover.
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = (await Promise.race([
      browser.runtime.sendMessage({ type: RUNTIME_DATA_MESSAGE, path }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Packaged resource timeout: ${path}`)), 15_000);
      }),
    ])) as { ok?: boolean; data?: unknown; error?: string } | undefined;
    if (!response?.ok) throw new Error(response?.error ?? `Packaged resource unavailable: ${path}`);
    return response.data;
  } finally {
    clearTimeout(timer);
  }
}
