/**
 * Block Queue 契约（IMPLEMENTATION_PLAN.md Phase 3）。
 *
 * 状态机：
 *
 *   pending -> running -> success
 *                      \-> failed
 *   pending | running | failed -> cancelled
 *
 * 持久化（IndexedDB / storage）与执行器（原生点击 runner）在后续阶段接入；
 * 本包先固化纯逻辑状态机：MV3 service worker 被回收后，靠持久化快照重建队列。
 */

export type BlockTaskStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'failed'
  | 'cancelled';

export interface BlockTask {
  id: string;
  /** 归一化 handle（无 @、小写），身份字段见冻结决策 #8。 */
  handle: string;
  status: BlockTaskStatus;
  /** 失败原因；status === 'failed' 时必须有值。 */
  failureReason?: string;
  createdAt: number;
  updatedAt: number;
}

/** 非法状态迁移抛出。调用方应先 canTransition 再操作或捕获此错误。 */
export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: BlockTaskStatus,
    public readonly to: BlockTaskStatus,
  ) {
    super(`illegal block task transition: ${from} -> ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

const TRANSITIONS: Record<BlockTaskStatus, readonly BlockTaskStatus[]> = {
  // pending 也允许直接进 failed：任务可能在开始执行前就被判死（handle 校验失败、登录异常等）
  pending: ['running', 'failed', 'cancelled'],
  running: ['success', 'failed', 'cancelled'],
  success: [],
  failed: ['cancelled'],
  cancelled: [],
};

export function canTransition(from: BlockTaskStatus, to: BlockTaskStatus): boolean {
  return TRANSITIONS[from].includes(to);
}
