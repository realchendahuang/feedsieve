import { describe, expect, it } from 'vitest';
import type { Detection } from '@feedsieve/detector';
import type { CommunityEntry } from '@feedsieve/community-lists';
import { classifyDetection } from './detection-policy';

function detection(source: Detection['source']): Detection {
  return { handle: 'spam', marked: true, source, reason: 'test', ruleId: 'test' };
}

function entry(overrides: Partial<CommunityEntry> = {}): CommunityEntry {
  return {
    handle: 'spam',
    x_user_id: '1',
    category: 'bot_spam',
    sources: ['community'],
    community_score: 0.63,
    report_count: 5,
    rescue_count: 0,
    net_votes: 5,
    first_seen_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    evidence_post_ids: [],
    ...overrides,
  };
}

describe('扩展检测安全政策', () => {
  it('内置单关键词启发式不直接进入用户黄框，用户配置词库只给人工确认入口', () => {
    expect(classifyDetection({ detection: detection('heuristic'), strength: 'deep_clean' })).toBe(
      'ignore',
    );
    expect(
      classifyDetection({
        detection: { ...detection('heuristic'), ruleId: 'keyword:official:adult-fu-not-black' },
        strength: 'standard',
      }),
    ).toBe('review');
  });

  it('指纹/域名只在大扫除档提示，不进批量拉黑', () => {
    expect(classifyDetection({ detection: detection('fingerprint'), strength: 'standard' })).toBe(
      'ignore',
    );
    expect(classifyDetection({ detection: detection('fingerprint'), strength: 'deep_clean' })).toBe(
      'review',
    );
  });

  it('服务端最终名单命中直接进入批量候选，不在扩展重算门槛', () => {
    expect(
      classifyDetection({
        detection: detection('community-list'),
        strength: 'standard',
        communityEntry: entry(),
      }),
    ).toBe('block-candidate');
    expect(
      classifyDetection({
        detection: detection('community-list'),
        strength: 'refresh',
        communityEntry: entry({
          sources: ['maintainer'],
          maintainer_note: '维护者确认的诈骗账号',
          community_score: 0,
          report_count: 0,
          rescue_count: 0,
          net_votes: 0,
        }),
      }),
    ).toBe('block-candidate');
    expect(
      classifyDetection({
        detection: detection('community-list'),
        strength: 'deep_clean',
      }),
    ).toBe('review');
  });
});
