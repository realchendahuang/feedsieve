import { describe, expect, it } from 'vitest';
import {
  MIN_FINGERPRINT_LENGTH,
  contentFingerprint,
  contentFingerprintV1,
  createRepetitionTracker,
  fingerprintText,
  fingerprintTextV1,
  normalizeForFingerprint,
  normalizeForFingerprintV1,
} from './fingerprint';

const SPAM_TEMPLATE =
  '🚀 500 USDT Giveaway! Claim on Tron 👉 https://t.co/abc123 — follow & repost 🔥';

describe('normalizeForFingerprint', () => {
  it('strips emoji, punctuation, casing and whitespace', () => {
    expect(normalizeForFingerprint('Hello, World! 🌍 — TEST')).toBe('helloworldtest');
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
    expect(zh.replace(/\s/g, '').length).toBeGreaterThanOrEqual(MIN_FINGERPRINT_LENGTH);
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

describe('normalizeForFingerprintV1', () => {
  it('NFKC 折叠全角字母/数字到半角（v0 不折叠）', () => {
    expect(normalizeForFingerprintV1('ｄｍ　ｍｅ　５００')).toBe(
      normalizeForFingerprint('dm me 500'),
    );
    expect(normalizeForFingerprint('ｄｍ　ｍｅ　５００')).not.toBe(
      normalizeForFingerprint('dm me 500'),
    );
  });

  it('零宽字符被剥离（垃圾号拆词规避不改变指纹）', () => {
    expect(normalizeForFingerprintV1('d\u200bm me for crypto si\u200bg\u200bnals')).toBe(
      normalizeForFingerprintV1('dm me for crypto signals'),
    );
  });

  it('全角写法与半角写法的 v1 指纹完全相同', () => {
    expect(fingerprintTextV1('ｄｍ　ｍｅ　ｆｏｒ　ｃｒｙｐｔｏ　ｓｉｇｎａｌｓ')).toBe(
      fingerprintTextV1('dm me for crypto signals'),
    );
  });
});

describe('fingerprintTextV1', () => {
  it('输出 16 位 hex、以版本标记 3 开头，且确定性', () => {
    const a = fingerprintTextV1(SPAM_TEMPLATE);
    expect(a).toMatch(/^3[0-9a-f]{15}$/);
    expect(fingerprintTextV1(SPAM_TEMPLATE)).toBe(a);
  });

  it('v0 门槛挡住的短隐语（9 字符）v1 可指纹', () => {
    expect(fingerprintText('我福不黑不信你看')).toBeNull();
    expect(fingerprintTextV1('我福不黑不信你看')).toMatch(/^3[0-9a-f]{15}$/);
  });

  it('更短话术（加我微信）v0/v1 都不产指纹', () => {
    expect(fingerprintTextV1('加我微信')).toBeNull();
    expect(fingerprintTextV1('')).toBeNull();
  });
});

describe('contentFingerprintV1', () => {
  it('正文优先于 bio（与 v0 同构）', () => {
    const fp = contentFingerprintV1({
      text: SPAM_TEMPLATE,
      bio: '加我微信进内部群包赚稳赚不赔',
    });
    expect(fp).toBe(fingerprintTextV1(SPAM_TEMPLATE));
  });

  it('正文为空时退回 bio', () => {
    const bio = '我福不黑不信你看';
    expect(contentFingerprintV1({ text: '   ', bio })).toBe(fingerprintTextV1(bio));
    expect(contentFingerprintV1({ bio })).toBe(fingerprintTextV1(bio));
  });

  it('无内容返回 null', () => {
    expect(contentFingerprintV1({})).toBeNull();
  });
});

describe('createRepetitionTracker', () => {
  it('marks from the minRepeat-th occurrence onward', () => {
    const tracker = createRepetitionTracker({ minRepeat: 3 });
    expect(tracker.track('a', 'user1')).toBe(false);
    expect(tracker.track('a', 'user2')).toBe(false);
    expect(tracker.track('a', 'user3')).toBe(true);
    expect(tracker.track('a', 'user4')).toBe(true);
  });

  it('tracks fingerprints independently', () => {
    const tracker = createRepetitionTracker({ minRepeat: 2 });
    expect(tracker.track('a', 'user1')).toBe(false);
    expect(tracker.track('b', 'user1')).toBe(false);
    expect(tracker.track('a', 'user2')).toBe(true);
    expect(tracker.countOf('a')).toBe(2);
    expect(tracker.countOf('b')).toBe(1);
  });

  it('does not count the same account or a rerender twice', () => {
    const tracker = createRepetitionTracker({ minRepeat: 2 });
    expect(tracker.track('a', 'SameUser')).toBe(false);
    expect(tracker.track('a', 'sameuser')).toBe(false);
    expect(tracker.countOf('a')).toBe(1);
  });

  it('evicts oldest fingerprints beyond maxTracked (session memory bound)', () => {
    const tracker = createRepetitionTracker({ minRepeat: 2, maxTracked: 2 });
    tracker.track('old', 'user1');
    tracker.track('mid', 'user1');
    tracker.track('new', 'user1');
    // 'old' 已被 FIFO 淘汰：再次出现从头计数
    expect(tracker.countOf('old')).toBe(0);
    expect(tracker.track('old', 'user1')).toBe(false);
    expect(tracker.countOf('old')).toBe(1);
  });

  it('default options: minRepeat=3, maxTracked=600', () => {
    const tracker = createRepetitionTracker();
    tracker.track('x', 'user1');
    tracker.track('x', 'user2');
    expect(tracker.track('x', 'user3')).toBe(true);
  });
});
