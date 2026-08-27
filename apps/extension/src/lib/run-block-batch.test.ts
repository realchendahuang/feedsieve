// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runPendingBlockBatch, type BatchBlockResult } from './run-block-batch';
import {
  getPendingBlocks,
  removePendingBlock,
  type PendingBlock,
} from './pending-blocks';

vi.mock('./pending-blocks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./pending-blocks')>();
  return {
    ...actual,
    getPendingBlocks: vi.fn(),
    removePendingBlock: vi.fn(),
  };
});

vi.mock('./user-ids', () => ({
  getUserId: vi.fn(),
}));

vi.mock('@feedsieve/x-adapter', () => ({
  resolveUserIdByHandle: vi.fn(),
  runNativeAction: vi.fn(),
}));

vi.mock('./remove-tweets', () => ({
  collectCellsByHandle: vi.fn(() => []),
  removeCellsSoon: vi.fn(),
}));

import { getUserId } from './user-ids';
import { resolveUserIdByHandle, runNativeAction } from '@feedsieve/x-adapter';
import { collectCellsByHandle, removeCellsSoon } from './remove-tweets';

const mockedGetPending = vi.mocked(getPendingBlocks);
const mockedRemove = vi.mocked(removePendingBlock);
const mockedGetUserId = vi.mocked(getUserId);
const mockedResolve = vi.mocked(resolveUserIdByHandle);
const mockedRun = vi.mocked(runNativeAction);
const mockedCollect = vi.mocked(collectCellsByHandle);
const mockedRemoveSoon = vi.mocked(removeCellsSoon);

function pending(handle: string, xUserId?: string): PendingBlock {
  return { handle, addedAt: 0, markedReason: '测试', ...(xUserId ? { xUserId } : {}) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  mockedGetPending.mockResolvedValue([]);
  mockedGetUserId.mockResolvedValue(undefined);
  mockedResolve.mockResolvedValue(null);
  mockedRun.mockResolvedValue({ ok: true });
});

/** 真实跑完整个批次（含每条之间的节流间隔）。 */
async function runBatch(): Promise<BatchBlockResult> {
  const promise = runPendingBlockBatch();
  await vi.runAllTimersAsync();
  return promise;
}

describe('runPendingBlockBatch', () => {
  it('blocks all pending accounts and removes them from the list', async () => {
    mockedGetPending.mockResolvedValue([pending('a', '1'), pending('b', '2')]);

    const result = await runBatch();

    expect(result).toEqual({ blocked: ['a', 'b'], failed: [] });
    expect(mockedRun).toHaveBeenCalledTimes(2);
    expect(mockedRun).toHaveBeenCalledWith('block', '1');
    expect(mockedRun).toHaveBeenCalledWith('block', '2');
    expect(mockedRemove).toHaveBeenCalledWith('a');
    expect(mockedRemove).toHaveBeenCalledWith('b');
  });

  it('falls back to cache, then live resolution, for missing rest_id', async () => {
    mockedGetPending.mockResolvedValue([pending('a'), pending('b'), pending('c')]);
    mockedGetUserId.mockResolvedValueOnce('cached-id');
    mockedResolve.mockResolvedValueOnce('resolved-id');
    mockedResolve.mockResolvedValueOnce(null); // c 解析失败

    const result = await runBatch();

    expect(mockedRun).toHaveBeenNthCalledWith(1, 'block', 'cached-id');
    expect(mockedRun).toHaveBeenNthCalledWith(2, 'block', 'resolved-id');
    expect(result.blocked).toEqual(['a', 'b']);
    expect(result.failed).toEqual([{ handle: 'c', code: 'no-id' }]);
    expect(mockedRemove).not.toHaveBeenCalledWith('c');
  });

  it('keeps failed accounts in the list with their failure code', async () => {
    mockedGetPending.mockResolvedValue([pending('x', '9')]);
    mockedRun.mockResolvedValueOnce({ ok: false, code: 'rate_limited' });

    const result = await runBatch();

    expect(result.failed).toEqual([{ handle: 'x', code: 'rate_limited' }]);
    expect(result.blocked).toEqual([]);
    expect(mockedRemove).not.toHaveBeenCalled();
  });

  it('paces requests and removes tweets of blocked accounts', async () => {
    mockedGetPending.mockResolvedValue([pending('a', '1'), pending('b', '2')]);

    const promise = runPendingBlockBatch();
    // 两条之间应有 PACE_MS 间隔：399ms 时只发出第一条
    await vi.advanceTimersByTimeAsync(399);
    expect(mockedRun).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(mockedRun).toHaveBeenCalledTimes(2);
    // 最后一条之后还有一次节流间隔，收尾等它结束
    await vi.advanceTimersByTimeAsync(400);
    await promise;

    expect(mockedCollect).toHaveBeenCalledWith('a');
    expect(mockedCollect).toHaveBeenCalledWith('b');
    expect(mockedRemoveSoon).toHaveBeenCalledTimes(2);
  });
});