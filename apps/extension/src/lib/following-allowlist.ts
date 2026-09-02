/**
 * 用户自己的 X 关注保护名单。
 *
 * 这不是社区「抢救票」，只表示「这是我选择关注的人」。
 * 所有数据只存在 browser.storage.local，绝不进入 contribute.ts 的上传链路。
 */

export interface FollowingAllowlistItem {
  handle: string;
  xUserId?: string;
  protectedAt: number;
  source: 'observed' | 'full-sync';
}

export interface FollowingSyncState {
  status: 'idle' | 'waiting' | 'running' | 'complete' | 'error';
  collected: number;
  startedAt?: number;
  updatedAt: number;
  error?: string;
}

const STORAGE_KEY = 'followingAllowlistV1';
const SYNC_STATE_KEY = 'followingAllowlistSyncStateV1';
const SYNC_DRAFT_KEY = 'followingAllowlistSyncDraftV1';
const SELF_HANDLE_KEY = 'xSelfHandleV1';

function normalize(handle: string): string {
  return handle.trim().replace(/^@+/, '').toLowerCase();
}

function normalizeItems(items: readonly FollowingAllowlistItem[]): FollowingAllowlistItem[] {
  const byHandle = new Map<string, FollowingAllowlistItem>();
  for (const item of items) {
    const handle = normalize(item.handle);
    if (!handle) continue;
    const existing = byHandle.get(handle);
    byHandle.set(handle, {
      handle,
      ...(item.xUserId || existing?.xUserId ? { xUserId: item.xUserId ?? existing?.xUserId } : {}),
      protectedAt: Math.min(existing?.protectedAt ?? item.protectedAt, item.protectedAt),
      source:
        item.source === 'full-sync' || existing?.source === 'full-sync' ? 'full-sync' : 'observed',
    });
  }
  return [...byHandle.values()].sort((a, b) => a.handle.localeCompare(b.handle));
}

export async function getFollowingAllowlist(): Promise<FollowingAllowlistItem[]> {
  const result = await browser.storage.local.get(STORAGE_KEY);
  const value = result[STORAGE_KEY];
  if (!Array.isArray(value)) return [];
  return normalizeItems(
    value.filter(
      (item): item is FollowingAllowlistItem =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as FollowingAllowlistItem).handle === 'string' &&
        typeof (item as FollowingAllowlistItem).protectedAt === 'number' &&
        ((item as FollowingAllowlistItem).source === 'observed' ||
          (item as FollowingAllowlistItem).source === 'full-sync'),
    ),
  );
}

/** 时间线观察到 following=true 时增量保护；幂等、不删除其他记录。 */
export async function upsertFollowingAccounts(
  items: ReadonlyArray<{ handle: string; xUserId?: string }>,
  source: FollowingAllowlistItem['source'] = 'observed',
): Promise<FollowingAllowlistItem[]> {
  if (items.length === 0) return getFollowingAllowlist();
  const now = Date.now();
  const current = await getFollowingAllowlist();
  const next = normalizeItems([
    ...current,
    ...items.map((item) => ({ ...item, protectedAt: now, source })),
  ]);
  await browser.storage.local.set({ [STORAGE_KEY]: next });
  return next;
}

/** 只在全量同步完整成功后调用，原子替换上一版关注保护。 */
export async function replaceFollowingAccounts(
  items: ReadonlyArray<{ handle: string; xUserId?: string }>,
): Promise<FollowingAllowlistItem[]> {
  const now = Date.now();
  const next = normalizeItems(
    items.map((item) => ({ ...item, protectedAt: now, source: 'full-sync' as const })),
  );
  await browser.storage.local.set({ [STORAGE_KEY]: next });
  return next;
}

export async function removeFollowingAccount(handle: string): Promise<void> {
  const target = normalize(handle);
  const remaining = (await getFollowingAllowlist()).filter((item) => item.handle !== target);
  await browser.storage.local.set({ [STORAGE_KEY]: remaining });
}

