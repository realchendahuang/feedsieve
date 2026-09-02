/**
 * 扩展运行时的持久化拉黑队列。
 *
 * 真实 X Block 由 content script 执行；此模块只存状态，使 popup 关闭、
 * content script 热重载或浏览器重启后仍能看到进度并显式恢复。
 */

export type PersistentBlockQueueSource = 'page-batch' | 'community-batch';
export type PersistentBlockQueueStatus = 'running' | 'paused' | 'completed' | 'cancelled';
export type PersistentBlockTaskStatus = 'pending' | 'running' | 'success' | 'failed' | 'cancelled';

export interface PersistentBlockTask {
  handle: string;
  xUserId?: string;
  category: string;
  status: PersistentBlockTaskStatus;
  failureCode?: string;
}

export interface PersistentBlockQueueState {
  id: string;
  source: PersistentBlockQueueSource;
  status: PersistentBlockQueueStatus;
  tasks: PersistentBlockTask[];
  createdAt: number;
  updatedAt: number;
}

const STORAGE_KEY = 'persistentBlockQueueV1';

function normalizeHandle(handle: string): string {
  return handle.trim().replace(/^@+/, '').toLowerCase();
}

function normalizeQueue(value: unknown): PersistentBlockQueueState | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<PersistentBlockQueueState>;
  if (
    typeof raw.id !== 'string' ||
    (raw.source !== 'page-batch' && raw.source !== 'community-batch') ||
    !['running', 'paused', 'completed', 'cancelled'].includes(String(raw.status)) ||
    !Array.isArray(raw.tasks)
  ) {
    return null;
  }
  const tasks: PersistentBlockTask[] = [];
  for (const item of raw.tasks) {
    if (!item || typeof item !== 'object') continue;
    const task = item as Partial<PersistentBlockTask>;
    const handle = normalizeHandle(String(task.handle ?? ''));
    if (!handle || typeof task.category !== 'string') continue;
    const status = ['pending', 'running', 'success', 'failed', 'cancelled'].includes(
      String(task.status),
    )
      ? (task.status as PersistentBlockTaskStatus)
      : 'pending';
    tasks.push({
      handle,
      category: task.category,
      status,
      ...(typeof task.xUserId === 'string' ? { xUserId: task.xUserId } : {}),
      ...(typeof task.failureCode === 'string' ? { failureCode: task.failureCode } : {}),
    });
  }
  return {
    id: raw.id,
    source: raw.source,
    status: raw.status as PersistentBlockQueueStatus,
    tasks,
    createdAt: Number(raw.createdAt) || Date.now(),
    updatedAt: Number(raw.updatedAt) || Date.now(),
  };
}

export async function getPersistentBlockQueue(): Promise<PersistentBlockQueueState | null> {
  const result = await browser.storage.local.get(STORAGE_KEY);
  return normalizeQueue(result[STORAGE_KEY]);
}

export async function setPersistentBlockQueue(state: PersistentBlockQueueState): Promise<void> {
  await browser.storage.local.set({
    [STORAGE_KEY]: { ...state, updatedAt: Date.now() },
  });
}

export async function createPersistentBlockQueue(
  source: PersistentBlockQueueSource,
  items: ReadonlyArray<{ handle: string; xUserId?: string; category: string }>,
): Promise<PersistentBlockQueueState> {
  const byHandle = new Map<string, PersistentBlockTask>();
  for (const item of items) {
    const handle = normalizeHandle(item.handle);
    if (!handle || byHandle.has(handle)) continue;
    byHandle.set(handle, {
      handle,
      ...(item.xUserId ? { xUserId: item.xUserId } : {}),
      category: item.category,
      status: 'pending',
    });
  }
  const now = Date.now();
  const state: PersistentBlockQueueState = {
    id: crypto.randomUUID(),
    source,
    status: 'running',
    tasks: [...byHandle.values()],
    createdAt: now,
    updatedAt: now,
  };
  await setPersistentBlockQueue(state);
  return state;
}

export function subscribePersistentBlockQueue(
  onChange: (state: PersistentBlockQueueState | null) => void,
): () => void {
  const listener = (changes: Record<string, unknown>, areaName: string) => {
    if (areaName === 'local' && changes[STORAGE_KEY]) {
      void getPersistentBlockQueue().then(onChange);
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

export function blockQueueProgress(state: PersistentBlockQueueState | null): {
  total: number;
  success: number;
  failed: number;
  pending: number;
} {
  if (!state) return { total: 0, success: 0, failed: 0, pending: 0 };
  return {
    total: state.tasks.length,
    success: state.tasks.filter((task) => task.status === 'success').length,
    failed: state.tasks.filter((task) => task.status === 'failed').length,
    pending: state.tasks.filter((task) => task.status === 'pending' || task.status === 'running')
      .length,
  };
}
