import { describe, expect, it } from 'vitest';
import { buildReportText, shareUrl } from './share-card';
import type { DailyStat } from './daily-stats';

const EMPTY: DailyStat = { blocked: 0, detected: 0, unblocked: 0, byCategory: {} };

describe('buildReportText', () => {
  it('空战报给空态文案（不鼓励硬分享）', () => {
    expect(buildReportText(EMPTY)).toContain('0 个垃圾号');
  });

  it('有拉黑时输出主句 + 分类明细（固定顺序）', () => {
    const stat: DailyStat = {
      blocked: 5,
      detected: 12,
      unblocked: 1,
      byCategory: { bot_spam: 2, scam_phishing: 1, copy_paste: 2 },
    };
    expect(buildReportText(stat)).toBe(
      '福滤娃今日战报：送走 5 个垃圾号（机器人 2 · 复读机 2 · 诈骗 1）',
    );
  });

  it('无分类明细时只输出主句', () => {
    const stat: DailyStat = { blocked: 3, detected: 0, unblocked: 0, byCategory: {} };
    expect(buildReportText(stat)).toBe('福滤娃今日战报：送走 3 个垃圾号');
  });

  it('未知分类被忽略（脏数据不破坏中文战报）', () => {
    const stat: DailyStat = {
      blocked: 1,
      detected: 0,
      unblocked: 0,
      byCategory: { weird_category: 1 },
    };
    expect(buildReportText(stat)).toBe('福滤娃今日战报：送走 1 个垃圾号');
  });
});

describe('shareUrl', () => {
  it('编码文案并指向 x.com intent', () => {
    const url = shareUrl('福滤娃今日战报：送走 5 个垃圾号');
    expect(url).toContain('https://x.com/intent/tweet?text=');
    expect(decodeURIComponent(url)).toContain('送走 5 个垃圾号');
  });
});
