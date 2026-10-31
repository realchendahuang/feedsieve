import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getUserIds, saveUserIds } from './user-ids';

let storage: Record<string, unknown>;
let setSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  storage = {};
  setSpy = vi.fn(async (patch: Record<string, unknown>) => Object.assign(storage, patch));
  vi.stubGlobal('browser', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
        set: setSpy,
      },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  });
});

describe('userIds 存储', () => {
  it('新账号写入并持久化', async () => {
    await saveUserIds([{ handle: '@Alice', xUserId: '101' }]);
    expect((await getUserIds())['alice']).toBe('101');
    expect(setSpy).toHaveBeenCalledTimes(1);
  });

  it('重复出现的已知 id 不再写盘（滚动期间每个 GraphQL 响应都会带回它们）', async () => {
    await saveUserIds([{ handle: 'alice', xUserId: '101' }]);
    expect(setSpy).toHaveBeenCalledTimes(1);
    await saveUserIds([{ handle: 'alice', xUserId: '101' }]);
    await saveUserIds([
      { handle: 'alice', xUserId: '101' },
      { handle: 'bob', xUserId: '102' },
    ]);
    expect(setSpy).toHaveBeenCalledTimes(2);
    expect((await getUserIds())['bob']).toBe('102');
  });

  it('id 变化时仍然写入', async () => {
    await saveUserIds([{ handle: 'alice', xUserId: '101' }]);
    await saveUserIds([{ handle: 'alice', xUserId: '999' }]);
    expect(setSpy).toHaveBeenCalledTimes(2);
    expect((await getUserIds())['alice']).toBe('999');
  });
});
