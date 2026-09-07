import { describe, expect, it } from 'vitest';
import {
  SIMHASH_HAMMING_THRESHOLD,
  hammingDistance,
  isSimhashV1,
  simhashFromHex,
  simhashToHex,
  simhashTokensV1,
  textToSimhash,
  textToSimhashV1,
} from './simhash';
import { contentFingerprint, contentFingerprintV1, fingerprintTextV1 } from './fingerprint';

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

describe('simhash v1: 版本位与输出形状（v0.8）', () => {
  it('v1 输出仍是 16 位 hex，且高 4 bit 为版本标记 0x3（恒以 3 开头）', () => {
    const v = textToSimhashV1(TEMPLATE);
    expect(v).not.toBeNull();
    const hex = simhashToHex(v!);
    expect(hex).toMatch(/^[0-9a-f]{16}$/);
    expect(hex.startsWith('3')).toBe(true);
  });

  it('isSimhashV1 按高 4 bit 判定', () => {
    expect(isSimhashV1('3fffffffffffffff')).toBe(true);
    expect(isSimhashV1('afffffffffffffff')).toBe(false);
  });

  it('v1 与 v0 是不同版本：同一模板的 v1 值不等于 v0 值', () => {
    expect(contentFingerprintV1({ text: TEMPLATE })).not.toBe(contentFingerprint({ text: TEMPLATE }));
  });
});

describe('simhash v1: 变体识别', () => {
  it('相同模板的 v1 汉明距离为 0（全角/半角折叠后一致）', () => {
    const a = textToSimhashV1(TEMPLATE);
    const b = textToSimhashV1(VARIANT);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    // TEMPLATE 与 VARIANT 只是换 handle/URL/emoji，归一化后相同 -> 距离 0
    expect(hammingDistance(a!, b!)).toBe(0);
  });

  it('v1 尾部追加变体距离 <= 阈值（换号换链路之外的真实变体形态）', () => {
    const a = textToSimhashV1('claim 500 USDT giveaway on Tron follow repost');
    const b = textToSimhashV1('claim 500 USDT giveaway on Tron follow repost now');
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(hammingDistance(a!, b!)).toBeLessThanOrEqual(SIMHASH_HAMMING_THRESHOLD);
  });

  it('中段换词不误判为变体（旧退化哈希下 ≤2 是噪声假象；模板变体以换号/换链路为主）', () => {
    const a = textToSimhashV1('claim 500 USDT giveaway on Tron follow repost');
    const c = textToSimhashV1('claim 500 USDT giveaway at Tron follow repost');
    expect(a).not.toBeNull();
    expect(c).not.toBeNull();
    expect(hammingDistance(a!, c!)).toBeGreaterThan(SIMHASH_HAMMING_THRESHOLD);
  });

  it('语义不同的模板距离 > 阈值（不误报）', () => {
    const a = textToSimhashV1(TEMPLATE);
    const c = textToSimhashV1(DIFFERENT_TEMPLATE);
    expect(a).not.toBeNull();
    expect(c).not.toBeNull();
    expect(hammingDistance(a!, c!)).toBeGreaterThan(SIMHASH_HAMMING_THRESHOLD);
  });
});

describe('simhash v1: 停用字与短话术', () => {
  it('中文停用字 gram 被过滤：纯停用字文本不产任何 token', () => {
    expect(simhashTokensV1('的了是在我你他她它们有和就都')).toEqual([]);
  });

  it('短隐语（>=8 字符）可产 v1 指纹（v0 的 12 字符门槛挡住它）', () => {
    expect(textToSimhash('我福不黑不信你看')).toBeNull();
    const v = textToSimhashV1('我福不黑不信你看');
    expect(v).not.toBeNull();
    expect(simhashToHex(v!)).toMatch(/^3[0-9a-f]{15}$/);
  });

  it('更短的话术仍不产指纹（区分度不足）', () => {
    expect(textToSimhashV1('加我微信')).toBeNull();
    expect(textToSimhashV1('')).toBeNull();
  });

  it('不同短话术指纹互异（碰撞防护）', () => {
    const a = fingerprintTextV1('我福不黑不信你看');
    const b = fingerprintTextV1('我福不黑审查看看');
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a).not.toBe(b);
  });
});

