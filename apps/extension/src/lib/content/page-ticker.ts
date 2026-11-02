/**
 * 页面里所有「每秒看一次」的模块共用同一只定时器。
 *
 * 之前各模块各自 `setInterval(…, 1_000)`：地址轮询、AI 味的面板巡检、主页洞察、
 * 文章编辑器挂载检测，一个标签页上就有四只，加上队列心跳是五只。单只都很便宜，
 * 但它们每秒各唤醒一次主线程、各查一遍 DOM；标签页开着不动也在付这笔钱。
 *
 * 页面隐藏时整个停掉：Chrome 本来就会把后台标签的定时器压到 1 分钟一次，这里
 * 干脆不发请求也不查 DOM，切回来立即补跑一次（不攒积压）。
 */

export const PAGE_TICK_MS = 1_000;

export interface PageTickerDeps {
  /** 测试替身；默认当前页面的 document。 */
  document?: Document;
  setInterval?: (fn: () => void, ms: number) => number;
  clearInterval?: (handle: number) => void;
  addEventListener?: (type: 'visibilitychange', fn: () => void) => void;
  removeEventListener?: (type: 'visibilitychange', fn: () => void) => void;
}

export interface PageTicker {
  /** 注册巡检回调，返回取消函数。 */
  add(listener: () => void): () => void;
  start(): void;
  stop(): void;
  /** 当前是否在跑（隐藏页面为 false）。 */
  isRunning(): boolean;
}

export function createPageTicker(deps: PageTickerDeps = {}): PageTicker {
  const doc = deps.document ?? document;
  const set =
    deps.setInterval ??
    ((fn: () => void, ms: number) => globalThis.setInterval(fn, ms) as unknown as number);
  const clear = deps.clearInterval ?? ((handle: number) => globalThis.clearInterval(handle));
  const listen =
    deps.addEventListener ?? ((type: 'visibilitychange', fn: () => void) => doc.addEventListener(type, fn));
  const unlisten =
    deps.removeEventListener ??
    ((type: 'visibilitychange', fn: () => void) => doc.removeEventListener(type, fn));

  const listeners = new Set<() => void>();
  let timer: number | null = null;
  let started = false;

  const visible = (): boolean => doc.visibilityState !== 'hidden';

  function beat(): void {
    // 可见性事件丢了也不在隐藏页里干活
    if (!visible()) return;
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // 单个模块出错不影响其它模块的巡检
      }
    }
  }

  function pause(): void {
    if (timer === null) return;
    clear(timer);
    timer = null;
  }

  function resume(): void {
    if (!started || timer !== null) return;
    beat();
    timer = set(beat, PAGE_TICK_MS);
  }

  const onVisibility = (): void => {
    if (visible()) resume();
    else pause();
  };

  return {
    add(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start() {
      if (started) return;
      started = true;
      listen('visibilitychange', onVisibility);
      resume();
    },
    stop() {
      started = false;
      pause();
      unlisten('visibilitychange', onVisibility);
    },
    isRunning: () => timer !== null,
  };
}
