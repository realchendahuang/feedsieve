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
  return (result[STORAGE_KEY] as StoredUserIds | undefined)?.ids ?? {};
}

export async function getUserId(handle: string): Promise<string | undefined> {
  return (await getUserIds())[normalize(handle)];
}

/**
 * 批量写入并按容量上限裁剪最旧条目（Map 保序近似 LRU）。
 *
 * 重复出现的已知 id 不再为维持 LRU 顺序而重写整表：每个 GraphQL 响应都会带
 * 大量已见过的账号，按 sighting 重排等于滚动期间持续全量写 storage（序列化
 * 发生在渲染进程主线程）。代价是久见条目可能先于「最近看到」被裁剪——miss
 * 时 blockOne 会走 UserByScreenName 当场回填，属于可接受的软降级。
 */
export async function saveUserIds(
  entries: Array<{ handle: string; xUserId: string }>,
): Promise<void> {
  if (entries.length === 0) {
    return;
  }
  const ids = await getUserIds();
  let changed = false;
  for (const { handle, xUserId } of entries) {
    const normalized = normalize(handle);
    if (!normalized || !xUserId) {
      continue;
    }
    if (ids[normalized] === xUserId) {
      continue;
    }
    // 先删后插，新/变化的条目排在对象尾部
    delete ids[normalized];
    ids[normalized] = xUserId;
    changed = true;
  }
  if (!changed) {
    return;
  }
  const all = Object.entries(ids);
  const trimmed =
    all.length > MAX_ENTRIES ? Object.fromEntries(all.slice(all.length - MAX_ENTRIES)) : ids;
  await browser.storage.local.set({ [STORAGE_KEY]: { ids: trimmed } });
}

function normalize(handle: string): string {
  return handle.trim().replace(/^@+/, '').toLowerCase();
}
