import { describe, expect, it } from 'vitest';
import {
  normalizeStrictHandle,
  sanitizeBridgePayload,
  sanitizeXUserId,
} from './xhr-bridge-guard';

/** 构造一个最小合法 payload，单个测试只覆盖需要伪造的字段。 */
function validPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    matchedEndpoints: ['HomeTimeline'],
    tweets: [
      {
        author: { handle: 'alice', xUserId: '101', bio: 'hi' },
        text: 't',
      },
    ],
    listMembers: [],
    following: [],
    ...overrides,
  };
}

describe('normalizeStrictHandle', () => {
  it('接受合法 handle（去 @ / 小写化 / 1-15 位）', () => {
    expect(normalizeStrictHandle('@Alice_01')).toBe('alice_01');
    expect(normalizeStrictHandle('bob')).toBe('bob');
    expect(normalizeStrictHandle('  carl ')).toBe('carl');
    expect(normalizeStrictHandle('a'.repeat(15))).toBe('a'.repeat(15));
  });

  it('拒绝非法形态（16+ 位 / 非法字符 / 非字符串）', () => {
    expect(normalizeStrictHandle('a'.repeat(16))).toBeNull();
    expect(normalizeStrictHandle('bad name')).toBeNull();
    expect(normalizeStrictHandle('中文')).toBeNull();
    expect(normalizeStrictHandle(123)).toBeNull();
    expect(normalizeStrictHandle('')).toBeNull();
    expect(normalizeStrictHandle(undefined)).toBeNull();
  });
});

describe('sanitizeXUserId', () => {
  it('只接受 1-20 位纯数字字符串', () => {
    expect(sanitizeXUserId('12345')).toBe('12345');
    expect(sanitizeXUserId('1')).toBe('1');
    expect(sanitizeXUserId('1'.repeat(20))).toBe('1'.repeat(20));
    expect(sanitizeXUserId('1'.repeat(21))).toBeUndefined();
    expect(sanitizeXUserId('abc')).toBeUndefined();
    expect(sanitizeXUserId(' 123 ')).toBeUndefined();
    expect(sanitizeXUserId(123)).toBeUndefined();
    expect(sanitizeXUserId(null)).toBeUndefined();
  });
});

describe('sanitizeBridgePayload', () => {
  it('合法 payload：字段逐项收敛，id/followed/bio/self 全部通过严格校验', () => {
    const out = sanitizeBridgePayload(
      validPayload({
        selfHandle: '@Me',
        following: [{ handle: 'friend', xUserId: '55' }],
      }),
    );
    expect(out).not.toBeNull();
    expect(out?.idEntries).toEqual([
      { handle: 'alice', xUserId: '101' },
      { handle: 'friend', xUserId: '55' },
    ]);
    expect(out?.followedEntries).toEqual([{ handle: 'friend', xUserId: '55' }]);
    expect(out?.bios).toEqual([{ handle: 'alice', bio: 'hi' }]);
    expect(out?.selfHandle).toBe('me');
    expect(out?.isFollowingPage).toBe(false);
  });

  it('整体形态非法（非对象 / matchedEndpoints 缺失）返回 null', () => {
    expect(sanitizeBridgePayload(null)).toBeNull();
    expect(sanitizeBridgePayload('junk')).toBeNull();
    expect(sanitizeBridgePayload({})).toBeNull();
    expect(sanitizeBridgePayload({ matchedEndpoints: 'HomeTimeline' })).toBeNull();
  });

  it('伪造 handle：非法形态整条丢弃，合法条目不受影响', () => {
    const out = sanitizeBridgePayload(
      validPayload({
        tweets: [
          { author: { handle: 'good_user', xUserId: '1' } },
          { author: { handle: 'a'.repeat(16), xUserId: '2' } },
          { author: { handle: 'evil name!', xUserId: '3' } },
          { author: { handle: 42, xUserId: '4' } },
        ],
      }),
    );
    expect(out?.idEntries).toEqual([{ handle: 'good_user', xUserId: '1' }]);
  });

  it('伪造 xUserId：非数字 / 超长 / 注入串一律丢弃，绝不入库', () => {
    const out = sanitizeBridgePayload(
      validPayload({
        tweets: [
          { author: { handle: 'alice', xUserId: "'; DROP TABLE users;--" } },
          { author: { handle: 'alice', xUserId: 123 } },
          { author: { handle: 'alice', xUserId: '1'.repeat(21) } },
        ],
      }),
    );
    expect(out?.idEntries).toEqual([]);
  });

  it('listMembers：id 必需，缺失/非法成员整条丢弃', () => {
    const out = sanitizeBridgePayload(
      validPayload({
        tweets: [],
        listMembers: [
          { handle: 'member1', xUserId: '11' },
          { handle: 'member2' },
          { handle: 'member3', xUserId: 'not-a-number' },
        ],
      }),
    );
    expect(out?.idEntries).toEqual([{ handle: 'member1', xUserId: '11' }]);
  });

  it('following 页：cursor/sourceUrl 只收非空字符串，非法静默置空', () => {
    const out = sanitizeBridgePayload(
      validPayload({
        matchedEndpoints: ['Following'],
        followingCursor: { evil: true },
        sourceUrl: 42,
        following: [{ handle: 'a', xUserId: '9' }],
      }),
    );
    expect(out?.isFollowingPage).toBe(true);
    expect(out?.followingCursor).toBeUndefined();
    expect(out?.sourceUrl).toBeUndefined();
    expect(out?.following).toEqual([{ handle: 'a', xUserId: '9' }]);
  });

  it('Following 页 sourceUrl/cursor 合法时保留（分页同步依赖）', () => {
    const out = sanitizeBridgePayload(
      validPayload({
        matchedEndpoints: ['Following'],
        followingCursor: 'cursor-1',
        sourceUrl: 'https://x.com/i/api/graphql/abc/Following?variables=x',
        following: [{ handle: 'a' }],
      }),
    );
    expect(out?.followingCursor).toBe('cursor-1');
    expect(out?.sourceUrl).toBe('https://x.com/i/api/graphql/abc/Following?variables=x');
  });

  it('bio 非字符串丢弃；following !== true 不进保护名单', () => {
    const out = sanitizeBridgePayload(
      validPayload({
        tweets: [
          { author: { handle: 'a', bio: 42, following: 'yes' } },
          { author: { handle: 'b', following: false } },
        ],
      }),
    );
    expect(out?.bios).toEqual([]);
    expect(out?.followedEntries).toEqual([]);
  });
});
