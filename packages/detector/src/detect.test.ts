import { describe, expect, it } from 'vitest';
import { detect, normalizeHandle, toHandleSet } from './detect';
import { DEFAULT_HEURISTICS } from './heuristics';
import { fingerprintText } from './fingerprint';

const SEED_LIST = toHandleSet(['@SpamKing88', 'crypto_teacher']);
const KNOWN_TEMPLATE_FP = fingerprintText(
  '🚀 500 USDT Giveaway! DM @spamking88 Claim on Tron 👉 https://t.co/abc123 follow & repost 🔥',
)!;
const TEMPLATE_TWEET =
  '🚨 500 usdt GIVEAWAY！DM @newaccount7 Claim on Tron 👉 https://t.co/zzz789 follow & repost 🔥🔥';

describe('detect: community fingerprint (v0.4)', () => {
  it('marks tweets matching a known community fingerprint', () => {
    const result = detect(
      { handle: 'brand_new_rebrand', text: TEMPLATE_TWEET },
      { fingerprints: new Set([KNOWN_TEMPLATE_FP]) },
    );
    expect(result?.source).toBe('fingerprint');
    expect(result?.ruleId).toBe('community-fingerprint');
    expect(result?.reason).toContain('社区指纹');
  });

  it('fingerprint beats heuristics when both would hit', () => {
    // TEMPLATE_TWEET 同时命中 crypto-giveaway 正则启发式，但社区指纹优先
    const result = detect(
      { handle: 'brand_new_rebrand', text: TEMPLATE_TWEET },
      { fingerprints: new Set([KNOWN_TEMPLATE_FP]) },
    );
    expect(result?.source).toBe('fingerprint');
  });

  it('keeps unknown-template accounts clean when only fingerprints are set', () => {
    expect(
      detect(
        { handle: 'kim', text: '今天写了一天 Rust，累但开心' },
        { fingerprints: new Set([KNOWN_TEMPLATE_FP]) },
      ),
    ).toBeNull();
  });

  it('empty fingerprint set disables fingerprint marking (falls through to heuristics)', () => {
    const result = detect(
      { handle: 'spam', text: TEMPLATE_TWEET },
      { fingerprints: new Set() },
    );
    expect(result?.source).toBe('heuristic');
  });
});

describe('detect: community domain (v0.4)', () => {
  it('marks links pointing at a listed domain, case-insensitively', () => {
    const result = detect(
      { handle: 'somebody', links: [{ href: 'https://scam-sity.example/', hostname: 'SCAM-Sity.Example' }] },
      { domains: new Set(['scam-sity.example']) },
    );
    expect(result?.source).toBe('domain');
    expect(result?.ruleId).toBe('community-domain');
    expect(result?.reason).toContain('scam-sity.example');
  });

  it('fingerprint wins over domain when both match', () => {
    const result = detect(
      {
        handle: 'rebranded_spam',
        text: TEMPLATE_TWEET,
        links: [{ href: 'https://scam-sity.example/', hostname: 'scam-sity.example' }],
      },
      {
        fingerprints: new Set([KNOWN_TEMPLATE_FP]),
        domains: new Set(['scam-sity.example']),
      },
    );
    expect(result?.source).toBe('fingerprint');
  });

  it('list beats fingerprint and domain', () => {
    const result = detect(
      {
        handle: '@SpamKing88',
        text: TEMPLATE_TWEET,
        links: [{ href: 'https://scam-sity.example/', hostname: 'scam-sity.example' }],
      },
      {
        list: SEED_LIST,
        fingerprints: new Set([KNOWN_TEMPLATE_FP]),
        domains: new Set(['scam-sity.example']),
      },
    );
    expect(result?.ruleId).toBe('list');
  });
});

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

  describe('porn-bait-zh (2026-08 real-world samples from a live thread)', () => {
    it.each([
      ['比我好看的没我骚 比我骚的没我好看🍑'],
      ['应该没人比我玩的更开了吧🍒我福不黑不信你看'],
      ['我果然太涩了🍑👑有人想批评一下我的福嘛'],
    ])('flags porn-bait copy: %s', (text) => {
      const result = detect({ handle: 'bait01', text });
      expect(result?.ruleId).toBe('porn-bait-zh');
      expect(result?.marked).toBe(true);
    });

    it('catches 福利-in-bio variant', () => {
      expect(detect({ handle: 'bait02', bio: '福利在简介 自取' })?.ruleId).toBe(
        'porn-bait-zh',
      );
    });

    it('keeps normal Chinese text clean (single erogenous marker is not enough)', () => {
      expect(detect({ handle: 'tea', text: '今天的茶有点涩，回甘不错' })).toBeNull();
      expect(detect({ handle: 'gamer', text: '这个英雄机制玩得真开' })).toBeNull();
      expect(detect({ handle: 'foodie', text: '桃子🍑熟了，快来摘' })).toBeNull();
      expect(detect({ handle: 'student', text: '老师批评了一下我的方案，改' })).toBeNull();
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
