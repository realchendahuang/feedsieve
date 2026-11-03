import { describe, expect, it } from 'vitest';
import { compileMuteRules, matchMuteRules } from './matcher';

function firstMatch(phrases: string[], text: string) {
  const rules = compileMuteRules(
    phrases.map((phrase, index) => ({
      id: String(index),
      phrase,
      enabled: true,
    })),
  );
  return matchMuteRules(rules, text)?.phrase ?? null;
}

describe('屏蔽词匹配', () => {
  it('英文整词匹配，不误伤更长的单词', () => {
    expect(firstMatch(['AI'], 'AI Agent')).toBe('AI');
    expect(firstMatch(['AI'], 'AI-powered tools')).toBe('AI');
    expect(firstMatch(['AI'], 'said it')).toBeNull();
    expect(firstMatch(['adult'], 'Adulthood')).toBeNull();
  });

  it('英文短语允许词之间出现标点', () => {
    expect(firstMatch(['free airdrop'], 'FREE - airdrop')).toBe('free airdrop');
  });

  it('中文按去空白、标点后的子串匹配', () => {
    expect(firstMatch(['同城约'], '同 城 约，今晚')).toBe('同城约');
    expect(firstMatch(['原神'], '原神，启动')).toBe('原神');
    expect(firstMatch(['原神'], '原来神明也会累')).toBeNull();
  });

  it('忽略大小写、全半角和零宽字符', () => {
    expect(firstMatch(['AI'], 'ＡＩ　工具')).toBe('AI');
    expect(firstMatch(['USDT空投'], 'USDT\u200b空投')).toBe('USDT空投');
  });

  it('带前缀的话题和用户名按整词匹配', () => {
    expect(firstMatch(['#AI'], '#AI 话题')).toBe('#AI');
    expect(firstMatch(['#AI'], 'AI 话题')).toBeNull();
    expect(firstMatch(['@spam'], 'hello @spam')).toBe('@spam');
  });

  it('停用规则不参与匹配', () => {
    const rules = compileMuteRules([
      { id: '1', phrase: '加微信', enabled: false },
      { id: '2', phrase: '加V', enabled: true },
    ]);
    expect(matchMuteRules(rules, '加微信 加V')?.phrase).toBe('加V');
  });

  it('命中多条时返回第一条', () => {
    expect(firstMatch(['加微信', '加V'], '加微信 加V')).toBe('加微信');
  });

  it('只有标点的规则编译不通过，空文本不命中', () => {
    expect(compileMuteRules([{ id: '1', phrase: '!!!', enabled: true }])).toHaveLength(0);
    expect(firstMatch(['AI'], '   ')).toBeNull();
  });
});
