import { describe, expect, it } from 'vitest';
import { computeScore } from '../src/lib/score';

describe('computeScore v1', () => {
  it('saturating curve: 3 reports = 0.5, more reports asymptote', () => {
    expect(computeScore({ reportCount: 1, rescueCount: 0, distinctDays: 1 })).toBe(0.25);
    expect(computeScore({ reportCount: 3, rescueCount: 0, distinctDays: 1 })).toBe(0.5);
    // 7 票单日触发爆发打折：0.7 × 0.8 = 0.56
    expect(computeScore({ reportCount: 7, rescueCount: 0, distinctDays: 1 })).toBe(0.56);
    // 17 票 3 天（无爆发）：0.85 + 0.04 = 0.89
    expect(computeScore({ reportCount: 17, rescueCount: 0, distinctDays: 3 })).toBe(0.89);
  });

  it('rescues deduct votes; fully rescued accounts score 0', () => {
    expect(computeScore({ reportCount: 3, rescueCount: 1, distinctDays: 1 })).toBe(
      computeScore({ reportCount: 2, rescueCount: 0, distinctDays: 1 }),
    );
    expect(computeScore({ reportCount: 3, rescueCount: 3, distinctDays: 5 })).toBe(0);
    expect(computeScore({ reportCount: 3, rescueCount: 10, distinctDays: 5 })).toBe(0);
  });

  it('multi-day presence adds up to +0.1', () => {
    // 7 票 3 天：0.7 + 2*0.02 = 0.74
    expect(computeScore({ reportCount: 7, rescueCount: 0, distinctDays: 3 })).toBe(0.74);
    // 封顶：7 票 100 天：0.7 + 0.1 = 0.8
    expect(computeScore({ reportCount: 7, rescueCount: 0, distinctDays: 100 })).toBe(0.8);
  });

  it('single-day burst (>=5 reports) takes an 0.8 penalty', () => {
    // 10 票 1 天：10/13 = 0.7692… → ×0.8 = 0.6154 → 0.62
    expect(computeScore({ reportCount: 10, rescueCount: 0, distinctDays: 1 })).toBe(0.62);
    // 同样 10 票分 3 天：无爆发打折，10/13 = 0.7692 + 0.04 = 0.81
    expect(computeScore({ reportCount: 10, rescueCount: 0, distinctDays: 3 })).toBe(0.81);
    // 4 票 1 天：不到爆发线，不打折
    expect(computeScore({ reportCount: 4, rescueCount: 0, distinctDays: 1 })).toBe(0.57);
  });

  it('clamps to [0, 1]', () => {
    expect(computeScore({ reportCount: 100, rescueCount: 0, distinctDays: 50 })).toBe(1);
  });
});
