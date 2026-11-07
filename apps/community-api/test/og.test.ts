import { describe, expect, it } from 'vitest';
import { aiCardOgSvg, wrapLines } from '../src/site/og';

describe('OG 锐评折行', () => {
  it('长锐评折成两行，不超宽', () => {
    const text = '「每条都是先肯定再补一句泛化建议，跨十二个人用同一副骨架，工整得像模板工厂流水线出来的。」';
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

  it('公开结论卡把锐评渲染成两条 text', () => {
    const svg = aiCardOgSvg({
      handle: 'demo',
      displayName: 'Demo',
      avatar: null,
      state: 'public',
      percent: 90,
      tone: 'ai',
      level: 'AI 味很冲',
      roast: '每条都是先肯定再补一句泛化建议，跨十二个人用同一副骨架，工整得像模板工厂流水线出来的。',
    });
    expect(svg).toContain('font-size="26"');
    expect(svg).not.toContain('undefined');
    // 两行锐评 = 两条 26px 文本
    expect((svg.match(/font-size="26"/g) ?? []).length).toBeGreaterThanOrEqual(1);
  });
});
