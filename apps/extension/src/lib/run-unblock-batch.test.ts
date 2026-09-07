import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runUnblockBatch } from './run-unblock-batch';

// run-unblock-batch 依赖的是 storage 薄包装，全部 mock；只验证执行编排与失败码透传
vi.mock('./blocked-accounts', () => ({
  getBlockedAccounts: vi.fn(),
  removeBlockedAccount: vi.fn(),
}));
vi.mock('./local-stats', () => ({ bumpStat: vi.fn() }));
vi.mock('./daily-stats', () => ({ bumpDaily: vi.fn() }));
vi.mock('./user-ids', () => ({ getUserId: vi.fn(), saveUserIds: vi.fn() }));
vi.mock('@feedsieve/x-adapter', () => ({
  resolveUserIdByHandle: vi.fn(),
  runNativeAction: vi.fn(),
}));

import { getBlockedAccounts, removeBlockedAccount } from './blocked-accounts';
import { bumpDaily } from './daily-stats';
import { bumpStat } from './local-stats';
import { getUserId } from './user-ids';
import { resolveUserIdByHandle, runNativeAction } from '@feedsieve/x-adapter';

const mockedGetBlocked = vi.mocked(getBlockedAccounts);
const mockedGetUserId = vi.mocked(getUserId);
const mockedResolve = vi.mocked(resolveUserIdByHandle);
const mockedRunNative = vi.mocked(runNativeAction);

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
