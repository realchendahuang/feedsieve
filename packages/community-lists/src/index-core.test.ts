import { describe, expect, it } from 'vitest';
import { buildIndex } from './index-core';
import { isStatusAllowed } from './strength';
import {
  DEFAULT_MARK_STRENGTH,
  isMarkStrength,
  type CommunityEntry,
  type MarkStrength,
  type SnapshotBody,
} from './types';

function entry(overrides: Record<string, unknown>): CommunityEntry {
  const base: CommunityEntry = {
    handle: 'spam_user',
    x_user_id: null,
    category: 'bot_spam',
    status: 'strong',
    report_count: 5,
    rescue_count: 0,
    first_seen_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    evidence_post_ids: [],
  };
  return { ...base, ...overrides } as CommunityEntry;
}

const snapshot: SnapshotBody = {
  schema_version: 1,
  snapshot_version: '2026.08.28.1',
  generated_at: '2026-08-28T00:00:00Z',
  entries: [
    entry({}),
    entry({ handle: 'rec_user', status: 'recommended', x_user_id: '42' }),
    entry({ handle: 'cand_user', status: 'candidate', report_count: 3 }),
    entry({ handle: 'spam_old', aliases: ['renamed_1', 'renamed_2'] }),
  ],
};

describe('strength gating', () => {
  it('maps strength levels to status floors', () => {
    expect(isStatusAllowed('strong', 'refresh')).toBe(true);
    expect(isStatusAllowed('recommended', 'refresh')).toBe(false);
    expect(isStatusAllowed('recommended', 'standard')).toBe(true);
    expect(isStatusAllowed('candidate', 'standard')).toBe(false);
    expect(isStatusAllowed('candidate', 'deep_clean')).toBe(true);
  });

  it('validates and rejects bad strength values', () => {
    expect(isMarkStrength('standard')).toBe(true);
    expect(isMarkStrength('nuclear')).toBe(false);
    expect(DEFAULT_MARK_STRENGTH satisfies MarkStrength).toBe('standard');
  });
});

describe('buildIndex lookup', () => {
  it('filters entries by strength', () => {
    expect(buildIndex(snapshot, 'refresh').size).toBe(2);
    expect(buildIndex(snapshot, 'standard').size).toBe(3);
    expect(buildIndex(snapshot, 'deep_clean').size).toBe(4);
  });

  it('looks up by handle case-insensitively and tolerates @', () => {
    const index = buildIndex(snapshot, 'deep_clean');
    expect(index.lookup('@SPAM_user')?.category).toBe('bot_spam');
    expect(index.lookup('rec_user')?.status).toBe('recommended');
  });

  it('matches renamed handles through the alias table', () => {
    const index = buildIndex(snapshot, 'deep_clean');
    expect(index.lookup('renamed_1')?.handle).toBe('spam_old');
    expect(index.lookup('@Renamed_2')?.handle).toBe('spam_old');
    // 别名不重复计入 size（size 数的是正主条目）
    expect(index.size).toBe(4);
  });

  it('prefers x_user_id (stable across handle renames)', () => {
    const index = buildIndex(snapshot, 'deep_clean');
    expect(index.lookup('rec_user', '42')?.handle).toBe('rec_user');
    // ID 命中优先：即使 handle 改名成新名字，旧 handle 查不到也仍能靠 ID 命中
    expect(index.lookup(null, '42')?.handle).toBe('rec_user');
  });

  it('returns null on miss', () => {
    const index = buildIndex(snapshot, 'refresh');
    expect(index.lookup('cand_user')).toBeNull();
    expect(index.lookup('unknown')).toBeNull();
    expect(index.lookup(null, '999999')).toBeNull();
  });
});
