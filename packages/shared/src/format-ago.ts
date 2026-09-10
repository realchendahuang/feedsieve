/**
 * 相对时间文案（admin「刚刚」变体 + extension 中英文变体的唯一权威源）。
 *
 * 语义锚点（与两份历史实现逐一对齐，零漂移）：
 * - 输入为 Unix 秒；负值/未来值按 0 处理（显示「刚刚」）。
 * - <60s 刚刚 / just now；<1h N 分钟前 / Nm ago；
 *   <24h N 小时前 / Nh ago；≥24h N 天前 / Nd ago。
 */

import type { Locale } from './categories';

const AGO_LABELS: Record<Locale, { justNow: string; minutes: string; hours: string; days: string }> = {
  zh: { justNow: '刚刚', minutes: ' 分钟前', hours: ' 小时前', days: ' 天前' },
  en: { justNow: 'just now', minutes: 'm ago', hours: 'h ago', days: 'd ago' },
};

export function formatAgo(unixSeconds: number, locale: Locale = 'zh'): string {
  const t = AGO_LABELS[locale];
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);
  if (seconds < 60) return t.justNow;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}${t.minutes}`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}${t.hours}`;
  return `${Math.floor(seconds / 86400)}${t.days}`;
}
