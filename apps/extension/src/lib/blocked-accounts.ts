/**
 * 已拉黑账号记录（一键撤销 Unblock 的数据源）。
 *
 * 拉黑成功即记账（顺手拉黑 / 批量共用同一入口），popup 据此提供撤销入口。
 * 与待拉黑列表（pendingBlocks）严格互补：同一个 handle 不会同时出现在两边。
 * chrome.storage.local 持久化。
 */

export interface BlockedAccount {
  handle: string;
  xUserId?: string;
  blockedAt: number;
}

const STORAGE_KEY = 'blockedAccounts';

export async function getBlockedAccounts(): Promise<BlockedAccount[]> {
  const result = await browser.storage.local.get(STORAGE_KEY);
  const value = result[STORAGE_KEY];
  return Array.isArray(value) ? (value as BlockedAccount[]) : [];
}

/** 记账（幂等）：已存在则不动 blockedAt，保留首次拉黑时间。 */
export async function markBlocked(handle: string, xUserId?: string): Promise<void> {
  const normalized = normalize(handle);
  if (!normalized) {
    return;
  }
  const accounts = await getBlockedAccounts();
  const existing = accounts.find((a) => a.handle === normalized);
  if (existing) {
    if (!existing.xUserId && xUserId) {
      existing.xUserId = xUserId;
      await browser.storage.local.set({ [STORAGE_KEY]: accounts });
    }
    return;
  }
  accounts.push({
    handle: normalized,
    ...(xUserId ? { xUserId } : {}),
    blockedAt: Date.now(),
  });
  await browser.storage.local.set({ [STORAGE_KEY]: accounts });
}

/** 撤销成功后移除记录。幂等。 */
export async function removeBlockedAccount(handle: string): Promise<void> {
  const normalized = normalize(handle);
  const remaining = (await getBlockedAccounts()).filter((a) => a.handle !== normalized);
  await browser.storage.local.set({ [STORAGE_KEY]: remaining });
}

/** 订阅变化（popup 实时刷新）。返回解绑函数。 */
export function subscribeBlocked(
  onChange: (accounts: BlockedAccount[]) => void,
): () => void {
  const listener = (
    changes: Record<string, { newValue?: unknown }>,
    areaName: string,
  ) => {
    if (areaName === 'local' && changes[STORAGE_KEY]) {
      void getBlockedAccounts().then(onChange);
    }
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}

function normalize(handle: string): string {
  return handle.trim().replace(/^@+/, '').toLowerCase();
}