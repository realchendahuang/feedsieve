import { describe, expect, it } from 'vitest';
import { buildIndex } from './index-core';
import {
  DEFAULT_MARK_STRENGTH,
  isMarkStrength,
  type CommunityEntry,
  type MarkStrength,
  type SnapshotBody,
} from './types';

function entry(overrides: Partial<CommunityEntry> = {}): CommunityEntry {
  return {
    handle: 'spam_user',
    x_user_id: null,
    category: 'bot_spam',
    sources: ['community'],
    community_score: 0.63,
    report_count: 5,
    rescue_count: 1,
    net_votes: 4,
    first_seen_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    evidence_post_ids: [],
    ...overrides,
  };
}

const snapshot: SnapshotBody = {
  schema_version: 2,
  snapshot_version: '2026.09.02.1',
  generated_at: '2026-09-02T00:00:00Z',
  entries: [
    entry(),
    entry({
      handle: 'maintained',
      x_user_id: '42',
      sources: ['maintainer'],
      maintainer_note: '维护者确认的钓鱼账号',
      community_score: 0,
      report_count: 0,
      rescue_count: 0,
      net_votes: 0,
    }),
    entry({ handle: 'spam_old', aliases: ['renamed_1', 'renamed_2'] }),
  ],
};

describe('heuristic strength setting', () => {
  it('still validates the local heuristic setting without filtering the final list', () => {
    expect(isMarkStrength('standard')).toBe(true);
    expect(isMarkStrength('nuclear')).toBe(false);
    expect(DEFAULT_MARK_STRENGTH satisfies MarkStrength).toBe('standard');
    expect(buildIndex(snapshot).size).toBe(3);
  });
});

describe('final blocklist index lookup', () => {
  it('includes every server-published source without client-side threshold logic', () => {
    const index = buildIndex(snapshot);
    expect(index.lookup('spam_user')?.sources).toEqual(['community']);
    expect(index.lookup('maintained')?.sources).toEqual(['maintainer']);
  });

  it('looks up by handle case-insensitively and tolerates @', () => {
    const index = buildIndex(snapshot);
    expect(index.lookup('@SPAM_user')?.category).toBe('bot_spam');
  });

  it('matches renamed handles through the alias table', () => {
    const index = buildIndex(snapshot);
    expect(index.lookup('renamed_1')?.handle).toBe('spam_old');
    expect(index.lookup('@Renamed_2')?.handle).toBe('spam_old');
    expect(index.size).toBe(3);
  });

  it('prefers stable x_user_id across handle renames', () => {
    const index = buildIndex(snapshot);
    expect(index.lookup(null, '42')?.handle).toBe('maintained');
  });

  it('returns null on miss', () => {
    const index = buildIndex(snapshot);
    expect(index.lookup('unknown')).toBeNull();
    expect(index.lookup(null, '999999')).toBeNull();
  });
});
