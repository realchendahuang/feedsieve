/**
 * 内容脚本按需加载 ESM 懒加载块（由 WXT 打包在 chunks/lazy-*.js）。
 * 同名文件全局只发起一次 dynamic import，失败时不缓存以便后续重试。
 */
const pendingModules = new Map<string, Promise<unknown>>();

export function loadLazyModule<T>(chunkFileName: string): Promise<T> {
  const existing = pendingModules.get(chunkFileName);
  if (existing) return existing as Promise<T>;
  const url = browser.runtime.getURL(`/chunks/${chunkFileName}` as never);
  const promise = import(/* @vite-ignore */ url)
    .then((mod) => (mod as { default: T }).default)
    .catch((error) => {
      pendingModules.delete(chunkFileName);
      throw error;
    });
  pendingModules.set(chunkFileName, promise);
  return promise;
}
