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
  reason?: string;
  evidence?: {
    contentFingerprint?: string;
    linkDomains?: string[];
  };
  /** Whether a successful local block should be contributed to the community. */
  communityVote?: boolean;
  status: PersistentBlockTaskStatus;
  /** popup 展示用失败码（failed 任务）；retryable failed 会由 runner 保持 pending + lastErrorCode */
  failureCode?: string;
  /** 自跑起累计执行次数（runner 失败分类用） */
  attempts?: number;
  /** 最近一次失败码（runner 写入；failed 时 normalized 到 failureCode 供 UI 展示） */
  lastErrorCode?: string;
  lastHttpStatus?: number;
  lastLatencyMs?: number;
  /** transient 重试的唤醒时刻（Unix ms）；resume 时清除立即重试 */
  retryAt?: number;
  /** 429 Retry-After（秒→毫秒），退避节奏尊重它 */
  retryAfterMs?: number;
}

export interface PersistentBlockQueueState {
  id: string;
  source: PersistentBlockQueueSource;
  /** Tab selected when the queue was created; used for routing and recovery UI. */
  targetTabId?: number;
  status: PersistentBlockQueueStatus;
  tasks: PersistentBlockTask[];
  /** 最近一次暂停原因（quota_exhausted / auth_required / user …），popup 按它给专属文案 */
  pauseReason?: string;
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
      ...(typeof task.reason === 'string' ? { reason: task.reason } : {}),
      ...(task.evidence && typeof task.evidence === 'object'
        ? {
            evidence: {
              ...(typeof task.evidence.contentFingerprint === 'string'
                ? { contentFingerprint: task.evidence.contentFingerprint }
                : {}),
              ...(Array.isArray(task.evidence.linkDomains)
                ? {
                    linkDomains: task.evidence.linkDomains.filter(
                      (domain): domain is string => typeof domain === 'string',
                    ),
                  }
                : {}),
            },
          }
        : {}),
      ...(typeof task.communityVote === 'boolean' ? { communityVote: task.communityVote } : {}),
      ...(typeof task.xUserId === 'string' ? { xUserId: task.xUserId } : {}),
      // UI 继续读 failureCode；runner 写入 lastErrorCode，failed 任务归一化补一份
      ...(task.status === 'failed' && typeof task.lastErrorCode === 'string'
        ? { failureCode: task.lastErrorCode }
        : typeof task.failureCode === 'string'
          ? { failureCode: task.failureCode }
          : {}),
      ...(typeof task.attempts === 'number' ? { attempts: task.attempts } : {}),
      ...(typeof task.lastErrorCode === 'string' ? { lastErrorCode: task.lastErrorCode } : {}),
      ...(typeof task.lastHttpStatus === 'number' ? { lastHttpStatus: task.lastHttpStatus } : {}),
      ...(typeof task.lastLatencyMs === 'number' ? { lastLatencyMs: task.lastLatencyMs } : {}),
      ...(typeof task.retryAt === 'number' ? { retryAt: task.retryAt } : {}),
      ...(typeof task.retryAfterMs === 'number' ? { retryAfterMs: task.retryAfterMs } : {}),
    });
  }
  return {
    id: raw.id,
    source: raw.source,
    ...(typeof raw.targetTabId === 'number' ? { targetTabId: raw.targetTabId } : {}),
    status: raw.status as PersistentBlockQueueStatus,
    tasks,
    ...(typeof raw.pauseReason === 'string' ? { pauseReason: raw.pauseReason } : {}),
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
  items: ReadonlyArray<{
    handle: string;
    xUserId?: string;
    category: string;
    reason?: string;
    evidence?: PersistentBlockTask['evidence'];
    communityVote?: boolean;
  }>,
  options: { targetTabId?: number } = {},
): Promise<PersistentBlockQueueState> {
  const byHandle = new Map<string, PersistentBlockTask>();
  for (const item of items) {
    const handle = normalizeHandle(item.handle);
    if (!handle || byHandle.has(handle)) continue;
    byHandle.set(handle, {
      handle,
      ...(item.xUserId ? { xUserId: item.xUserId } : {}),
      category: item.category,
      ...(item.reason ? { reason: item.reason } : {}),
      ...(item.evidence ? { evidence: item.evidence } : {}),
      ...(typeof item.communityVote === 'boolean' ? { communityVote: item.communityVote } : {}),
      status: 'pending',
    });
  }
  const now = Date.now();
  const state: PersistentBlockQueueState = {
    id: crypto.randomUUID(),
    source,
    ...(typeof options.targetTabId === 'number' ? { targetTabId: options.targetTabId } : {}),
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
