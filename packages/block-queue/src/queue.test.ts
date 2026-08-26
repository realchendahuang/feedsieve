import { describe, expect, it } from 'vitest';
import { BlockQueue, findTask } from './queue';
import type { QueueEnv } from './queue';
import { InvalidTransitionError } from './types';

function fakeEnv() {
  let clock = 1000;
  let seq = 0;
  const env: QueueEnv & { tick(): void } = {
    now: () => clock,
    newId: () => `task-${++seq}`,
    tick: () => {
      clock += 1;
    },
  };
  return env;
}

describe('BlockQueue', () => {
  it('enqueues normalized pending tasks', () => {
    const queue = new BlockQueue(fakeEnv());
    const result = queue.enqueue('@SpamBot42');
    expect(result.accepted).toBe(true);
    expect(result.task?.handle).toBe('spambot42');
    expect(result.task?.status).toBe('pending');
  });

  it('dedupes while an active task exists for the same handle', () => {
    const queue = new BlockQueue(fakeEnv());
    queue.enqueue('spam');

    for (const status of ['pending', 'success'] as const) {
      expect(queue.enqueue('spam').accepted).toBe(false);
      expect(queue.enqueue('spam').reason).toContain(status);
      if (status === 'pending') {
        queue.transition(findTask(queue, 'spam')!.id, 'running');
        queue.transition(findTask(queue, 'spam')!.id, 'success');
      }
    }
  });

  it('allows re-enqueue after failure or cancellation', () => {
    for (const terminal of ['failed', 'cancelled'] as const) {
      const queue = new BlockQueue(fakeEnv());
      queue.enqueue('spam');
      const id = findTask(queue, 'spam')!.id;
      if (terminal === 'failed') {
        queue.fail(id, 'menu not found');
      } else {
        queue.cancel(id);
      }
      expect(queue.enqueue('spam').accepted).toBe(true);
    }
  });

  it('walks the happy path pending -> running -> success', () => {
    const queue = new BlockQueue(fakeEnv());
    queue.enqueue('spam');
    const id = findTask(queue, 'spam')!.id;

    expect(findTask(queue, 'spam')!.status).toBe('pending');
    queue.transition(id, 'running');
    expect(findTask(queue, 'spam')!.status).toBe('running');
    queue.transition(id, 'success');
    expect(findTask(queue, 'spam')!.status).toBe('success');
  });

  it('rejects illegal transitions', () => {
    const queue = new BlockQueue(fakeEnv());
    queue.enqueue('spam');
    const id = findTask(queue, 'spam')!.id;

    expect(() => queue.transition(id, 'success')).toThrow(InvalidTransitionError);
  });

  it('records failure reasons', () => {
    const queue = new BlockQueue(fakeEnv());
    queue.enqueue('spam');
    const id = findTask(queue, 'spam')!.id;

    queue.transition(id, 'running');
    queue.fail(id, 'confirm button not found');

    const task = findTask(queue, 'spam')!;
    expect(task.status).toBe('failed');
    expect(task.failureReason).toBe('confirm button not found');
  });

  it('refuses to remove running tasks', () => {
    const queue = new BlockQueue(fakeEnv());
    queue.enqueue('spam');
    const id = findTask(queue, 'spam')!.id;

    queue.transition(id, 'running');
    expect(queue.remove(id)).toBe(false);

    queue.cancel(id);
    expect(queue.remove(id)).toBe(true);
    expect(queue.tasks()).toHaveLength(0);
  });

  it('keeps original createdAt when re-enqueueing failed handles', () => {
    const env = fakeEnv();
    const queue = new BlockQueue(env);
    queue.enqueue('spam');
    const firstSeenAt = env.now();

    env.tick();
    const id = findTask(queue, 'spam')!.id;
    queue.fail(id, 'rate limited');
    const again = queue.enqueue('spam').task!;

    expect(again.createdAt).toBe(firstSeenAt);
    expect(again.updatedAt).toBeGreaterThan(firstSeenAt);
  });
});
