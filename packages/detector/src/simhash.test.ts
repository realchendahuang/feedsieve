import { describe, expect, it } from 'vitest';
import {
  SIMHASH_HAMMING_THRESHOLD,
  hammingDistance,
  simhashFromHex,
  simhashToHex,
  textToSimhash,
} from './simhash';
import { contentFingerprint } from './fingerprint';

const TEMPLATE =
  '🚀 500 USDT Giveaway! DM @spamking88 Claim on Tron 👉 https://t.co/abc123 follow & repost 🔥';

/** 换词变体：同样的 giveaway 骨架，措辞微调 */
const VARIANT =
  '🎉 500 USDT Giveaway! DM @newaccount7 Claim on Tron 👉 https://t.co/xyz789 follow & repost 💥';

/** 换了关键动作（送钱 -> 聊天广告）的模板，语义不同 */
const DIFFERENT_TEMPLATE =
  '🎁 Free $TRX Airdrop is LIVE ⚡️ Zero gas fees, zero risk 👉 Send 10 TRX to receive 100 Back!';

describe('simhash: 变体识别', () => {
  it('相同模板的 SimHash 汉明距离为 0', () => {
    const a = textToSimhash(TEMPLATE);
    const b = textToSimhash(TEMPLATE.replace('DM', 'dm'));
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(hammingDistance(a!, b!)).toBe(0);
  });

  it('换词变体（同骨架）距离 <= 阈值', () => {
    const a = textToSimhash(TEMPLATE);
    const b = textToSimhash(VARIANT);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    const dist = hammingDistance(a!, b!);
    expect(dist).toBeLessThanOrEqual(SIMHASH_HAMMING_THRESHOLD);
  });

  it('语义不同的模板距离 > 阈值（不误报）', () => {
    const a = textToSimhash(TEMPLATE);
    const c = textToSimhash(DIFFERENT_TEMPLATE);
    expect(a).not.toBeNull();
    expect(c).not.toBeNull();
    const dist = hammingDistance(a!, c!);
    expect(dist).toBeGreaterThan(SIMHASH_HAMMING_THRESHOLD);
  });

  it('同模板的不同账号（换 handle 换 URL）仍被识别为变体', () => {
    const a = textToSimhash(
      '🚀 500 USDT Giveaway! DM @spamking88 Claim on Tron 👉 https://t.co/abc123 follow & repost 🔥',
    );
    const b = textToSimhash(
      '🚀 500 USDT Giveaway! DM @trxminer07 Claim on Tron 👉 https://t.co/def456 follow & repost 🔥',
    );
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(hammingDistance(a!, b!)).toBeLessThanOrEqual(SIMHASH_HAMMING_THRESHOLD);
  });
});

describe('simhash: hex 与隐私', () => {
  it('hex 往返一致', () => {
    const v = textToSimhash(TEMPLATE)!;
    expect(simhashFromHex(simhashToHex(v))).toBe(v);
  });

  it('输出是 16 位 hex（与 fingerprintText 同形状），原文不可逆', () => {
    const v = textToSimhash(TEMPLATE);
    expect(v).not.toBeNull();
    expect(simhashToHex(v!)).toMatch(/^[0-9a-f]{16}$/);
    // 原文不出设备：快照里能存的是 hex，不是文本
    expect(simhashToHex(v!)).not.toContain('giveaway');
  });

  it('短文本（<12 字符）不产 SimHash', () => {
    expect(textToSimhash('hi')).toBeNull();
  });

  it('非法 hex 输入返回 null', () => {
    expect(simhashFromHex('zzzz')).toBeNull();
    expect(simhashFromHex('1234567890abcdef1')).toBeNull();
  });
});

describe('simhash 与指纹 API 的关系', () => {
  it('contentFingerprint 输出形状仍是 16 位 hex（精确指纹语义不变）', () => {
    const fp = contentFingerprint({ text: TEMPLATE });
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
  });

  it('fingerprintText 与 textToSimhash 是同一机制（v0.5 起指纹即 SimHash）', () => {
    expect(contentFingerprint({ text: TEMPLATE })).toBe(
      simhashToHex(textToSimhash(TEMPLATE)!),
    );
  });
});
