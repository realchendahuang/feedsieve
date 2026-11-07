/**
 * AI 味报告分享图（纯前端 Canvas，离线生成，不上传）。1080×1350（4:5），发 X 时不被裁。
 * 图里不放被检测账号的回复原文，只放结论、档位、锐评和统计数字。
 */
import type { Flavor, Lang } from '@feedsieve/shared';
import { CARD_FONT as FONT, roundRect, wrapText as wrap } from '../share/canvas-kit';

export interface ShareCardInput {
  handle: string;
  displayName?: string;
  /** 头像（loadAvatar 读好的位图）；读不到就画首字母圆 */
  avatar?: CanvasImageSource | null;
  /** 回给了几个不同的人 */
  authors?: number | null;
  /** 样本跨越的秒数 */
  spanS?: number | null;
  flavor: Flavor;
  /** 判定模型给的一句话锐评；没有就用本地档位评语 */
  comment?: string | null;
  replyCount: number;
  medianGapS: number | null;
  cv: number;
  lang: Lang;
  date: Date;
}

const W = 1080;
const H = 1350;

const TONE = {
  ai: { accent: '#ff4d6d', glow: 'rgba(255, 77, 109, 0.35)' },
  mixed: { accent: '#ffb020', glow: 'rgba(255, 176, 32, 0.32)' },
  human: { accent: '#22d39b', glow: 'rgba(34, 211, 155, 0.32)' },
} as const;

const TEXT = {
  zh: {
    title: 'AI 味检测报告',
    flavor: 'AI 味',
    samples: '回复样本',
    samplesUnit: '条',
    gap: '回复间隔',
    spread: '长短波动',
    spreadHigh: '大',
    spreadMid: '中',
    spreadLow: '小',
    footer: '福滤娃 FeedSieve · feedsieve.win',
    note: '由模型根据公开回复判定与锐评，可能有误差，仅供娱乐参考',
    human: '人味',
    samplesWithin: (span: string) => `回复样本（${span}内）`,
    sampleValue: (n: number, authors: number | null) =>
      authors ? `${n} 条 · ${authors} 人` : `${n} 条`,
  },
  en: {
    title: 'AI Flavor Report',
    flavor: 'AI flavor',
    samples: 'Replies',
    samplesUnit: '',
    gap: 'Gap',
    spread: 'Variety',
    spreadHigh: 'High',
    spreadMid: 'Mid',
    spreadLow: 'Low',
    footer: 'FeedSieve · feedsieve.win',
    note: 'Model-judged and roasted from public replies. For fun only.',
    human: 'Human',
    samplesWithin: (span: string) => `Replies (last ${span})`,
    sampleValue: (n: number, authors: number | null) =>
      authors ? `${n} · ${authors} people` : String(n),
  },
} as const;

export function formatGap(seconds: number | null, lang: Lang): string {
  if (seconds === null) return '—';
  if (seconds < 90) return lang === 'zh' ? `${seconds} 秒` : `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return lang === 'zh' ? `${minutes} 分钟` : `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return lang === 'zh' ? `${hours} 小时` : `${hours}h`;
  return lang === 'zh' ? `${Math.round(hours / 24)} 天` : `${Math.round(hours / 24)}d`;
}

export function spreadLabel(cv: number, lang: Lang): string {
  const t = TEXT[lang];
  return cv >= 0.6 ? t.spreadHigh : cv >= 0.35 ? t.spreadMid : t.spreadLow;
}

