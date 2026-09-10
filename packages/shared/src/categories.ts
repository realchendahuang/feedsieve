/**
 * 举报/标注分类词表 —— 跨应用唯一权威源。
 *
 * 之前在 community-api validate.ts（服务端校验）、extension i18n.ts（用户文案）、
 * extension share-card.ts（战报顺序）各维护一份，本模块收敛后以本文件为准；
 * 各消费方必须零行为漂移地对齐到这里。
 */

/** 分类词表（canonical 顺序：战报明细、后台下拉、服务端校验共用同一顺序） */
export const CATEGORIES = [
  'bot_spam',
  'copy_paste',
  'ai_slop',
  'advertising',
  'adult_gray_traffic',
  'scam_phishing',
  'engagement_bait',
  'other',
] as const;

export type Category = (typeof CATEGORIES)[number];

export function isCategory(value: string): value is Category {
  return (CATEGORIES as readonly string[]).includes(value);
}

export type Locale = 'zh' | 'en';

/**
 * 用户可见分类文案。
 * `other` 是统计桶语境：分类为 other 的拉黑仍是垃圾账号（未细分），不显示「其他」。
 * 未知分类回退为原始字符串（调用方展示兜底，与历史行为一致）。
 */
const CATEGORY_LABELS: Record<Locale, Record<Category, string>> = {
  zh: {
    bot_spam: '机器人',
    copy_paste: '重复刷屏',
    ai_slop: 'AI 垃圾',
    advertising: '广告号',
    adult_gray_traffic: '色情引流',
    scam_phishing: '诈骗',
    engagement_bait: '互动钓鱼',
    other: '垃圾账号',
  },
  en: {
    bot_spam: 'Bots',
    copy_paste: 'Copy-paste',
    ai_slop: 'AI spam',
    advertising: 'Ads',
    adult_gray_traffic: 'Adult bait',
    scam_phishing: 'Scams',
    engagement_bait: 'Engagement bait',
    other: 'Spam',
  },
};

export function categoryLabel(category: string, locale: Locale = 'zh'): string {
  return CATEGORY_LABELS[locale][category as Category] ?? category;
}
