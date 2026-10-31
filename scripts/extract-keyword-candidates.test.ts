import { describe, expect, it } from 'vitest';
import { extractKeywordCandidates } from './extract-keyword-candidates.mjs';

describe('维护者选词候选提取', () => {
  it('提取中文词、连续话术整段与拉丁词，过滤 URL/@/emoji/标点/数字', () => {
    const candidates = extractKeywordCandidates(
      '福利在主页 🍑🍑 私信我 @somebody https://t.co/xyz 500 USDT giveaway 全国空降',
      { top: 30 },
    );
    const phrases = candidates.map((c) => c.phrase);
    expect(phrases).toContain('福利');
    expect(phrases).toContain('福利在主页');
    expect(phrases).toContain('私信我');
    expect(phrases).toContain('全国空降');
    expect(phrases).toContain('usdt');
    expect(phrases).toContain('giveaway');
    for (const p of phrases) {
      expect(p).not.toMatch(/https|t\.co|@|🍑|^\d/);
    }
  });

  it('同一话术重复出现按频次浮顶', () => {
    const post = '点主页 专业牵线 全国1-5线覆盖';
    const candidates = extractKeywordCandidates(`${post}\n${post}\n点主页 福利自取`, { top: 10 });
    expect(candidates[0]?.count).toBe(3);
    expect(candidates[0]?.phrase.length).toBeGreaterThanOrEqual(2);
    expect(candidates.find((c) => c.phrase === '点主页')?.count).toBe(3);
    expect(candidates.find((c) => c.phrase === '专业牵线')?.count).toBe(2);
  });

  it('全噪音文本返回空（emoji/链接/标点堆）', () => {
    expect(extractKeywordCandidates('🍑🍑🍑🍑 https://t.co/x !!!')).toEqual([]);
  });

  it('拉丁词 ≥3 字母，短词丢弃', () => {
    const phrases = extractKeywordCandidates('crypto giveaway dm me now', { top: 10 }).map(
      (c) => c.phrase,
    );
    expect(phrases).toContain('crypto');
    expect(phrases).not.toContain('dm');
    expect(phrases).not.toContain('me');
  });
});
