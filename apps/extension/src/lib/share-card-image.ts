/**
 * 分享卡片图片生成（v0.6 余项）：canvas 画品牌黄卡片。
 *
 * 尺寸 1200x630（X 分享卡片标准比例）。纯 canvas 2D，无外部依赖。
 * 文案来自 buildReportText（同一生成器，保证文字与图片一致）。
 * 隐私：卡片只含数字与分类，不含任何账号信息。
 */

import type { DailyStat } from './daily-stats';
import { buildReportText } from './share-card';
import { categoryLabel, type UiLanguage } from './i18n';
import { estimateTimeSaved } from './time-saved';

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

const YELLOW = '#f2c94c';
const YELLOW_DARK = '#d4a900';
const INK = '#3d3200';
const BG = '#fffbe6';
const MUTED = '#8a7500';

/** 生成卡片 canvas；调用方负责 toDataURL / toBlob。 */
export function drawReportCard(
  stat: DailyStat,
  language: UiLanguage = 'zh',
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return canvas;
  }

  // 背景：米黄 + 顶部黄条（品牌色）
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  ctx.fillStyle = YELLOW;
  ctx.fillRect(0, 0, CARD_WIDTH, 12);

  // 标题
  ctx.fillStyle = INK;
  ctx.font = 'bold 64px system-ui, -apple-system, "PingFang SC", sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText(language === 'zh' ? '福滤娃今日战报' : 'FeedSieve Daily Report', 72, 88);

  // 主句（送走 N 个）
  const reportText = buildReportText(stat, language);
  ctx.font = 'bold 44px system-ui, -apple-system, "PingFang SC", sans-serif';
  ctx.fillStyle = INK;
  ctx.fillText(reportText, 72, 200);

  // 分类明细（有才画）
  const parts: string[] = [];
  for (const [key, count] of Object.entries(stat.byCategory)) {
    if (count > 0) {
      parts.push(`${categoryLabel(key, language)} ${count}`);
    }
  }
  if (parts.length > 0) {
    ctx.font = '36px system-ui, -apple-system, "PingFang SC", sans-serif';
    ctx.fillStyle = MUTED;
    ctx.fillText(parts.join(' · '), 72, 300);
  }

  // 省下时间（传播卖点）
  const saved = estimateTimeSaved(stat.detected, language);
  ctx.font = '36px system-ui, -apple-system, "PingFang SC", sans-serif';
  ctx.fillStyle = YELLOW_DARK;
  ctx.fillText(
    language === 'zh'
      ? `少看了 ${saved.label} 垃圾内容`
      : `${saved.label} of spam avoided`,
    72,
    380,
  );

  // 底部品牌行
  ctx.font = '28px system-ui, -apple-system, "PingFang SC", sans-serif';
  ctx.fillStyle = MUTED;
  ctx.fillText(
    language === 'zh' ? '福滤娃 · 标注明确，拉黑可撤销' : 'FeedSieve · Clear marks, reversible blocks',
    72,
    540,
  );

  return canvas;
}