describe('simhash v1: 哈希分布回归（防熵塌缩，v0.8）', () => {
  // 旧 token 哈希（XOR+轮转）实测 21/64 位恒定、两两距离均值 13、
  // 生产库 225 对假变体（阈值<=2）。本组测试把「位分布均匀」钉进 CI：
  // 任何让分布退化的改动都会在这里失败，而不是上线后污染 campaign 聚类。
  const WORDS = [
    'giveaway', 'crypto', 'airdrop', '关注我', '私聊', '加微信', 'telegram', '价格',
    '免费', '领取', '点击', '发财', '老师', '学员', '股票', '合约', '必涨', '福利',
    '红单', '上车', '大佬', '讲解', '教学', '赚钱', '轻松', '日入', '提现', '秒到',
    '同城', '上门', '全国空降', '我福不黑不信你看',
  ];
  // 固定种子 LCG：测试确定性，不依赖 Math.random
  let seed = 42;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const texts: string[] = [];
  for (let i = 0; i < 120; i++) {
    let s = '';
    const n = 6 + ((rnd() * 10) | 0);
    for (let j = 0; j < n; j++) s += WORDS[(rnd() * WORDS.length) | 0] + (rnd() < 0.3 ? ' ' : '');
    texts.push(s);
  }
  const values = texts
    .map((t) => textToSimhashV1(t))
    .filter((v): v is bigint => v !== null)
    .map((v) => simhashToHex(v));

  it('样本量充足（语料构造有效）', () => {
    expect(values.length).toBeGreaterThanOrEqual(100);
  });

  it('版本标记恒为 0x3，其余 60 位全部活跃（无恒定位）', () => {
    for (const hex of values) expect(hex.startsWith('3')).toBe(true);
    for (let b = 0; b < 60; b++) {
      const bit = 1n << BigInt(b);
      const ones = values.filter((hex) => (BigInt(`0x${hex}`) & bit) !== 0n).length;
      expect(ones, `bit ${b} 恒定`).toBeGreaterThan(0);
      expect(ones, `bit ${b} 恒定`).toBeLessThan(values.length);
    }
  });

  it('两两平均汉明距离接近均匀分布（~32，退化时 ~13）', () => {
    let sum = 0;
    let pairs = 0;
    for (let i = 0; i < values.length; i++) {
      for (let j = i + 1; j < values.length; j++) {
        sum += hammingDistance(BigInt(`0x${values[i]}`), BigInt(`0x${values[j]}`));
        pairs += 1;
      }
    }
    const mean = sum / pairs;
    expect(mean).toBeGreaterThan(20);
    expect(mean).toBeLessThan(44);
  });

  it('随机文本间无假变体（距离 <=2 的对数为 0）', () => {
    let near = 0;
    for (let i = 0; i < values.length; i++) {
      for (let j = i + 1; j < values.length; j++) {
        if (hammingDistance(BigInt(`0x${values[i]}`), BigInt(`0x${values[j]}`)) <= 2) near += 1;
      }
    }
    expect(near).toBe(0);
  });
});

describe('simhash v1: 金标向量（哈希重铸后冻结，改动即失败）', () => {
  it('短隐语指纹', () => {
    expect(fingerprintTextV1('我福不黑不信你看')).toBe('352806e09928c414');
  });

  it('NFKC 全角折叠：全角写法与半角写法指纹完全一致', () => {
    const wide = fingerprintTextV1('ｄｍ　ｍｅ　５００ usdt giveaway');
    const narrow = fingerprintTextV1('dm me 500 usdt giveaway');
    expect(wide).toBe('3b0bd895d48e5884');
    expect(wide).toBe(narrow);
  });
});
