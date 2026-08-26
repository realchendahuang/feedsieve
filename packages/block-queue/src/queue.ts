import type { BlockTask } from './types';
import { canTransition, InvalidTransitionError } from './types';

/** 队列的环境依赖。注入而非直接调用全局 API：纯逻辑可测，也方便从持久化快照重建。 */
export interface QueueEnv {
  now(): number;
  newId(): string;
}

export interface EnqueueResult {
  task?: BlockTask;
  /** true 表示新建；false 表示因已有活跃任务被去重。 */
  accepted: boolean;
  reason?: string;
}

/**
 * 拉黑队列（内存态）。
 *
 * 设计约束（v0.1 冻结决策）：
 * - 只入队不执行 —— 执行由用户显式触发，走 x-adapter 的原生 Block。
 * - 同一 handle 在 pending/running/success 状态下不可重复入队；
 *   failed/cancelled 视为「没送走」，允许再次入队。
 * - 持久化层后续在此之上做快照同步（MV3 service worker 随时可能被回收）。
 */
export class BlockQueue {
  private readonly tasksById = new Map<string, BlockTask>();

  constructor(private readonly env: QueueEnv) {}

  enqueue(handle: string): EnqueueResult {
    const normalized = handle.trim().replace(/^@+/, '').toLowerCase();
    if (normalized.length === 0) {
      return { accepted: false, reason: 'handle is empty' };
    }

    const existing = [...this.tasksById.values()].find(
      (task) => task.handle === normalized,
    );
    if (
      existing &&
      (existing.status === 'pending' ||
        existing.status === 'running' ||
        existing.status === 'success')
    ) {
      return {
        accepted: false,
        reason: `already queued as ${existing.status}`,
      };
    }

    const task: BlockTask = {
      id: this.env.newId(),
      handle: normalized,
      status: 'pending',
      createdAt: existing?.createdAt ?? this.env.now(),
      updatedAt: this.env.now(),
    };
    this.tasksById.set(task.id, task);
    return { task, accepted: true };
  }

  transition(id: string, to: BlockTask['status']): BlockTask {
    const task = this.tasksById.get(id);
    if (!task) {
      throw new Error(`unknown block task: ${id}`);
    }
    if (!canTransition(task.status, to)) {
      throw new InvalidTransitionError(task.status, to);
    }
    task.status = to;
    task.updatedAt = this.env.now();
    return task;
  }

  fail(id: string, reason: string): BlockTask {
    const task = this.transition(id, 'failed');
    task.failureReason = reason;
    return task;
  }

  cancel(id: string): BlockTask {
    return this.transition(id, 'cancelled');
  }

  remove(id: string): boolean {
    const task = this.tasksById.get(id);
    // running 的任务正在页面上执行原生点击，中途移除会造成队列与页面状态不一致
    if (!task || task.status === 'running') {
      return false;
    }
    return this.tasksById.delete(id);
  }

  tasks(): BlockTask[] {
    return [...this.tasksById.values()].sort((a, b) => a.createdAt - b.createdAt);
  }

  byStatus(status: BlockTask['status']): BlockTask[] {
    return this.tasks().filter((task) => task.status === status);
  }
}

export function findTask(queue: BlockQueue, handle: string): BlockTask | undefined {
  const normalized = handle.trim().replace(/^@+/, '').toLowerCase();
  return queue.tasks().find((task) => task.handle === normalized);
}
