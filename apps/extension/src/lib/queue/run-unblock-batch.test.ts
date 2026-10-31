import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runUnblockBatch } from './run-unblock-batch';

// run-unblock-batch 依赖的是 storage 薄包装，全部 mock；只验证执行编排与失败码透传
vi.mock('../community/blocked-accounts', () => ({
  getBlockedAccounts: vi.fn(),
  removeBlockedAccount: vi.fn(),
}));
vi.mock('../stats/local-stats', () => ({ bumpStat: vi.fn() }));
vi.mock('../stats/daily-stats', () => ({ bumpDaily: vi.fn() }));
vi.mock('../community/user-ids', () => ({ getUserId: vi.fn(), saveUserIds: vi.fn() }));
vi.mock('@feedsieve/x-adapter', () => ({
  resolveUserIdByHandle: vi.fn(),
  runNativeAction: vi.fn(),
}));
// 安全账本 mock：撤销记账行为在本文件单独断言调用次数
vi.mock('./block-safety', () => ({
  recordSafetyEvent: vi.fn(),
  currentAccountKey: vi.fn(() => 'acc-1'),
}));

import { getBlockedAccounts, removeBlockedAccount } from '../community/blocked-accounts';
import { bumpDaily } from '../stats/daily-stats';
import { bumpStat } from '../stats/local-stats';
import { getUserId } from '../community/user-ids';
import { resolveUserIdByHandle, runNativeAction } from '@feedsieve/x-adapter';
import { recordSafetyEvent } from './block-safety';

const mockedGetBlocked = vi.mocked(getBlockedAccounts);
const mockedGetUserId = vi.mocked(getUserId);
const mockedResolve = vi.mocked(resolveUserIdByHandle);
const mockedRunNative = vi.mocked(runNativeAction);
const mockedRecordSafety = vi.mocked(recordSafetyEvent);

describe('runUnblockBatch（一键撤销）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('全部成功：逐个撤销、移除记录、计入统计', async () => {
    mockedGetBlocked.mockResolvedValue([
      { handle: 'a', xUserId: '111', blockedAt: 1 },
      { handle: 'b', xUserId: '222', blockedAt: 1 },
    ]);
    mockedRunNative.mockResolvedValue({ ok: true });
    const result = await runUnblockBatch();
    expect(result).toEqual({ unblocked: ['a', 'b'], failed: [] });
    expect(mockedRunNative).toHaveBeenCalledTimes(2);
    expect(removeBlockedAccount).toHaveBeenCalledTimes(2);
    expect(bumpStat).toHaveBeenCalledTimes(2);
    expect(bumpDaily).toHaveBeenCalledTimes(2);
  });

  it('全部成功：逐个撤销、移除记录、计入统计与安全账本', async () => {
    mockedGetBlocked.mockResolvedValue([
      { handle: 'a', xUserId: '111', blockedAt: 1 },
      { handle: 'b', xUserId: '222', blockedAt: 1 },
    ]);
    mockedRunNative.mockResolvedValue({ ok: true });
    const result = await runUnblockBatch();
    expect(result).toEqual({ unblocked: ['a', 'b'], failed: [] });
    expect(mockedRunNative).toHaveBeenCalledTimes(2);
    expect(removeBlockedAccount).toHaveBeenCalledTimes(2);
    expect(bumpStat).toHaveBeenCalledTimes(2);
    expect(bumpDaily).toHaveBeenCalledTimes(2);
    expect(mockedRecordSafety).toHaveBeenCalledTimes(2);
  });

  it('会话失效（no_csrf）立即中止批次，余量条目记为同码且不再发请求', async () => {
    mockedGetBlocked.mockResolvedValue([
      { handle: 'a', xUserId: undefined, blockedAt: 1 },
      { handle: 'b', xUserId: undefined, blockedAt: 1 },
      { handle: 'c', xUserId: undefined, blockedAt: 1 },
    ]);
    mockedGetUserId.mockResolvedValue(undefined);
    mockedResolve.mockResolvedValue({ ok: false, code: 'no_csrf' });
    const result = await runUnblockBatch();
    expect(result.abortedBy).toBe('no_csrf');
    expect(result.failed).toEqual([
      { handle: 'a', code: 'no_csrf' },
      { handle: 'b', code: 'no_csrf' },
      { handle: 'c', code: 'no_csrf' },
    ]);
    expect(mockedRunNative).not.toHaveBeenCalled();
    expect(mockedRecordSafety).not.toHaveBeenCalled();
  });

  it('限流（rate_limited）也中止批次：定速撤销不能撞 429 风暴', async () => {
    mockedGetBlocked.mockResolvedValue([
      { handle: 'a', xUserId: '111', blockedAt: 1 },
      { handle: 'b', xUserId: '222', blockedAt: 1 },
    ]);
    mockedRunNative.mockResolvedValue({ ok: false, code: 'rate_limited' });
    const result = await runUnblockBatch();
    expect(result.abortedBy).toBe('rate_limited');
    expect(mockedRunNative).toHaveBeenCalledTimes(1);
  });

  it('缓存缺 ID 时走 resolve 回填；resolve 失败码原样透传（no_csrf 不再改写成 missing_csrf）', async () => {
    mockedGetBlocked.mockResolvedValue([{ handle: 'c', xUserId: undefined, blockedAt: 1 }]);
    mockedGetUserId.mockResolvedValue(undefined);
    mockedResolve.mockResolvedValue({ ok: false, code: 'no_csrf' });
    const result = await runUnblockBatch();
    expect(result.failed).toEqual([{ handle: 'c', code: 'no_csrf' }]);
    expect(mockedRunNative).not.toHaveBeenCalled();
  });

  it('指定 handle 只撤销该账号；原生动作失败码透传', async () => {
    mockedGetBlocked.mockResolvedValue([
      { handle: 'a', xUserId: '111', blockedAt: 1 },
      { handle: 'b', xUserId: '222', blockedAt: 1 },
    ]);
    mockedRunNative.mockResolvedValue({ ok: false, code: 'http_error' });
    const result = await runUnblockBatch('a');
    expect(result.failed).toEqual([{ handle: 'a', code: 'http_error' }]);
    expect(mockedRunNative).toHaveBeenCalledTimes(1);
  });
});
