import { describe, expect, it } from 'vitest';
import { detect, normalizeHandle, toHandleSet } from './detect';
import { DEFAULT_HEURISTICS } from './heuristics';

const SEED_LIST = toHandleSet(['@SpamKing88', 'crypto_teacher']);

describe('normalizeHandle', () => {
  it('strips @ prefix and lowercases', () => {
    expect(normalizeHandle('@SpamKing88')).toBe('spamking88');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(normalizeHandle('   ')).toBe('');
  });
});

describe('toHandleSet', () => {
  it('accepts both raw handles and list entries', () => {
    const set = toHandleSet(['@Kim', { handle: 'spam.io' }, { foo: 'no handle' } as never]);
    expect(set.has('kim')).toBe(true);
    expect(set.has('spam.io')).toBe(true);
    expect(set.size).toBe(2);
  });
});

describe('detect', () => {
  it('marks list hits before heuristics, with explainable reason', () => {
    // 文本同时命中启发式，但名单优先
    const result = detect(
      { handle: '@SpamKing88', text: 'free crypto giveaway airdrop' },
      { list: SEED_LIST },
    );
    expect(result?.source).toBe('community-list');
    expect(result?.ruleId).toBe('list');
    expect(result?.reason).toBe('名单命中');
  });

  it('supports builtin-list source label', () => {
    const result = detect(
      { handle: '@SpamKing88' },
      { list: SEED_LIST, listSource: 'builtin-list' },
    );
    expect(result?.source).toBe('builtin-list');
  });

  it('rejects empty handles', () => {
    expect(detect({ handle: '' }, { list: SEED_LIST })).toBeNull();
  });

  it('returns null for clean normal accounts', () => {
    expect(
      detect({
        handle: 'kim',
        displayName: 'Kim',
        text: '今天写了一天 Rust，累但开心',
        links: [{ href: 'https://example.com/blog' }],
      }),
    ).toBeNull();
  });
});

describe('heuristic: default-name-digits', () => {
  it.each([
    ['User1987654321', 'user20001'],
    ['用户 95274', 'someone'],
  ])('flags default display name %s', (displayName) => {
    const result = detect({ handle: 'whatever01', displayName });
    expect(result?.ruleId).toBe('default-name-digits');
    expect(result?.reason).toContain('默认名');
  });

  it('flags digit-tail handle without meaningful display name', () => {
    const result = detect({ handle: 'ab123456789', displayName: undefined });
    expect(result?.ruleId).toBe('default-name-digits');
  });

  it('does not flag meaningful names or realistic handles', () => {
    expect(detect({ handle: 'kimpark2024', displayName: '김프론트' })).toBeNull();
    expect(detect({ handle: 'nasa', displayName: 'User1234' })).toBeNull(); // 4 位数字不够长
  });
});

describe('heuristic: spam-link-hint', () => {
  it.each([
    ['crypto-giveaway.example.com', true],
    ['example.com', false],
    ['myfreecrypto.blog', true],
  ])('evaluates host %s', (hostname, shouldMark) => {
    const result = detect({ handle: 'somebody', links: [{ href: `https://${hostname}/`, hostname }] });
    if (shouldMark) {
      expect(result?.ruleId).toBe('spam-link-hint');
      expect(result?.reason).toContain(hostname);
    } else {
      expect(result).toBeNull();
    }
  });

  it('skips links without parsed hostname instead of throwing', () => {
    expect(detect({ handle: 'x', links: [{ href: '::not-a-url::' }] })).toBeNull();
  });
});

describe('heuristic: templated-text', () => {
  it.each([
    ['加我微信进内部群，包赚！'],
    ['DM me for invest signals 🚀🚀'],
    ['Claim your FREE crypto now'],
  ])('flags template %s', (text) => {
    const result = detect({ handle: 'spam', text });
    expect(result?.ruleId).toBe('templated-text');
    expect(result?.reason).toContain('模板化垃圾话术');
  });

  describe('crypto giveaway template (2026-08 real-world samples, anonymized)', () => {
    it.each([
      [
        '🚀 500 USDT Giveaway! Clock\'s ticking—act fast! 💎 Instant claim on Tron ⚡️ No KYC, just repost 🔥 Free entry, win big Join, follow, like, repost & comment now!',
      ],
      [
        '🚨 Massive 500 USDT Giveaway! Don\'t miss out! 🚀 Instant win chance on Tron network 🔥 No purchase—just follow, like, comment & repost Claim your share now—time\'s ticking!',
      ],
    ])('flags real spam copy', (text) => {
      const result = detect({ handle: 'spamuser1', text });
      expect(result?.ruleId).toBe('templated-text');
      expect(result?.reason).toContain('Giveaway');
    });

    it('flags reversed word order and spelling variants', () => {
      expect(
        detect({ handle: 's', text: 'GIWEAWAY time! Get 500 USDT now' })?.marked,
      ).toBe(true);
    });

    it('flags follow/repost + claim bait', () => {
      const result = detect({
        handle: 's',
        text: 'just follow & retweet, then claim your reward',
      });
      expect(result?.reason).toContain('关注-转发抽奖');
    });

    it('keeps normal crypto and giveaway mentions clean', () => {
      expect(detect({ handle: 'dev', text: 'crypto taxes are painful' })).toBeNull();
      expect(
        detect({ handle: 'shop', text: 'we give away swag at the conference booth' }),
      ).toBeNull();
      expect(
        detect({ handle: 'friend', text: 'I like how you claim your mornings' }),
      ).toBeNull();
    });

    it('catches spam planted in bio even with clean tweets', () => {
      const result = detect({
        handle: 'cleanpost',
        text: 'good morning everyone',
        bio: 'DM me for invest signals',
      });
      expect(result?.ruleId).toBe('templated-text');
    });
  });
});

describe('heuristics are individually explainable', () => {
  it('every default rule has id and can run against clean input', () => {
    for (const rule of DEFAULT_HEURISTICS) {
      expect(rule.id.length).toBeGreaterThan(0);
      expect(rule.check({ handle: 'normalperson', text: '', links: [] })).toBeNull();
    }
  });
});
