import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

/**
 * 弹窗里的长列表切到别的栏目会被整个卸载，回来时滚动位置和「已经加载了几页」都归零。
 * 这里把位置记进 storage.session（浏览器关闭即清空）：滚停后写一次，切走时再写一次。
 * 同一套位置按 pageKey 区分，换了筛选就不套用旧位置。
 */
const WRITE_MS = 500;
const MAX_COUNT = 10_000;

interface SavedPosition {
  key: string;
  top: number;
  count: number;
}

interface UseListPositionOptions {
  /** storage.session 里的键；每个视图一个，免得互相覆盖。 */
  storageKey: string;
  /** 当前列表对应的筛选组合；变了旧位置就不再适用。 */
  pageKey: string;
  /** 列表根元素，滚动容器是它最近的 `.popup-content`。 */
  rootRef: RefObject<HTMLElement | null>;
  /** 列表已经渲染出内容才恢复，否则列表不够长，scrollTop 会被截断。 */
  ready: boolean;
  /** 分页列表当前显示的条数；全量渲染的列表不传。 */
  count?: number;
  /** 恢复分页列表时把条数设回去。 */
  restoreCount?: (count: number) => void;
  /** 分页列表的最少条数；全量渲染的列表不传。 */
  minCount?: number;
}

/** storage.session 在部分环境（旧浏览器、测试）里没有。 */
function sessionStorageArea(): typeof browser.storage.local | null {
  return (browser.storage as { session?: typeof browser.storage.local }).session ?? null;
}

/** 读回上次存下的位置；坏数据（缺 key、非数字、负数）直接丢掉。 */
function readSaved(value: unknown, minCount: number): SavedPosition | null {
  if (!value || typeof value !== 'object') return null;
  const { key, top, count } = value as { key?: unknown; top?: unknown; count?: unknown };
  if (typeof key !== 'string') return null;
  if (typeof top !== 'number' || !Number.isFinite(top) || top < 0) return null;
  if (typeof count !== 'number' || !Number.isFinite(count) || count < minCount) return null;
  return { key, top, count: Math.min(MAX_COUNT, Math.floor(count)) };
}

export function useListPosition({
  storageKey,
  pageKey,
  rootRef,
  ready,
  count,
  restoreCount,
  minCount = 0,
}: UseListPositionOptions): void {
  const [saved, setSaved] = useState<SavedPosition | null>(null);
  const [restoreTop, setRestoreTop] = useState<number | null>(null);
  const applied = useRef<number | null>(null);
  // 滚动时记下的最新位置：切走时弹窗内容已经换掉，不能再从 DOM 读 scrollTop
  const lastTop = useRef(0);
  const current = useRef({ key: pageKey, count: count ?? 0 });

  useEffect(() => {
    current.current = { key: pageKey, count: count ?? 0 };
  }, [pageKey, count]);

  useEffect(() => {
    const session = sessionStorageArea();
    if (!session) return;
    void session
      .get(storageKey)
      .then((stored) => setSaved(readSaved(stored[storageKey], minCount)))
      .catch(() => undefined);
  }, [storageKey, minCount]);

  // 列表渲染出来、筛选也对得上：把条数和位置接上（派生状态，不借 effect）
  if (saved && ready && saved.key === pageKey) {
    setSaved(null);
    if (count !== undefined && restoreCount && saved.count >= minCount) restoreCount(saved.count);
    setRestoreTop(saved.top);
  }

  // 等恢复的条数渲染出来再滚
  useLayoutEffect(() => {
    if (restoreTop === null || !ready || applied.current === restoreTop) return;
    applied.current = restoreTop;
    const container = rootRef.current?.closest('.popup-content');
    if (container) {
      container.scrollTop = restoreTop;
      lastTop.current = container.scrollTop;
    }
  }, [restoreTop, ready, rootRef]);

  useEffect(() => {
    const container = rootRef.current?.closest('.popup-content');
    if (!container) return;
    let timer: number | undefined;
    const persist = (): void => {
      const session = sessionStorageArea();
      if (!session) return;
      const { key, count: savedCount } = current.current;
      void session
        .set({ [storageKey]: { key, top: lastTop.current, count: savedCount } })
        .catch(() => undefined);
    };
    const onScroll = (): void => {
      lastTop.current = container.scrollTop;
      window.clearTimeout(timer);
      timer = window.setTimeout(persist, WRITE_MS);
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.clearTimeout(timer);
      container.removeEventListener('scroll', onScroll);
      persist();
    };
  }, [storageKey, rootRef]);
}
