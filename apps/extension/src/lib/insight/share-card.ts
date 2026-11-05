/**
 * 主页洞察分享图（纯前端 Canvas，离线生成，不上传）：1080×1350（4:5），发 X 时不被裁。
 * 上半是账号与基线（中位浏览、爆款率、覆盖），下半是最近三条帖子的正文摘要。
 * 口径不单独占一行：样本数就是「覆盖」那一格，跟界面上的 KPI 卡一一对应。
 */
import { OUTLIER_MULTIPLE, TIER_NAMES, type AccountTier } from '@feedsieve/metrics';
import type { UiLanguage } from '../platform/i18n';
import {
  CARD_FONT,
  drawAvatar,
  loadAvatar,
  measureTextWithFont,
  roundRect,
  wrapText,
} from '../share/canvas-kit';
import { cleanText, formatCount, formatMultipleText } from './format';
import type { CatalogPost } from './profile-catalog';

const W = 1080;
const H = 1350;
const PAD = 80;
const GOLD = '#ffd400';
const DIM = 'rgba(255,255,255,0.45)';
const BODY = 'rgba(255,255,255,0.92)';
const BLOCK_H = 200;
const BLOCK_GAP = 16;
/** 左列（倍数 + 浏览 + 赞）的视觉高度，用来和正文一起做垂直居中。 */
const LEFT_COLUMN_H = 118;

const TEXT = {
  zh: {
    title: '主页洞察',
    medianViews: '中位浏览',
    outlierRate: '爆款率',
    coverage: '覆盖',
    coverageUnit: '条',
    recent: '最近的帖子',
    views: '浏览',
    likes: '赞',
    noText: '（没有正文）',
    imageOnly: '（图片）',
    videoOnly: '（视频）',
    footer: '福滤娃 FeedSieve · feedsieve.win',
  },
  en: {
    title: 'Profile insight',
    medianViews: 'Median views',
    outlierRate: 'Outlier rate',
    coverage: 'Coverage',
    coverageUnit: 'posts',
    recent: 'Recent posts',
    views: 'views',
    likes: 'likes',
    noText: '(no text)',
    imageOnly: '(photo)',
    videoOnly: '(video)',
    footer: 'FeedSieve · feedsieve.win',
  },
} as const;

/** 分享卡里的三条帖子：回复不算主页表现，没浏览数的帖子画不出倍数，都跳过；按发出时间倒序。 */
export function pickSharePosts(posts: readonly CatalogPost[], limit = 3): CatalogPost[] {
  return posts
    .filter(
      (post) =>
        post.kind !== 'reply' &&
        post.views !== undefined &&
        post.views > 0 &&
        post.createdAt !== undefined,
    )
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
    .slice(0, limit);
}

/** 正文压成一行；纯媒体帖给个占位，别留空白。 */
export function snippetText(post: CatalogPost, lang: UiLanguage): string {
  const text = cleanText(post.snippet).replace(/\s+/g, ' ').trim();
  if (text) return text;
  const t = TEXT[lang];
  if (post.media === 'photo') return t.imageOnly;
  if (post.media === 'video' || post.media === 'gif') return t.videoOnly;
  return t.noText;
}

export interface ProfileSharePost {
  post: CatalogPost;
  /** 浏览是中位数的几倍；基线不够时为 null。 */
  multiple: number | null;
}

export interface ProfileShareInput {
  handle: string;
  displayName?: string;
  avatarUrl?: string;
  tier: AccountTier | null;
  medianViews: number | null;
  outlierRate: number | null;
  postCount: number;
  /** 已按时间倒序挑好，见 pickSharePosts。 */
  posts: readonly ProfileSharePost[];
  lang: UiLanguage;
  date: Date;
}

