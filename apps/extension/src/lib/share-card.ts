/**
 * 战报分享文案生成器（v0.6）：纯函数，可单测。
 *
 * 文案克制原则：一行主句 + 分类明细（有才列），不堆形容词。
 * 分享走 x.com intent（用户已登录的页面，无需额外权限）。
 */

import type { DailyStat } from './daily-stats';
import { categoryLabel, type UiLanguage } from './i18n';

/** 贡献分类 -> 战报里的中文标签（与社区分类一一对应，2-4 字） */
/** 分类明细按固定顺序输出（确定性文案，测试可断言） */
const CATEGORY_ORDER = [
  'bot_spam',
  'copy_paste',
  'ai_slop',
  'advertising',
  'adult_gray_traffic',
  'scam_phishing',
  'engagement_bait',
  'other',
];

/**
 * 生成战报文案。示例：
 * 「福滤娃今日战报：送走 5 个垃圾号（机器人 2 · 诈骗 1 · 复读机 2）」
 * 无拉黑时给空态文案（不鼓励硬分享）。
 */
export function buildReportText(stat: DailyStat, language: UiLanguage = 'zh'): string {
  const total = stat.blocked;
  if (total <= 0) {
    return language === 'zh'
      ? '福滤娃今日战报：未发现垃圾账号'
      : 'FeedSieve today: no spam accounts blocked';
  }
  const parts: string[] = [];
  for (const key of CATEGORY_ORDER) {
    const count = stat.byCategory[key] ?? 0;
    if (count > 0) {
      parts.push(`${categoryLabel(key, language)} ${count}`);
    }
  }
  const detail =
    parts.length > 0
      ? language === 'zh'
        ? `（${parts.join(' · ')}）`
        : ` (${parts.join(' · ')})`
      : '';
  return language === 'zh'
    ? `福滤娃今日战报：已拉黑 ${total} 个垃圾账号${detail}`
    : `FeedSieve today: blocked ${total} spam account${total === 1 ? '' : 's'}${detail}`;
}

/** 分享链接：x.com intent（用户已登录，点开即发推）。 */
export function shareUrl(text: string): string {
  return `https://x.com/intent/tweet?text=${encodeURIComponent(text)}`;
}
