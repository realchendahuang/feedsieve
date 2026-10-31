import { describe, expect, it } from 'vitest';
import { detectorConfig } from '@feedsieve/detector';
import type { RuntimeCommunity } from '../community/community-store';
import { runDetectionPipeline } from './detection-pipeline';

const NOW = Date.UTC(2026, 9, 31, 12);
const DAY = 86_400_000;

function community(mutedRules: string[] = []): RuntimeCommunity {
  return {
    index: { version: '2026.10.31.1', size: 0, lookup: () => null },
    handleSet: new Set(),
    whitelistSet: new Set(),
    verifiedSet: new Set(),
    fingerprintSet: new Set(),
    domainSet: new Set(),
    campaignById: new Map(),
    campaignByFingerprint: new Map(),
    version: '2026.10.31.1',
    mutedRules: new Set(mutedRules),
  } as unknown as RuntimeCommunity;
}

function run(input: Record<string, unknown>, mutedRules: string[] = []) {
  return runDetectionPipeline({
    input: { handle: 'someone', ...input },
    community: community(mutedRules),
    builtinList: new Set(),
    keywordHeuristics: [],
    catalog: { pack_version: 'test', packs: [] } as never,
    strength: 'standard',
    uiLanguage: 'zh',
  });
}

describe('runDetectionPipeline', () => {
  it('marks a freshly registered throwaway with bait content for review', () => {
    expect(detectorConfig.freshAccount.maxAgeDays).toBe(30);
    const result = run({
      handle: 'lily_chen',
      text: '今晚好涩，在吗',
      author: { followers: 0, following: 300, createdAt: NOW - DAY, defaultAvatar: true },
      observedAt: NOW,
    });
    expect(result.presentation).toBe('review');
    expect(result.detection?.ruleId).toBe('fresh-account-combo');
    expect(result.detection?.reason).toContain('新注册小号');
  });

  it('stops using a rule the server muted for misfiring', () => {
    const input = {
      handle: 'lily_chen',
      text: '今晚好涩，在吗',
      author: { followers: 0, following: 300, createdAt: NOW - DAY, defaultAvatar: true },
      observedAt: NOW,
    };
    const result = run(input, ['fresh-account-combo']);
    expect(result.presentation).toBe('ignore');
    expect(result.detection).toBeNull();
  });
});
