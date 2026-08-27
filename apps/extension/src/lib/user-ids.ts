/**
 * handle -> x_user_id 映射（Phase 2 的关键拼图）。
 *
 * 拉黑 API 需要 rest_id；DOM 只能给 handle。
 * 数据来源：XHR 桥解析的 GraphQL 响应（x-adapter/api/parse）。
 * chrome.storage.local 持久化，容量上限由 LRU 策略控制。
 */

export interface StoredUserIds {
  /** handle（小写无 @）-> x_user_id */
  ids: Record<string, string>;
}

const STORAGE_KEY = 'userIds';
const MAX_ENTRIES = 5000;

export async function getUserIds(): Promise<Record<string, string>> {
  const result = await browser.storage.local.get(STORAGE_KEY);
  return ((result[STORAGE_KEY] as StoredUserIds | undefined)?.ids) ?? {};
}

export async function getUserId(handle: string): Promise<string | undefined> {
  return (await getUserIds())[normalize(handle)];
}

/** 批量写入并按容量上限裁剪最旧条目（Map 保序近似 LRU）。 */
export async function saveUserIds(
  entries: Array<{ handle: string; xUserId: string }>,
): Promise<void> {
  if (entries.length === 0) {
    return;
  }
  const ids = await getUserIds();
  for (const { handle, xUserId } of entries) {
    const normalized = normalize(handle);
    if (normalized && xUserId) {
      // 先删后插，保持「最近看到」在对象尾部
      delete ids[normalized];
      ids[normalized] = xUserId;
    }
  }
  const all = Object.entries(ids);
  const trimmed =
    all.length > MAX_ENTRIES ? Object.fromEntries(all.slice(all.length - MAX_ENTRIES)) : ids;
  await browser.storage.local.set({ [STORAGE_KEY]: { ids: trimmed } });
}

function normalize(handle: string): string {
  return handle.trim().replace(/^@+/, '').toLowerCase();
}
