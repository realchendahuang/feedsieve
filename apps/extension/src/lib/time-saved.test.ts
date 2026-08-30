import { describe, expect, it } from 'vitest';
import { estimateTimeSaved } from './time-saved';

describe('estimateTimeSaved', () => {
  it('0 条标注给「不到 1 分钟」', () => {
    expect(estimateTimeSaved(0).label).toBe('不到 1 分钟');
  });

  it('1-3 条给「不到 1 分钟」', () => {
    expect(estimateTimeSaved(1).label).toBe('不到 1 分钟');
    expect(estimateTimeSaved(3).label).toBe('不到 1 分钟');
  });

  it('4 条 = 1 分钟', () => {
    expect(estimateTimeSaved(4).label).toBe('约 1 分钟');
  });

  it('240 条 = 1 小时', () => {
    expect(estimateTimeSaved(240).label).toBe('约 1 小时');
  });

  it('300 条 = 1 小时 15 分钟', () => {
    expect(estimateTimeSaved(300).label).toBe('约 1 小时 15 分钟');
  });

  it('负数按 0 处理', () => {
    expect(estimateTimeSaved(-5).label).toBe('不到 1 分钟');
  });
});