export function subscribeFollowingAllowlist(
  onChange: (items: FollowingAllowlistItem[]) => void,
): () => void {
  const listener = (changes: Record<string, unknown>, areaName: string) => {
    if (areaName === 'local' && changes[STORAGE_KEY]) {
      void getFollowingAllowlist().then(onChange);
    }
  };
  browser.storage.onChanged.addListener(
    listener as Parameters<typeof browser.storage.onChanged.addListener>[0],
  );
  return () =>
    browser.storage.onChanged.removeListener(
      listener as Parameters<typeof browser.storage.onChanged.removeListener>[0],
    );
}

export async function getFollowingSyncState(): Promise<FollowingSyncState> {
  const result = await browser.storage.local.get(SYNC_STATE_KEY);
  const value = result[SYNC_STATE_KEY] as Partial<FollowingSyncState> | undefined;
  if (!value || typeof value !== 'object') {
    return { status: 'idle', collected: 0, updatedAt: 0 };
  }
  const status = ['idle', 'waiting', 'running', 'complete', 'error'].includes(String(value.status))
    ? (value.status as FollowingSyncState['status'])
    : 'idle';
  return {
    status,
    collected: Number(value.collected) || 0,
    updatedAt: Number(value.updatedAt) || 0,
    ...(typeof value.startedAt === 'number' ? { startedAt: value.startedAt } : {}),
    ...(typeof value.error === 'string' ? { error: value.error } : {}),
  };
}

export async function setFollowingSyncState(state: FollowingSyncState): Promise<void> {
  await browser.storage.local.set({ [SYNC_STATE_KEY]: state });
}

export function subscribeFollowingSyncState(
  onChange: (state: FollowingSyncState) => void,
): () => void {
  const listener = (changes: Record<string, unknown>, areaName: string) => {
    if (areaName === 'local' && changes[SYNC_STATE_KEY]) {
      void getFollowingSyncState().then(onChange);
    }
  };
  browser.storage.onChanged.addListener(
    listener as Parameters<typeof browser.storage.onChanged.addListener>[0],
  );
  return () =>
    browser.storage.onChanged.removeListener(
      listener as Parameters<typeof browser.storage.onChanged.removeListener>[0],
    );
}

export async function getFollowingSyncDraft(): Promise<
  Array<{ handle: string; xUserId?: string }>
> {
  const result = await browser.storage.local.get(SYNC_DRAFT_KEY);
  const value = result[SYNC_DRAFT_KEY];
  if (!Array.isArray(value)) return [];
  const byHandle = new Map<string, { handle: string; xUserId?: string }>();
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const handle = normalize(String((raw as { handle?: unknown }).handle ?? ''));
    if (!handle) continue;
    const xUserId = (raw as { xUserId?: unknown }).xUserId;
    byHandle.set(handle, {
      handle,
      ...(typeof xUserId === 'string' && xUserId ? { xUserId } : {}),
    });
  }
  return [...byHandle.values()];
}

export async function setFollowingSyncDraft(
  items: ReadonlyArray<{ handle: string; xUserId?: string }>,
): Promise<void> {
  const byHandle = new Map<string, { handle: string; xUserId?: string }>();
  for (const item of items) {
    const handle = normalize(item.handle);
    if (!handle) continue;
    const previous = byHandle.get(handle);
    byHandle.set(handle, {
      handle,
      ...(item.xUserId || previous?.xUserId ? { xUserId: item.xUserId ?? previous?.xUserId } : {}),
    });
  }
  await browser.storage.local.set({ [SYNC_DRAFT_KEY]: [...byHandle.values()] });
}

export async function clearFollowingSyncDraft(): Promise<void> {
  await browser.storage.local.set({ [SYNC_DRAFT_KEY]: [] });
}

export async function getSelfHandle(): Promise<string | null> {
  const result = await browser.storage.local.get(SELF_HANDLE_KEY);
  const value = result[SELF_HANDLE_KEY];
  return typeof value === 'string' && normalize(value) ? normalize(value) : null;
}

export async function setSelfHandle(handle: string): Promise<void> {
  const normalized = normalize(handle);
  if (normalized) await browser.storage.local.set({ [SELF_HANDLE_KEY]: normalized });
}
