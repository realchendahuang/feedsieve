/**
 * 待拉黑列表（Phase 1 交付物：持久、可增删）。
 *
 * 只存 handle 与元信息，不执行任何拉黑；
 * 执行由 Phase 2/3 的 Action Adapter / Block Queue 接管。
 * chrome.storage.local 持久化：content script 重注入、浏览器重启后状态不丢。
 */

export interface PendingBlock {
  handle: string;
  addedAt: number;
  /** 记录来源标注，用于 Popup 里解释「这个号为什么在列表里」。 */
  markedReason: string;
}

const STORAGE_KEY = 'pendingBlocks';

export async function getPendingBlocks(): Promise<PendingBlock[]> {
  const result = await browser.storage.local.get(STORAGE_KEY);
  const value = result[STORAGE_KEY];
  return Array.isArray(value) ? (value as PendingBlock[]) : [];
}

export async function isPending(handle: string): Promise<boolean> {
  const normalized = normalize(handle);
  return (await getPendingBlocks()).some((b) => b.handle === normalized);
}

/** 勾选加入 / 取消移除。幂等。 */
export async function setPendingBlock(
  handle: string,
  on: boolean,
  markedReason = '',
): Promise<void> {
  const normalized = normalize(handle);
  if (!normalized) {
    return;
  }
  if (!on) {
    await removePendingBlock(normalized);
    return;
  }
  const blocks = await getPendingBlocks();
  if (blocks.some((b) => b.handle === normalized)) {
    return;
  }
  blocks.push({ handle: normalized, addedAt: Date.now(), markedReason });
  await browser.storage.local.set({ [STORAGE_KEY]: blocks });
}

export async function removePendingBlock(handle: string): Promise<void> {
  const normalized = normalize(handle);
  const remaining = (await getPendingBlocks()).filter((b) => b.handle !== normalized);
  await browser.storage.local.set({ [STORAGE_KEY]: remaining });
}

/** 订阅变化（popup 打开时实时刷新）。返回解绑函数。 */
export function subscribePending(
  onChange: (blocks: PendingBlock[]) => void,
): () => void {
  const listener = (
    changes: Record<string, { newValue?: unknown }>,
    areaName: string,
  ) => {
    if (areaName === 'local' && changes[STORAGE_KEY]) {
      void getPendingBlocks().then(onChange);
    }
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}

function normalize(handle: string): string {
  return handle.trim().replace(/^@+/, '').toLowerCase();
}