export async function drawProfileShareCard(input: ProfileShareInput): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const t = TEXT[input.lang];
  const avatar = await loadAvatar(input.avatarUrl);

  // 背景：深色底 + 右上角一点金光，再铺一层细网格
  ctx.fillStyle = '#0b0d12';
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.78, 150, 40, W * 0.78, 150, 720);
  glow.addColorStop(0, 'rgba(255, 212, 0, 0.16)');
  glow.addColorStop(1, 'rgba(255, 212, 0, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(255,255,255,0.035)';
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
  ctx.textAlign = 'left';

  // 抬头
  ctx.fillStyle = GOLD;
  ctx.font = `700 34px ${CARD_FONT}`;
  ctx.fillText(t.title, PAD, 104);
  ctx.fillStyle = DIM;
  ctx.font = `500 28px ${CARD_FONT}`;
  ctx.textAlign = 'right';
  ctx.fillText(input.date.toISOString().slice(0, 10), W - PAD, 104);
  ctx.textAlign = 'left';

  // 账号：头像 + 名字 + @id + 量级
  const avatarSize = 112;
  const initial = [...(input.displayName?.trim() || input.handle)][0]?.toUpperCase() ?? '?';
  drawAvatar(ctx, avatar, PAD, 146, avatarSize, initial, 'rgba(255, 212, 0, 0.7)');

  const nameX = PAD + avatarSize + 32;
  const name = input.displayName?.trim() || `@${input.handle}`;
  ctx.fillStyle = '#ffffff';
  ctx.font = `800 54px ${CARD_FONT}`;
  ctx.fillText(wrapText(ctx, name, W - PAD - nameX, 1)[0] ?? name, nameX, 206);

  const HANDLE_FONT = `600 32px ${CARD_FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.58)';
  ctx.font = HANDLE_FONT;
  const handleText = `@${input.handle}`;
  ctx.fillText(handleText, nameX, 252);

  const tierName = input.tier === null ? null : TIER_NAMES[input.tier][input.lang];
  if (tierName) {
    const TAG_FONT = `600 26px ${CARD_FONT}`;
    // 两个宽度各量各的字体：用徽章字号去量 32px 的 handle 会让徽章压到 handle 上
    const handleWidth = measureTextWithFont(ctx, handleText, HANDLE_FONT);
    const tagW = measureTextWithFont(ctx, tierName, TAG_FONT) + 36;
    const tagX = nameX + handleWidth + 20;
    ctx.font = TAG_FONT;
    roundRect(ctx, tagX, 220, tagW, 44, 22);
    ctx.strokeStyle = 'rgba(255, 212, 0, 0.45)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = GOLD;
    ctx.fillText(tierName, tagX + 18, 251);
  }

  // 主数字：中位浏览
  ctx.fillStyle = DIM;
  ctx.font = `600 30px ${CARD_FONT}`;
  ctx.fillText(t.medianViews, PAD, 330);
  if (input.medianViews !== null && input.medianViews > 0) {
    ctx.fillStyle = '#ffffff';
    ctx.font = `900 148px ${CARD_FONT}`;
    ctx.fillText(formatCount(Math.round(input.medianViews), input.lang), PAD, 470);
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = `900 130px ${CARD_FONT}`;
    ctx.fillText('—', PAD, 462);
  }

  // 右侧两格：爆款率、覆盖
  ctx.textAlign = 'right';
  ctx.fillStyle = DIM;
  ctx.font = `600 26px ${CARD_FONT}`;
  ctx.fillText(t.outlierRate, W - PAD, 368);
  ctx.font = `800 54px ${CARD_FONT}`;
  ctx.fillStyle = input.outlierRate === null ? 'rgba(255,255,255,0.35)' : GOLD;
  ctx.fillText(
    input.outlierRate === null ? '—' : `${Math.round(input.outlierRate * 100)}%`,
    W - PAD,
    424,
  );
  ctx.fillStyle = DIM;
  ctx.font = `600 26px ${CARD_FONT}`;
  ctx.fillText(t.coverage, W - PAD, 480);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = `700 40px ${CARD_FONT}`;
  ctx.fillText(`${input.postCount} ${t.coverageUnit}`, W - PAD, 522);
  ctx.textAlign = 'left';

  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(PAD, 556, W - PAD * 2, 2);

  // 最近三条帖子
  ctx.fillStyle = DIM;
  ctx.font = `600 30px ${CARD_FONT}`;
  ctx.fillText(t.recent, PAD, 610);

  let y = 628;
  for (const item of input.posts.slice(0, 3)) {
    // 先量正文行数：内容（正文或左列，取高的那个）在块内垂直居中，短帖不会空在下面
    const textX = 300;
    ctx.font = `400 36px ${CARD_FONT}`;
    const lines = wrapText(ctx, snippetText(item.post, input.lang), W - PAD - 30 - textX, 4);
    const contentH = Math.max(LEFT_COLUMN_H, lines.length * 42);
    const top = y + (BLOCK_H - contentH) / 2;

    roundRect(ctx, PAD, y, W - PAD * 2, BLOCK_H, 20);
    ctx.fillStyle = 'rgba(255,255,255,0.045)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // 左列：倍数（爆款金色、低于中位压暗）、浏览、赞
    const multiple = item.multiple;
    ctx.fillStyle =
      multiple === null
        ? 'rgba(255,255,255,0.5)'
        : multiple >= OUTLIER_MULTIPLE
          ? GOLD
          : multiple >= 1
            ? 'rgba(255,255,255,0.85)'
            : 'rgba(255,255,255,0.5)';
    ctx.font = `800 46px ${CARD_FONT}`;
    ctx.fillText(multiple === null ? '—' : formatMultipleText(multiple), PAD + 30, top + 46);

    ctx.font = `500 22px ${CARD_FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    if (item.post.views !== undefined) {
      ctx.fillText(`${formatCount(item.post.views, input.lang)} ${t.views}`, PAD + 30, top + 88);
    }
    if (item.post.likes !== undefined) {
      ctx.fillText(`${formatCount(item.post.likes, input.lang)} ${t.likes}`, PAD + 30, top + 118);
    }

    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(270, top + 6, 1.5, Math.max(40, contentH - 12));

    // 正文：最多四行，超出加省略号
    ctx.fillStyle = BODY;
    ctx.font = `400 36px ${CARD_FONT}`;
    lines.forEach((line, index) => {
      ctx.fillText(line, textX, top + 34 + index * 42);
    });

    y += BLOCK_H + BLOCK_GAP;
  }

  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.font = `500 24px ${CARD_FONT}`;
  ctx.fillText(t.footer, PAD, 1296);

  return canvas;
}
