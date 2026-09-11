/**
 * 扩展运行时的持久化拉黑队列。
 *
 * 真实 X Block 由 content script 执行；此模块只存状态，使 popup 关闭、
 * content script 热重载或浏览器重启后仍能看到进度并显式恢复。
 */

import { normalizeStrictHandle, sanitizeXUserId } from '../platform/xhr-bridge-guard';

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
  /** 用户对「额度用尽」暂停点了「仍要继续」：本轮队列不再因额度硬停（友情提醒模式，新队列重置） */
  quotaOverride?: boolean;
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
    const xUserId = sanitizeXUserId(task.xUserId);
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
      // 存储态里的 id 同样过严格形态校验：入队/反序列化双闸（见 sanitizeQueueItem）
      ...(xUserId ? { xUserId } : {}),
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
    ...(raw.quotaOverride === true ? { quotaOverride: true } : {}),
    createdAt: Number(raw.createdAt) || Date.now(),
    updatedAt: Number(raw.updatedAt) || Date.now(),
  };
}

export async function getPersistentBlockQueue(): Promise<PersistentBlockQueueState | null> {
  const result = await browser.storage.local.get(STORAGE_KEY);
  return normalizeQueue(result[STORAGE_KEY]);
}

/**
 * 消息通道入队前的最小形态校验（review F1/F6）：消息可由其它扩展上下文发出，
 * 形态不合法（handle 非严格形态 / id 非纯数字 / category 缺失）的条目整条丢弃。
 */
export function sanitizeQueueItem(
  item: unknown,
): { handle: string; xUserId?: string; category: string } | null {
  if (!item || typeof item !== 'object') return null;
  const raw = item as Record<string, unknown>;
  const handle = normalizeStrictHandle(raw.handle);
  if (!handle || typeof raw.category !== 'string' || raw.category.length === 0) return null;
  const xUserId = sanitizeXUserId(raw.xUserId);
  return { handle, ...(xUserId ? { xUserId } : {}), category: raw.category };
}

export type QueueResumeDecision = 'adopt' | 'already-running';

/**
 * resume 是否应该在本 tab 启动 runner（review F3：跨 tab 双执行防御）。
 *
 * 心跳（QUEUE_HEARTBEAT_KEY，owner 每 3s 写一次）新鲜 = 有其它 tab 正在执行：
 * 此时本 tab 只应返回 already-running，绝不把 owner 的 running 任务重置为
 * pending 再开第二个 runner（否则同一任务双执行、写状态互踩）。
 */
export function decideQueueResume(
  status: string,
  heartbeatAt: unknown,
  now: number,
  ttlMs: number,
  ownedByThisTab: boolean,
): QueueResumeDecision {
  if (status !== 'running' || ownedByThisTab) return 'adopt';
  return typeof heartbeatAt === 'number' && Number.isFinite(heartbeatAt) && now - heartbeatAt < ttlMs
    ? 'already-running'
    : 'adopt';
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
