import { describe, expect, it } from 'vitest';
import { aiCardOgSvg, wrapLines } from '../src/site/og';

describe('OG 锐评折行', () => {
  it('长锐评折成两行，不超宽', () => {
    const text =
      '「每条都是先肯定再补一句泛化建议，跨十二个人用同一副骨架，工整得像模板工厂流水线出来的。」';
    const lines = wrapLines(text, 650, 26, 3);
    expect(lines.length).toBeLessThanOrEqual(3);
    expect(lines.map((line) => [...line].length).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(
      [...text].length,
    );
  });

  it('超两行时第二行带省略号', () => {
    const long = '「' + '工'.repeat(120) + '」';
    const lines = wrapLines(long, 650, 26, 3);
    expect(lines).toHaveLength(3);
    expect(lines[2]!.endsWith('…')).toBe(true);
  });

  it('公开结论卡把模型锐评渲染成 text', () => {
    const svg = aiCardOgSvg({
      handle: 'demo',
      displayName: 'Demo',
      avatar: null,
      state: 'public',
      percent: 90,
      tone: 'ai',
      level: 'AI 味很冲',
      comment:
        '每条都是先肯定再补一句泛化建议，跨十二个人用同一副骨架，工整得像模板工厂流水线出来的。',
    });
    expect(svg).toContain('font-size="28"');
    expect(svg).not.toContain('undefined');
    expect((svg.match(/font-size="28"/g) ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it('判定依据用库里已有的字段：样本窗口 / 条数人数 / 间隔 / 长短波动 / 票数', () => {
    const svg = aiCardOgSvg({
      handle: 'demo',
      displayName: 'Demo',
      avatar: null,
      state: 'public',
      percent: 95,
      tone: 'ai',
      level: 'AI 感爆棚',
      replyCount: 10,
      sampleAuthors: 17,
      sampleSpan: 2760,
      medianGap: 120,
      cv: 0.72,
      judgedAt: 1794194980,
      aiVotes: 4,
      humanVotes: 1,
    });
    expect(svg).toContain('样本（最近 46 分钟内）');
    expect(svg).toContain('10 条 · 17 人');
    expect(svg).toContain('中位 2 分钟');
    expect(svg).toContain('长短波动');
    expect(svg).toContain('社区投票');
    expect(svg).toContain('AI 4 · 真人 1');
    expect(svg).toContain('2026-11-09');
    // 没有锐评就不画「」引语，也不出现占位空白
    expect(svg).not.toContain('「');
  });

  it('没判定数据的账号不画数据条', () => {
    const svg = aiCardOgSvg({
      handle: 'nobody',
      displayName: null,
      avatar: null,
      state: 'none',
    });
    expect(svg).toContain('还没人测');
    expect(svg).not.toContain('社区投票');
    expect(svg).not.toContain('undefined');
  });
});
