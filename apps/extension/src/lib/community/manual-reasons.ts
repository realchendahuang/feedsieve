/**
 * 手动拉黑的原因：推文动作栏的拉黑图标与弹窗「漏网账号」共用。
 *
 * 原因就是社区票的 category，服务端按 @feedsieve/shared 的分类词表校验。
 * 「仅拉黑」不选原因（null），只做本地拉黑，不参与社区计票。
 * 这里不再默认写 other —— 不选原因就不投票，避免「5 人标记 · 原因未细分」继续堆积。
 */
import { categoryLabel, type Category } from '@feedsieve/shared';
import type { UiLanguage } from '../platform/i18n';

/** 展示顺序按常见程度排，不是 CATEGORIES 的 canonical 顺序。 */
export const MANUAL_REPORT_REASONS = [
  'advertising',
  'scam_phishing',
  'adult_gray_traffic',
  'bot_spam',
  'copy_paste',
  'ai_slop',
  'engagement_bait',
  'other',
] as const satisfies readonly Category[];

export type ManualReportReason = (typeof MANUAL_REPORT_REASONS)[number];

export function isManualReportReason(value: unknown): value is ManualReportReason {
  return typeof value === 'string' && (MANUAL_REPORT_REASONS as readonly string[]).includes(value);
}

/** 选择器文案：other 在这里是「其他垃圾」，比分类词表里的「垃圾账号」更像一个具体选项。 */
export function manualReasonLabel(reason: ManualReportReason, language: UiLanguage): string {
  if (reason === 'other') {
    return language === 'zh' ? '其他垃圾' : 'Other spam';
  }
  return categoryLabel(reason, language);
}
