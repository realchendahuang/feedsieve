import { CATEGORIES } from '@feedsieve/shared';
import { describe, expect, it } from 'vitest';
import {
  isManualReportReason,
  MANUAL_REPORT_REASONS,
  manualReasonLabel,
} from './manual-reasons';

describe('手动拉黑原因', () => {
  it('覆盖分类词表里的每个分类，一个也不漏', () => {
    expect([...MANUAL_REPORT_REASONS].sort()).toEqual([...CATEGORIES].sort());
  });

  it('只接受分类值，personal / 空值 / 旧字段都不算原因', () => {
    for (const reason of MANUAL_REPORT_REASONS) {
      expect(isManualReportReason(reason)).toBe(true);
    }
    expect(isManualReportReason('personal')).toBe(false);
    expect(isManualReportReason(undefined)).toBe(false);
    expect(isManualReportReason(null)).toBe(false);
    expect(isManualReportReason('')).toBe(false);
  });

  it('选择器里的 other 是「其他垃圾」，不是含糊的「其他」', () => {
    expect(manualReasonLabel('other', 'zh')).toBe('其他垃圾');
    expect(manualReasonLabel('other', 'en')).toBe('Other spam');
    expect(manualReasonLabel('advertising', 'zh')).toBe('广告号');
    expect(manualReasonLabel('scam_phishing', 'en')).toBe('Scams');
  });
});