export function drawShareCard(input: ShareCardInput): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const t = TEXT[input.lang];
  const tone = TONE[input.flavor.tone];

  // 背景：深色底 + 档位色的光晕
  ctx.fillStyle = '#0b0d12';
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.75, 260, 40, W * 0.75, 260, 820);
  glow.addColorStop(0, tone.glow);
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  // 细网格，像检测仪
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 54) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = 0; y <= H; y += 54) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  const pad = 88;
  ctx.textBaseline = 'alphabetic';

  // 抬头
  ctx.fillStyle = tone.accent;
  ctx.font = `700 34px ${FONT}`;
  ctx.fillText(t.title, pad, 138);
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.font = `500 30px ${FONT}`;
  const date = input.date.toISOString().slice(0, 10);
  ctx.textAlign = 'right';
  ctx.fillText(date, W - pad, 138);
  ctx.textAlign = 'left';

  // 账号：头像 + 名字 + @id
  const avatarSize = 132;
  const avatarX = pad;
  const avatarY = 182;
  const cx = avatarX + avatarSize / 2;
  const cy = avatarY + avatarSize / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, avatarSize / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (input.avatar) {
    ctx.drawImage(input.avatar, avatarX, avatarY, avatarSize, avatarSize);
  } else {
    ctx.fillStyle = '#1f2430';
    ctx.fillRect(avatarX, avatarY, avatarSize, avatarSize);
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 60px ${FONT}`;
    ctx.textAlign = 'center';
    const initial = [...(input.displayName?.trim() || input.handle)][0]?.toUpperCase() ?? '?';
    ctx.fillText(initial, cx, cy + 21);
    ctx.textAlign = 'left';
  }
  ctx.restore();
  ctx.strokeStyle = tone.accent;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(cx, cy, avatarSize / 2 + 7, 0, Math.PI * 2);
  ctx.stroke();

  const textX = avatarX + avatarSize + 40;
  const textW = W - pad - textX;
  ctx.fillStyle = '#ffffff';
  ctx.font = `800 58px ${FONT}`;
  const name = input.displayName?.trim() || `@${input.handle}`;
  ctx.fillText(wrap(ctx, name, textW, 1)[0] ?? name, textX, avatarY + 66);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = `600 36px ${FONT}`;
  ctx.fillText(`@${input.handle}`, textX, avatarY + 120);

  // 大百分比
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = `600 40px ${FONT}`;
  ctx.fillText(t.flavor, pad, 440);
  ctx.fillStyle = tone.accent;
  ctx.font = `900 260px ${FONT}`;
  const pct = String(input.flavor.percent);
  ctx.fillText(pct, pad - 8, 680);
  const pctWidth = ctx.measureText(pct).width;
  ctx.font = `800 110px ${FONT}`;
  ctx.fillText('%', pad + pctWidth + 4, 680);

  // 刻度条：左人味、右 AI 味
  const barY = 740;
  const barW = W - pad * 2;
  const grad = ctx.createLinearGradient(pad, 0, pad + barW, 0);
  grad.addColorStop(0, TONE.human.accent);
  grad.addColorStop(0.5, TONE.mixed.accent);
  grad.addColorStop(1, TONE.ai.accent);
  ctx.fillStyle = grad;
  roundRect(ctx, pad, barY, barW, 18, 9);
  ctx.fill();
  const markerX = pad + (barW * input.flavor.percent) / 100;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(markerX, barY + 9, 20, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = `500 26px ${FONT}`;
  ctx.fillText(t.human, pad, barY + 64);
  ctx.textAlign = 'right';
  ctx.fillText('AI', pad + barW, barY + 64);
  ctx.textAlign = 'left';

  // 档位 + 锐评
  ctx.font = `800 56px ${FONT}`;
  const levelW = ctx.measureText(input.flavor.level).width + 64;
  ctx.fillStyle = tone.accent;
  roundRect(ctx, pad, 870, levelW, 92, 46);
  ctx.fill();
  ctx.fillStyle = '#0b0d12';
  ctx.fillText(input.flavor.level, pad + 32, 936);

  ctx.fillStyle = '#ffffff';
  ctx.font = `600 46px ${FONT}`;
  wrap(ctx, `「${input.comment ?? input.flavor.roast}」`, W - pad * 2, 3).forEach((line, i) => {
    ctx.fillText(line, pad, 1040 + i * 64);
  });

  // 统计
  const stats: Array<[string, string]> = [
    // 样本范围写进统计里：「回复样本（3 天内）15 条 · 9 人」，看得出结论的底气
    [
      input.spanS ? t.samplesWithin(formatGap(input.spanS, input.lang)) : t.samples,
      t.sampleValue(input.replyCount, input.authors ?? null),
    ],
    [t.gap, formatGap(input.medianGapS, input.lang)],
    [t.spread, spreadLabel(input.cv, input.lang)],
  ];
  const colW = (W - pad * 2) / 3;
  stats.forEach(([label, value], i) => {
    const x = pad + i * colW;
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = `500 28px ${FONT}`;
    ctx.fillText(label, x, 1190);
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 40px ${FONT}`;
    ctx.fillText(value, x, 1240);
  });

  // 页脚
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(pad, 1272, W - pad * 2, 2);
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = `700 28px ${FONT}`;
  ctx.fillText(t.footer, pad, 1318);
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.font = `500 22px ${FONT}`;
  ctx.textAlign = 'right';
  ctx.fillText(t.note, W - pad, 1318);
  ctx.textAlign = 'left';
  return canvas;
}
