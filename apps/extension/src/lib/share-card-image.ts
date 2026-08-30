/**
 * 分享卡片图片生成（v0.6 余项）：canvas 画品牌黄卡片。
 *
 * 尺寸 1200x630（X 分享卡片标准比例）。纯 canvas 2D，无外部依赖。
 * 文案来自 buildReportText（同一生成器，保证文字与图片一致）。
 * 隐私：卡片只含数字与分类，不含任何账号信息。
 */

import type { DailyStat } from './daily-stats';
import { buildReportText, CATEGORY_LABELS } from './share-card';
import { estimateTimeSaved } from './time-saved';

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

const YELLOW = '#f2c94c';
const YELLOW_DARK = '#d4a900';
const INK = '#3d3200';
const BG = '#fffbe6';
const MUTED = '#8a7500';

/** 生成卡片 canvas；调用方负责 toDataURL / toBlob。 */
export function drawReportCard(stat: DailyStat): HTMLCanvasElement {
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
  ctx.fillText('福滤娃今日战报', 72, 88);

  // 主句（送走 N 个）
  const reportText = buildReportText(stat);
  ctx.font = 'bold 44px system-ui, -apple-system, "PingFang SC", sans-serif';
  ctx.fillStyle = INK;
  ctx.fillText(reportText, 72, 200);

  // 分类明细（有才画）
  const parts: string[] = [];
  for (const [key, count] of Object.entries(stat.byCategory)) {
    if (count > 0) {
      parts.push(`${CATEGORY_LABELS[key] ?? key} ${count}`);
    }
  }
  if (parts.length > 0) {
    ctx.font = '36px system-ui, -apple-system, "PingFang SC", sans-serif';
    ctx.fillStyle = MUTED;
    ctx.fillText(parts.join(' · '), 72, 300);
  }

  // 省下时间（传播卖点）
  const saved = estimateTimeSaved(stat.detected);
  ctx.font = '36px system-ui, -apple-system, "PingFang SC", sans-serif';
  ctx.fillStyle = YELLOW_DARK;
  ctx.fillText(`替你少看了 ${saved.label} 垃圾时间`, 72, 380);

  // 底部品牌行
  ctx.font = '28px system-ui, -apple-system, "PingFang SC", sans-serif';
  ctx.fillStyle = MUTED;
  ctx.fillText('FeedSieve · 黄框标注，一键真拉黑', 72, 540);

  return canvas;
}
