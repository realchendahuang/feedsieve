import { describe, expect, it } from 'vitest';
import {
  MIN_FINGERPRINT_LENGTH,
  contentFingerprint,
  createRepetitionTracker,
  fingerprintText,
  normalizeForFingerprint,
} from './fingerprint';

const SPAM_TEMPLATE = '🚀 500 USDT Giveaway! Claim on Tron 👉 https://t.co/abc123 — follow & repost 🔥';

describe('normalizeForFingerprint', () => {
  it('strips emoji, punctuation, casing and whitespace', () => {
    expect(normalizeForFingerprint('Hello, World! 🌍 — TEST')).toBe(
      'helloworldtest',
    );
  });

  it('collapses anti-detection spacing (incl. full-width spaces)', () => {
    expect(normalizeForFingerprint('加 我　微信 领 福利')).toBe('加我微信领福利');
  });

  it('replaces URLs and mentions with placeholders', () => {
    expect(normalizeForFingerprint('claim at https://t.co/xyz99 from @spamking')).toBe(
      'claimatfsurlfromfsmention',
    );
  });
});

describe('fingerprintText', () => {
  it('returns 16 lowercase hex chars and is deterministic', () => {
    const a = fingerprintText(SPAM_TEMPLATE);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(fingerprintText(SPAM_TEMPLATE)).toBe(a);
  });

  it('same template with cosmetic variants -> same fingerprint', () => {
    const variants = [
      '🚀 500 USDT Giveaway! DM @spamking88 Claim on Tron 👉 https://t.co/abc123 — follow & repost 🔥',
      // 大小写 + emoji 增删 + 标点差异 + 换链接落点 + 换提及对象
      '🚨 500 usdt GIVEAWAY！DM @newaccount7 Claim on Tron 👉 https://t.co/zzz789 follow & repost 🔥🔥',
      '500 USDT GIVEAWAY dm @lucky_winner99 claim on tron -> http://scam-site.example/win follow & repost!!',
    ];
    const fingerprints = new Set(variants.map((v) => fingerprintText(v)));
    expect(fingerprints.size).toBe(1);
  });

  it('different templates -> different fingerprints', () => {
    const a = fingerprintText('500 USDT Giveaway claim on Tron follow repost');
    const b = fingerprintText('1000 BTC airdrop join our telegram DM me now');
    expect(a).not.toBe(b);
  });

  it('rejects text shorter than the minimum length', () => {
    expect(fingerprintText('加我微信')).toBeNull();
    expect(fingerprintText('')).toBeNull();
    expect(fingerprintText('!!!🚀🔥')).toBeNull();
  });

  it('keeps CJK templates above the minimum length fingerprintable', () => {
    const zh = '加我微信进内部群包赚稳赚不赔带单老师带你飞';
    expect(zh.replace(/\s/g, '').length).toBeGreaterThanOrEqual(
      MIN_FINGERPRINT_LENGTH,
    );
    expect(fingerprintText(zh)).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('contentFingerprint', () => {
  it('prefers tweet text over bio', () => {
    const fp = contentFingerprint({
      text: SPAM_TEMPLATE,
      bio: '加我微信进内部群包赚稳赚不赔',
    });
    expect(fp).toBe(fingerprintText(SPAM_TEMPLATE));
  });

  it('falls back to bio when text is empty or whitespace', () => {
    const bio = '加我微信进内部群包赚稳赚不赔带单老师带你飞';
    expect(contentFingerprint({ text: '   ', bio })).toBe(fingerprintText(bio));
    expect(contentFingerprint({ bio })).toBe(fingerprintText(bio));
  });

  it('returns null without any content', () => {
    expect(contentFingerprint({})).toBeNull();
  });
});

describe('createRepetitionTracker', () => {
  it('marks from the minRepeat-th occurrence onward', () => {
    const tracker = createRepetitionTracker({ minRepeat: 3 });
    expect(tracker.track('a')).toBe(false);
    expect(tracker.track('a')).toBe(false);
    expect(tracker.track('a')).toBe(true);
    expect(tracker.track('a')).toBe(true);
  });

  it('tracks fingerprints independently', () => {
    const tracker = createRepetitionTracker({ minRepeat: 2 });
    expect(tracker.track('a')).toBe(false);
    expect(tracker.track('b')).toBe(false);
    expect(tracker.track('a')).toBe(true);
    expect(tracker.countOf('a')).toBe(2);
    expect(tracker.countOf('b')).toBe(1);
  });

  it('evicts oldest fingerprints beyond maxTracked (session memory bound)', () => {
    const tracker = createRepetitionTracker({ minRepeat: 2, maxTracked: 2 });
    tracker.track('old');
    tracker.track('mid');
    tracker.track('new');
    // 'old' 已被 FIFO 淘汰：再次出现从头计数
    expect(tracker.countOf('old')).toBe(0);
    expect(tracker.track('old')).toBe(false);
    expect(tracker.countOf('old')).toBe(1);
  });

  it('default options: minRepeat=3, maxTracked=600', () => {
    const tracker = createRepetitionTracker();
    tracker.track('x');
    tracker.track('x');
    expect(tracker.track('x')).toBe(true);
  });
});
