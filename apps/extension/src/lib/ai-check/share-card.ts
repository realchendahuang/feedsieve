/**
 * AI 味报告分享图（纯前端 Canvas，离线生成，不上传）。1080×1080 正方形：
 * 长锐评最多三行也留得下，发 X/朋友圈/聊天都清楚。
 * 图里不放被检测账号的回复原文，只放结论、档位、锐评和统计数字。
 *
 * 版式：内容按 LAYOUT 自上而下固定，间距只用 GAP 那几档。方形化那一版把留白一路压到
 * 8px（徽章贴锐评）、19px（页脚贴底边），整张卡看起来「哪哪都挤」，所以这里把位置和
 * 间距都收进常量，改版式时不要再手写裸数字。
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
const H = 1080;

/** 版式节奏：相邻内容块的最小间距只用这几档，避免再出现 8px 这种「贴脸」缝。 */
const GAP = { sm: 24, md: 32, lg: 44, xl: 56 } as const;

const TONE = {
  ai: { accent: '#ff4d6d', glow: 'rgba(255, 77, 109, 0.35)' },
  mixed: { accent: '#ffb020', glow: 'rgba(255, 176, 32, 0.32)' },
  human: { accent: '#22d39b', glow: 'rgba(34, 211, 155, 0.32)' },
} as const;

const TEXT = {
  zh: {
    title: 'AI 味检测报告',
    samples: '回复样本',
    samplesUnit: '条',
    gap: '回复间隔',
    spread: '长短波动',
    spreadHigh: '大',
    spreadMid: '中',
    spreadLow: '小',
    footer: '福滤娃 FeedSieve · feedsieve.win',
    note: '判定与锐评可能有误差 · 仅供娱乐参考',
    human: '人味',
    samplesWithin: (span: string) => `回复样本（${span}内）`,
    sampleValue: (n: number, authors: number | null) =>
      authors ? `${n} 条 · ${authors} 人` : `${n} 条`,
  },
  en: {
    title: 'AI Flavor Report',
    samples: 'Replies',
    samplesUnit: '',
    gap: 'Gap',
    spread: 'Variety',
    spreadHigh: 'High',
    spreadMid: 'Mid',
    spreadLow: 'Low',
    footer: 'FeedSieve · feedsieve.win',
    note: 'Model-judged, may be wrong. For fun only.',
    human: 'Human',
    samplesWithin: (span: string) => `Replies (last ${span})`,
    sampleValue: (n: number, authors: number | null) =>
      authors ? `${n} · ${authors} people` : String(n),
  },
} as const;

const PAD = 80;
/** 内容区宽度（左右各留 PAD） */
const CONTENT_W = W - PAD * 2;

/**
 * 内容块位置（自顶向下）。上半区：抬头 → 账号 → 大数字 → 刻度条；
 * 下半区：锐评引用块 → 统计 → 页脚。锐评块与统计、页脚是钉死的，
 * 锐评两行还是三行都不挪位置，转发出去的卡面观感才一致。
 */
const LAYOUT = {
  titleBase: 104,
  avatarY: 138,
  avatarSize: 104,
  numberBase: 450,
  numberSize: 212,
  percentSize: 92,
  barY: 496,
  barH: 16,
  barLabelSize: 20,
  barLabelBase: 554,
  quoteY: 600,
  quoteH: 228,
  /** 单行锐评用矮盒，免得一行字撑一个 228 的空盒子 */
  quoteSingleH: 130,
  /** 锐评块上下内边距：决定字号能用到多高 */
  quotePadV: 24,
  /** 锐评块内左侧留白：强调线 18 + 线宽 4 + 与文字的间距 22 */
  quotePadX: 44,
  statsLabelBase: 892,
  statsValueBase: 944,
  ruleY: 984,
  footerBase: 1024,
} as const;

/**
 * 锐评字号档（从大到小）：短句用大字撑住，长句降号保三行。
 * 行高取字号的 1.33 倍上下，跟着字号一起降。
 */
const ROAST_SIZES: Array<[size: number, lineH: number]> = [
  [52, 70],
  [46, 62],
  [42, 56],
  [40, 54],
  [38, 52],
];

const LEVEL_CHIP_SIZES = [46, 40, 34];

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

/**
 * 锐评排版：按字号从大到小试，取第一个「装得下且没有孤行」的档。
 * - 装得下 = 不超过三行、且整块高度不超出引用块内高；
 * - 没有孤行 = 末行字数不少于首行的四分之一（否则会出现一行只剩「。」的孤行）；
 * - 短句（一行就放得下）会用最大的 52px，避免一行小字撑一个大空盒。
 * 全部不合格才挑折行最少的档位截断三行（服务端 comment 限 60 字，这是兜底路径）。
 */
