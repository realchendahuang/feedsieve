import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getBlockedAccounts,
  markBlocked,
  mutateBlockedAccounts,
  removeBlockedAccount,
} from './blocked-accounts';

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

describe('blockedAccounts 记账', () => {
  it('记账 + 幂等（重复记账不动 blockedAt，保留首次时间）', async () => {
    await markBlocked('@Alice', '101', { category: 'bot_spam', origin: 'single-detection' });
    const first = (await getBlockedAccounts())[0];
    if (!first) throw new Error('expected entry');
    expect(first).toMatchObject({ handle: 'alice', xUserId: '101', category: 'bot_spam' });
    const before = first.blockedAt;
    // 带 evidence 的重复记账：category 用最新判断覆盖（既有语义）；无 origin 字段时保留旧 origin
    await markBlocked('alice', '102', { category: 'other' });
    const after = (await getBlockedAccounts())[0];
    if (!after) throw new Error('expected entry');
    expect(after.blockedAt).toBe(before);
    // xUserId 只在缺失时补填，不覆盖已有值
    expect(after.xUserId).toBe('101');
    expect(after.category).toBe('other');
    expect(after.origin).toBe('single-detection');
  });

  it('并发记账不丢条目（F2：单条拉黑与队列拉黑可并发完成）', async () => {
    await Promise.all([
      markBlocked('alice', '101'),
      markBlocked('bob', '102'),
      markBlocked('carol', '103'),
    ]);
    const handles = (await getBlockedAccounts()).map((a) => a.handle).sort();
    expect(handles).toEqual(['alice', 'bob', 'carol']);
  });

  it('撤销移除 + 批量更新走同一互斥，结果可见', async () => {
    await Promise.all([markBlocked('alice'), markBlocked('bob')]);
    const changed = await mutateBlockedAccounts((accounts) => {
      for (const account of accounts) account.category = 'other';
      return accounts.length;
    });
    expect(changed).toBe(2);
    await removeBlockedAccount('alice');
    expect((await getBlockedAccounts()).map((a) => a.handle)).toEqual(['bob']);
  });

  it('非法 handle 静默忽略', async () => {
    await markBlocked('   ');
    expect(await getBlockedAccounts()).toEqual([]);
  });
});
