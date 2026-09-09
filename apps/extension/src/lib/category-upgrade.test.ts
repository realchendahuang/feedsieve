// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadSpamEvidenceSets,
  recomputeBlockedCategory,
  upgradeBlockedCategories,
  type SpamEvidenceSets,
} from './category-upgrade';

const EVIDENCE: SpamEvidenceSets = {
  fingerprints: new Set(['0123456789abcdef']),
  domains: new Set(['spam.example']),
};

describe('recomputeBlockedCategory（只升不降）', () => {
  it('other 票按证据升级：域名 → scam_phishing，指纹 → copy_paste', () => {
    expect(
      recomputeBlockedCategory({ category: 'other', linkDomains: ['spam.example'] }, EVIDENCE),
    ).toBe('scam_phishing');
    expect(
      recomputeBlockedCategory({ category: 'other', contentFingerprint: '0123456789abcdef' }, EVIDENCE),
    ).toBe('copy_paste');
  });

  it('证据不在社区达标集合里时保持 other', () => {
    expect(
      recomputeBlockedCategory({ category: 'other', linkDomains: ['random.example'] }, EVIDENCE),
    ).toBe('other');
    expect(
      recomputeBlockedCategory(
        { category: 'other', contentFingerprint: 'ffffffffffffffff' },
        EVIDENCE,
      ),
    ).toBe('other');
  });

  it('已有具体分类不动（不降级、不改判）', () => {
    expect(
      recomputeBlockedCategory(
        { category: 'adult_gray_traffic', contentFingerprint: '0123456789abcdef' },
        EVIDENCE,
      ),
    ).toBe('adult_gray_traffic');
  });

  it('缺分类按 other 处理', () => {
    expect(
      recomputeBlockedCategory({ contentFingerprint: '0123456789abcdef' }, EVIDENCE),
    ).toBe('copy_paste');
  });
});

describe('upgradeBlockedCategories（同步链路升级）', () => {
  let storage: Record<string, unknown>;

  beforeEach(() => {
    storage = {
      communitySettings: { enabled: true, strength: 'standard', autoContribute: true },
    };
    vi.stubGlobal('browser', {
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
          set: vi.fn(async (patch: Record<string, unknown>) => Object.assign(storage, patch)),
          remove: vi.fn(async (key: string) => {
            delete storage[key];
          }),
        },
      },
    });
  });

  it('按已验签快照的达标证据升级 other 票并写回；二次调用幂等', async () => {
    const body = `${JSON.stringify({
      schema_version: 2,
      snapshot_version: '2026.09.09.1',
      generated_at: '2026-09-09T00:00:00.000Z',
      entries: [
        {
          handle: 'template_spam',
          x_user_id: null,
          category: 'copy_paste',
          sources: ['community'],
          community_score: 0.5,
          report_count: 3,
          rescue_count: 0,
          net_votes: 3,
          first_seen_at: '2026-09-01T00:00:00.000Z',
          updated_at: '2026-09-01T00:00:00.000Z',
          evidence_post_ids: [],
          fingerprints: ['0123456789abcdef'],
          domains: ['spam.example'],
        },
      ],
    })}\n`;
    storage.communitySnapshotV2 = { snapshot_version: '2026.09.09.1', body, synced_at: 1 };
    storage.blockedAccounts = [
      { handle: 'fp_block', blockedAt: 1, category: 'other', contentFingerprint: '0123456789abcdef' },
      { handle: 'domain_block', blockedAt: 2, category: 'other', linkDomains: ['spam.example'] },
      { handle: 'already_specific', blockedAt: 3, category: 'scam_phishing' },
    ];

    expect(await upgradeBlockedCategories()).toBe(2);
    const accounts = storage.blockedAccounts as Array<{ handle: string; category?: string }>;
    expect(accounts.find((a) => a.handle === 'fp_block')?.category).toBe('copy_paste');
    expect(accounts.find((a) => a.handle === 'domain_block')?.category).toBe('scam_phishing');
    expect(accounts.find((a) => a.handle === 'already_specific')?.category).toBe('scam_phishing');

    expect(await upgradeBlockedCategories()).toBe(0);
  });

  it('快照无证据 / 本地无候选时零开销跳过', async () => {
    const body = `${JSON.stringify({
      schema_version: 2,
      snapshot_version: '2026.09.09.2',
      generated_at: '2026-09-09T00:00:00.000Z',
      entries: [],
    })}\n`;
    storage.communitySnapshotV2 = { snapshot_version: '2026.09.09.2', body, synced_at: 1 };
    storage.blockedAccounts = [
      { handle: 'no_evidence', blockedAt: 1, category: 'other', contentFingerprint: 'ffffffffffffffff' },
    ];
    expect(await upgradeBlockedCategories()).toBe(0);
    expect(await loadSpamEvidenceSets()).toEqual({ fingerprints: new Set(), domains: new Set() });
  });
});