function fitRoast(
  ctx: CanvasRenderingContext2D,
  text: string,
  width: number,
): { size: number; lineH: number; lines: string[] } {
  const innerH = LAYOUT.quoteH - LAYOUT.quotePadV * 2;
  const measured = ROAST_SIZES.map(([size, lineH]) => {
    ctx.font = `600 ${size}px ${FONT}`;
    const lines = wrap(ctx, text, width, 99);
    return { size, lineH, lines, blockH: (lines.length - 1) * lineH + size };
  });
  const fits = measured.find((c) => {
    if (c.lines.length > 3 || c.blockH > innerH) return false;
    if (c.lines.length === 1) return true;
    const first = [...c.lines[0]!].length;
    const last = [...c.lines[c.lines.length - 1]!].length;
    return last / first >= 0.25;
  });
  if (fits) return fits;
  // 兜底：挑折行最少的档位再截断三行，尽量少丢字
  const fewest = measured.reduce((a, b) => (b.lines.length < a.lines.length ? b : a));
  ctx.font = `600 ${fewest.size}px ${FONT}`;
  return { ...fewest, lines: wrap(ctx, text, width, 3) };
}

export function drawShareCard(input: ShareCardInput): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const t = TEXT[input.lang];
  const tone = TONE[input.flavor.tone];
  const pad = PAD;

  // 背景：深色底 + 档位色的光晕
  ctx.fillStyle = '#0b0d12';
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.78, 300, 40, W * 0.78, 300, 760);
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

  ctx.textBaseline = 'alphabetic';

  // 抬头：标题 + 日期
  ctx.fillStyle = tone.accent;
  ctx.font = `700 34px ${FONT}`;
  ctx.fillText(t.title, pad, LAYOUT.titleBase);
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.font = `500 30px ${FONT}`;
  const date = input.date.toISOString().slice(0, 10);
  ctx.textAlign = 'right';
  ctx.fillText(date, W - pad, LAYOUT.titleBase);
  ctx.textAlign = 'left';

  // 账号：头像 + 名字 + @id
  const avatarSize = LAYOUT.avatarSize;
  const avatarX = pad;
  const avatarY = LAYOUT.avatarY;
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
    ctx.font = `800 48px ${FONT}`;
    ctx.textAlign = 'center';
    const initial = [...(input.displayName?.trim() || input.handle)][0]?.toUpperCase() ?? '?';
    ctx.fillText(initial, cx, cy + 17);
    ctx.textAlign = 'left';
  }
  ctx.restore();
  ctx.strokeStyle = tone.accent;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(cx, cy, avatarSize / 2 + 6, 0, Math.PI * 2);
  ctx.stroke();

  const textX = avatarX + avatarSize + 32;
  const textW = W - pad - textX;
  ctx.fillStyle = '#ffffff';
  ctx.font = `800 54px ${FONT}`;
  const name = input.displayName?.trim() || `@${input.handle}`;
  ctx.fillText(wrap(ctx, name, textW, 1)[0] ?? name, textX, avatarY + 52);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = `600 34px ${FONT}`;
  ctx.fillText(`@${input.handle}`, textX, avatarY + 96);

  // 大百分比：不再配「AI 味」小标签——标题、刻度条两端、档位徽章已经在说同一件事，
  // 删掉这一行省下的 70px 直接还给下半区。
  ctx.fillStyle = tone.accent;
  ctx.font = `900 ${LAYOUT.numberSize}px ${FONT}`;
  const pct = String(input.flavor.percent);
  ctx.fillText(pct, pad - 6, LAYOUT.numberBase);
  const pctWidth = ctx.measureText(pct).width;
  ctx.font = `800 ${LAYOUT.percentSize}px ${FONT}`;
  ctx.fillText('%', pad + pctWidth + 2, LAYOUT.numberBase);
  const numberRight = pad - 6 + pctWidth + 2 + ctx.measureText('%').width;

  // 档位徽章：跟在「90%」右边、按数字基线对齐，读起来是「数字 + 结论」一个整体，
  // 也不再压在锐评头顶。英文长档名 / 100% 这类占满宽度的组合降一号字，
  // 最差退化成纯色文字，避免和数字叠在一起。
  let chipSize = 0;
  let chipW = 0;
  for (const size of LEVEL_CHIP_SIZES) {
    ctx.font = `800 ${size}px ${FONT}`;
    const width = ctx.measureText(input.flavor.level).width + size * 1.2;
    if (numberRight + GAP.lg + width <= W - pad) {
      chipSize = size;
      chipW = width;
      break;
    }
  }
  if (chipSize > 0) {
    const chipH = Math.round(chipSize * 1.7);
    const chipX = numberRight + GAP.lg;
    const chipY = LAYOUT.numberBase - chipH;
    ctx.fillStyle = tone.accent;
    roundRect(ctx, chipX, chipY, chipW, chipH, chipH / 2);
    ctx.fill();
    ctx.fillStyle = '#0b0d12';
    ctx.font = `800 ${chipSize}px ${FONT}`;
    ctx.fillText(input.flavor.level, chipX + chipSize * 0.6, chipY + chipH * 0.69);
  } else {
    ctx.fillStyle = tone.accent;
    ctx.font = `800 34px ${FONT}`;
    ctx.fillText(input.flavor.level, numberRight + GAP.sm, LAYOUT.numberBase - 10);
  }

  // 刻度条：左人味、右 AI 味，两端小字压到 20px 贴在条下
  const barY = LAYOUT.barY;
  const barW = CONTENT_W;
  const grad = ctx.createLinearGradient(pad, 0, pad + barW, 0);
  grad.addColorStop(0, TONE.human.accent);
  grad.addColorStop(0.5, TONE.mixed.accent);
  grad.addColorStop(1, TONE.ai.accent);
  ctx.fillStyle = grad;
  roundRect(ctx, pad, barY, barW, LAYOUT.barH, LAYOUT.barH / 2);
  ctx.fill();
  const markerX = pad + (barW * input.flavor.percent) / 100;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(markerX, barY + LAYOUT.barH / 2, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.font = `500 ${LAYOUT.barLabelSize}px ${FONT}`;
  ctx.fillText(t.human, pad, LAYOUT.barLabelBase);
  ctx.textAlign = 'right';
  ctx.fillText('AI', pad + barW, LAYOUT.barLabelBase);
  ctx.textAlign = 'left';

  // 锐评：装进浅底引用块 + 左侧档位色强调线，三行字收成「一个块」，
  // 不再是一串贴在徽章下面的行，视觉上也就没那么糊。单行锐评用矮盒，别撑出空盒子。
  // 只画模型给的锐评：没有就不画这块，不拿手写文案兜底。
  if (input.comment) {
    const roastX = pad + LAYOUT.quotePadX;
    const roastW = CONTENT_W - LAYOUT.quotePadX - 32;
    const roast = fitRoast(ctx, `「${input.comment}」`, roastW);
    const quoteH = roast.lines.length > 1 ? LAYOUT.quoteH : LAYOUT.quoteSingleH;
    // 矮盒在常规高度里居中，单行锐评不会贴住刻度条、也不至于在下半区挖个洞
    const quoteY = LAYOUT.quoteY + (LAYOUT.quoteH - quoteH) / 2;

    ctx.fillStyle = 'rgba(255,255,255,0.045)';
    roundRect(ctx, pad, quoteY, CONTENT_W, quoteH, 26);
    ctx.fill();
    ctx.fillStyle = tone.accent;
    roundRect(ctx, pad + 18, quoteY + 24, 4, quoteH - 48, 2);
    ctx.fill();

    const blockH = (roast.lines.length - 1) * roast.lineH + roast.size;
    const blockTop = quoteY + (quoteH - blockH) / 2;
    ctx.fillStyle = '#ffffff';
    ctx.font = `600 ${roast.size}px ${FONT}`;
    roast.lines.forEach((line, i) => {
      ctx.fillText(line, roastX, blockTop + roast.size * 0.88 + i * roast.lineH);
    });
  }

  // 统计
  const stats: Array<[string, string]> = [
    [
      input.spanS ? t.samplesWithin(formatGap(input.spanS, input.lang)) : t.samples,
      t.sampleValue(input.replyCount, input.authors ?? null),
    ],
    [t.gap, formatGap(input.medianGapS, input.lang)],
    [t.spread, spreadLabel(input.cv, input.lang)],
  ];
  const colW = CONTENT_W / 3;
  stats.forEach(([label, value], i) => {
    const x = pad + i * colW;
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = `500 27px ${FONT}`;
    ctx.fillText(label, x, LAYOUT.statsLabelBase);
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 40px ${FONT}`;
    ctx.fillText(value, x, LAYOUT.statsValueBase);
  });

  // 页脚
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(pad, LAYOUT.ruleY, CONTENT_W, 2);
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = `700 27px ${FONT}`;
  ctx.fillText(t.footer, pad, LAYOUT.footerBase);
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.font = `500 22px ${FONT}`;
  ctx.textAlign = 'right';
  ctx.fillText(t.note, W - pad, LAYOUT.footerBase);
  ctx.textAlign = 'left';
  return canvas;
}
