import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getFollowingAllowlist,
  removeFollowingAccount,
  replaceFollowingAccounts,
  upsertFollowingAccounts,
} from './following-allowlist';

let storage: Record<string, unknown>;

beforeEach(() => {
  storage = {};
  vi.stubGlobal('browser', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
        set: vi.fn(async (patch: Record<string, unknown>) => Object.assign(storage, patch)),
      },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  });
});

describe('关注保护名单', () => {
  it('增量去重、保留 stable id，且可由完整同步原子替换', async () => {
    await upsertFollowingAccounts([
      { handle: '@Alice' },
      { handle: 'alice', xUserId: '101' },
      { handle: 'Bob', xUserId: '102' },
    ]);
    expect(await getFollowingAllowlist()).toMatchObject([
      { handle: 'alice', xUserId: '101', source: 'observed' },
      { handle: 'bob', xUserId: '102', source: 'observed' },
    ]);

    await replaceFollowingAccounts([{ handle: 'Carol', xUserId: '103' }]);
    expect(await getFollowingAllowlist()).toMatchObject([
      { handle: 'carol', xUserId: '103', source: 'full-sync' },
    ]);
  });

  it('用户主动标记垃圾后可从关注保护移除', async () => {
    await upsertFollowingAccounts([{ handle: 'keep_me' }, { handle: 'changed_mind' }]);
    await removeFollowingAccount('changed_mind');
    expect((await getFollowingAllowlist()).map((item) => item.handle)).toEqual(['keep_me']);
  });
});
