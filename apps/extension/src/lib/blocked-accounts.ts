/**
 * 已拉黑账号记录（一键撤销 Unblock 的数据源）。
 *
 * 拉黑成功即记账（顺手拉黑 / 一键拉黑共用同一入口），popup 据此提供撤销入口。
 * chrome.storage.local 持久化。
 */

export interface BlockedAccount {
  handle: string;
  xUserId?: string;
  blockedAt: number;
  /** 这次拉黑是怎么发生的；用于防止云端名单自我放大。 */
  origin?: BlockOrigin;
  /** false 表示只记本地 Block，不作为新的社区举报票。 */
  communityVote?: boolean;
  /** 云端/页面批次 ID，用于定向回滚。 */
  batchId?: string;
  /** 拉黑时的检测证据；旧记录没有这些字段，历史同步时按 other 处理。 */
  category?: string;
  contentFingerprint?: string;
  linkDomains?: string[];
}

export type BlockOrigin =
  'manual-spam' | 'manual-personal' | 'single-detection' | 'page-batch' | 'community-batch';

export interface BlockedAccountEvidence {
  category: string;
  contentFingerprint?: string;
  linkDomains?: string[];
  origin?: BlockOrigin;
  communityVote?: boolean;
  batchId?: string;
}

const STORAGE_KEY = 'blockedAccounts';

export async function getBlockedAccounts(): Promise<BlockedAccount[]> {
  const result = await browser.storage.local.get(STORAGE_KEY);
  const value = result[STORAGE_KEY];
  return Array.isArray(value) ? (value as BlockedAccount[]) : [];
}

/** 记账（幂等）：已存在则不动 blockedAt，保留首次拉黑时间。 */
export async function markBlocked(
  handle: string,
  xUserId?: string,
  evidence?: BlockedAccountEvidence,
): Promise<void> {
  const normalized = normalize(handle);
  if (!normalized) {
    return;
  }
  const accounts = await getBlockedAccounts();
  const existing = accounts.find((a) => a.handle === normalized);
  if (existing) {
    let changed = false;
    if (!existing.xUserId && xUserId) {
      existing.xUserId = xUserId;
      changed = true;
    }
    if (evidence) {
      existing.category = evidence.category;
      existing.contentFingerprint = evidence.contentFingerprint;
      existing.linkDomains = evidence.linkDomains;
      existing.origin = evidence.origin ?? existing.origin;
      existing.communityVote = evidence.communityVote ?? existing.communityVote;
      existing.batchId = evidence.batchId ?? existing.batchId;
      changed = true;
    }
    if (changed) {
      await browser.storage.local.set({ [STORAGE_KEY]: accounts });
    }
    return;
  }
  accounts.push({
    handle: normalized,
    ...(xUserId ? { xUserId } : {}),
    ...(evidence?.category ? { category: evidence.category } : {}),
    ...(evidence?.contentFingerprint ? { contentFingerprint: evidence.contentFingerprint } : {}),
    ...(evidence?.linkDomains?.length ? { linkDomains: evidence.linkDomains } : {}),
    ...(evidence?.origin ? { origin: evidence.origin } : {}),
    ...(typeof evidence?.communityVote === 'boolean'
      ? { communityVote: evidence.communityVote }
      : {}),
    ...(evidence?.batchId ? { batchId: evidence.batchId } : {}),
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
export function subscribeBlocked(onChange: (accounts: BlockedAccount[]) => void): () => void {
  const listener = (changes: Record<string, { newValue?: unknown }>, areaName: string) => {
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
