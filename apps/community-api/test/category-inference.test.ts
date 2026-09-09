import { describe, expect, it } from 'vitest';
import { ECHO_VOTE_SOURCE, inferCategory } from '../src/category-inference';

describe('inferCategory（分类推理）', () => {
  it('外链域名证据优先于票面判断', () => {
    expect(
      inferCategory({
        votes: [
          { reason: 'adult_gray_traffic', detectionSource: null, count: 4 },
          { reason: 'other', detectionSource: null, count: 9 },
        ],
        hasDomainEvidence: true,
        hasFingerprintEvidence: false,
      }),
    ).toBe('scam_phishing');
  });

  it('回声票（社区名单来源）不计入分类，单张具体票压过全部回声票', () => {
    expect(
      inferCategory({
        votes: [
          { reason: 'other', detectionSource: ECHO_VOTE_SOURCE, count: 9 },
          { reason: 'bot_spam', detectionSource: null, count: 1 },
        ],
        hasDomainEvidence: false,
        hasFingerprintEvidence: false,
      }),
    ).toBe('bot_spam');
  });

  it('具体类并列取票数多者，再并列取字典序（产出确定）', () => {
    expect(
      inferCategory({
        votes: [
          { reason: 'scam_phishing', detectionSource: null, count: 2 },
          { reason: 'bot_spam', detectionSource: null, count: 1 },
        ],
        hasDomainEvidence: false,
        hasFingerprintEvidence: false,
      }),
    ).toBe('scam_phishing');
    expect(
      inferCategory({
        votes: [
          { reason: 'adult_gray_traffic', detectionSource: null, count: 1 },
          { reason: 'bot_spam', detectionSource: null, count: 1 },
        ],
        hasDomainEvidence: false,
        hasFingerprintEvidence: false,
      }),
    ).toBe('adult_gray_traffic');
  });

  it('只有 other 票、无任何证据时保持 other', () => {
    expect(
      inferCategory({
        votes: [
          { reason: 'other', detectionSource: null, count: 5 },
          { reason: 'other', detectionSource: ECHO_VOTE_SOURCE, count: 3 },
        ],
        hasDomainEvidence: false,
        hasFingerprintEvidence: false,
      }),
    ).toBe('other');
    expect(
      inferCategory({
        votes: [],
        hasDomainEvidence: false,
        hasFingerprintEvidence: false,
      }),
    ).toBe('other');
  });

  it('无具体票但指纹证据达标时归 copy_paste', () => {
    expect(
      inferCategory({
        votes: [{ reason: 'other', detectionSource: null, count: 3 }],
        hasDomainEvidence: false,
        hasFingerprintEvidence: true,
      }),
    ).toBe('copy_paste');
  });

  it('域名证据强于指纹证据', () => {
    expect(
      inferCategory({
        votes: [],
        hasDomainEvidence: true,
        hasFingerprintEvidence: true,
      }),
    ).toBe('scam_phishing');
  });
});
