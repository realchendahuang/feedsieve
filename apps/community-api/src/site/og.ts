/**
 * OG 分享卡模板（1200×630 PNG）：公示站各页面分享到 X、微信等平台时的预览图。
 * 本文件是纯模板层（无 IO，可单测）；光栅化与取数路由在 og-render.ts。
 * 为什么必须是 PNG：X/微信等平台不渲染 SVG 格式的 og:image——/assets/avatar.png
 * 等只服务于头像，分享预览一律走这里输出的 PNG。
 * 配色沿用公示站令牌：深色纸底 #0a0a0a、墨色 #f7f7f5、黄框金 #d4a017。
 */
export const OG_W = 1200;
export const OG_H = 630;
const PAD = 80;
/** 内容区宽度（左右各留 PAD） */
const CONTENT_W = OG_W - PAD * 2;
const LINE = '#2a2a2e';
const INK = '#f7f7f5';
const MIST = '#9a9a9f';
const SUBTLE = '#d0d0d0';
const GOLD = '#d4a017';
const FONT = 'Noto Sans SC';

/** 卡面 logo（ASSETS 里的福滤娃头像转 data URI）：href 内嵌图，aspect 为宽高比 */
export interface OgLogo {
  href: string;
  aspect: number;
}

const CJK_RE = /^[\u2E80-\u9FFF\u3000-\u303F\uF900-\uFAFF\uFF00-\uFFEF]$/;

/**
 * 估宽：CJK 与全角按 1em，数字/大写 0.62，小写 0.52，空格 0.3，其余标点 0.32。
 * SVG 文本没有自动换行/截断，超宽全靠模板层预算。
 */
function textW(s: string, size: number): number {
  let em = 0;
  for (const ch of s) {
    if (CJK_RE.test(ch)) em += 1;
    else if (/[A-Z0-9@#%&WM]/.test(ch)) em += 0.62;
    else if (/[a-z]/.test(ch)) em += 0.52;
    else if (ch === ' ') em += 0.3;
    else em += 0.32;
  }
  return em * size;
}

/**
 * 按可用宽度贪心折行（最多 maxLines 行；放不下时最后一行补省略号）。
 * OG 卡没有自动换行，锐评最长 60 个汉字，单行放不下，所以给两行。
 */
export function wrapLines(s: string, maxW: number, size: number, maxLines: number): string[] {
  const chars = [...s];
  const lines: string[] = [];
  let rest = chars;
  while (rest.length && lines.length < maxLines) {
    let take = rest.length;
    while (take > 1 && textW(rest.slice(0, take).join(''), size) > maxW - size) take -= 1;
    const line = rest.slice(0, take).join('');
    rest = rest.slice(take);
    lines.push(line);
  }
  if (rest.length) {
    const last = lines[maxLines - 1] ?? '';
    lines[maxLines - 1] = truncate(last + '…', maxW, size);
  }
  return lines;
}

/** 超宽截断：留出一个省略号的宽度 */
export function truncate(s: string, maxW: number, size: number): string {
  if (textW(s, size) <= maxW) return s;
  const chars = [...s];
  while (chars.length > 1 && textW(chars.join(''), size) > maxW - size) chars.pop();
  return chars.join('') + '…';
}

export const SITE_URL_TEXT = 'feedsieve.win';

const linearGradient = `<linearGradient id="ogacc" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#78350f"/><stop offset="1" stop-color="#fbbf24"/></linearGradient>`;

/** 卡面骨架：底色 + 信号金辉光 + 内描边框 + 头像 logo，共用给全部卡面 */
function frame(logo: OgLogo | null): string {
  // 头像是方形位图，圆形裁剪走 clipPath（与扩展头像同款观感）
  const logoEl = logo
    ? `<clipPath id="ogavatar"><circle cx="${(PAD + 30).toFixed(1)}" cy="80" r="30"/></clipPath>
<image x="${PAD}" y="50" width="60" height="${(60 / logo.aspect).toFixed(1)}" clip-path="url(#ogavatar)" preserveAspectRatio="xMidYMid slice" href="${logo.href}"/>`
    : `<text x="${PAD}" y="84" font-size="34" font-weight="800" fill="${INK}">福滤娃</text>`;
  return `<rect width="${OG_W}" height="${OG_H}" fill="#0a0a0a"/>
<radialGradient id="ogglow"><stop offset="0" stop-color="${GOLD}" stop-opacity="0.18"/><stop offset="1" stop-color="${GOLD}" stop-opacity="0"/></radialGradient>
<circle cx="1020" cy="-40" r="540" fill="url(#ogglow)"/>
<rect x="0.75" y="0.75" width="${OG_W - 1.5}" height="${OG_H - 1.5}" rx="24" fill="none" stroke="${LINE}" stroke-width="1.5"/>
${logoEl}`;
}

function footer(left: string): string {
  return `<rect x="${PAD}" y="578" width="${CONTENT_W}" height="1" fill="${LINE}"/>
<text x="${PAD}" y="608" font-size="24" fill="${MIST}">${esc(left)}</text>
<text x="${OG_W - PAD}" y="608" font-size="24" font-weight="600" fill="${SUBTLE}" text-anchor="end">${SITE_URL_TEXT}</text>`;
}

function esc(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** 站点首页 OG 卡入参（roster + 词库总量的卡面所需子集） */
export interface SiteOgStats {
  blacklistCount: number;
  whitelistCount: number;
}

/** 站点 OG 卡：品牌主视觉 + 名单总量大数（信号金），供首页分享预览 */
export function siteOgSvg(stats: SiteOgStats, logo: OgLogo | null): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_W}" height="${OG_H}" viewBox="0 0 ${OG_W} ${OG_H}" role="img" aria-label="福滤娃 FeedSieve">
<defs>${linearGradient}</defs>
<g font-family="${FONT}">
${frame(logo)}
<text x="${PAD}" y="290" font-size="72" font-weight="700" fill="${INK}">福滤娃 FeedSieve</text>
<text x="${PAD}" y="350" font-size="34" fill="${MIST}">清理黄推 · 热帖榜 · 博主主页洞察</text>
<text x="${PAD}" y="496" font-size="120" font-weight="700" fill="${GOLD}">${esc(String(stats.blacklistCount))}</text>
<text x="${PAD}" y="546" font-size="28" fill="${MIST}">条垃圾账号公示 · ${esc(String(stats.whitelistCount))} 位博主入册推荐白名单</text>
${footer('评论区不骚了，好帖也不漏了')}
</g>
</svg>`;
}

/** 公示页 OG 卡入参（/lists 拆分页 + 申请页共用） */
export interface ListOgStat {
  title: string;
  /** 大数行：主数值（如黑名单总量） */
  big: string;
  bigLabel: string;
  /** 判定口径短句 */
  line: string;
  /** 快照 / 补充行 */
  sub: string;
}

/** 公示页 OG 卡：页标题 + 大数 + 口径行，公示页家族每条路由一张 */
export function listCardOgSvg(stat: ListOgStat, logo: OgLogo | null): string {
  const bigSize = stat.big.length >= 9 ? 96 : 128;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_W}" height="${OG_H}" viewBox="0 0 ${OG_W} ${OG_H}" role="img" aria-label="${esc(stat.title)} · 福滤娃 FeedSieve">
<g font-family="${FONT}">
${frame(logo)}
<text x="${PAD}" y="200" font-size="30" font-weight="700" fill="${MIST}">名单公示</text>
<text x="${PAD}" y="278" font-size="62" font-weight="700" fill="${INK}">${esc(truncate(stat.title, CONTENT_W, 62))}</text>
<text x="${PAD}" y="352" font-size="28" fill="${MIST}">${esc(stat.line)}</text>
<text x="${PAD}" y="${496 - (bigSize - 128) * 0.6}" font-size="${bigSize}" font-weight="700" fill="${GOLD}">${esc(stat.big)}</text>
<text x="${PAD}" y="546" font-size="28" fill="${MIST}">${esc(truncate(`${stat.bigLabel} · ${stat.sub}`, CONTENT_W, 28))}</text>
${footer('与扩展执行的名单同源（签名快照）')}
</g>
</svg>`;
}

/** AI 味结果页 OG 卡入参（公开结论，或待复核 / 争议中 / 真人 / 没测过的占位） */
export interface AiOgCard {
  handle: string;
  displayName: string | null;
  /** 头像 data URI（服务端已读好）；读不到画首字母圆 */
  avatar: string | null;
  state: 'public' | 'human' | 'contested' | 'pending' | 'none';
  percent?: number;
  tone?: 'ai' | 'mixed' | 'human';
  level?: string;
  /** 模型锐评；没有就整块不画（不再有手写评语兜底） */
  comment?: string;
  replyCount?: number;
  aiVotes?: number;
  humanVotes?: number;
}

const AI_TONE = { ai: '#ff4d6d', mixed: '#ffb020', human: '#22d39b' } as const;

/** AI 味结果页 OG 卡：头像 + 名字 + @id，右侧大百分比 + 档位 + 锐评；没有公开结论时给邀请确认的文案 */
export function aiCardOgSvg(card: AiOgCard): string {
  const tone =
    card.state === 'human'
      ? AI_TONE.human
      : card.state === 'contested'
        ? AI_TONE.mixed
        : card.tone
          ? AI_TONE[card.tone]
          : GOLD;
  const name = card.displayName?.trim() || `@${card.handle}`;
  const initial = esc([...name.replace(/^@/, '')][0]?.toUpperCase() ?? '?');
  const avatar = card.avatar
    ? `<clipPath id="aiav"><circle cx="190" cy="250" r="110"/></clipPath>
<image x="80" y="140" width="220" height="220" clip-path="url(#aiav)" preserveAspectRatio="xMidYMid slice" href="${card.avatar}"/>`
    : `<circle cx="190" cy="250" r="110" fill="#1f2430"/>
<text x="190" y="285" font-size="96" font-weight="700" fill="${INK}" text-anchor="middle">${initial}</text>`;
  const ring = `<circle cx="190" cy="250" r="118" fill="none" stroke="${tone}" stroke-width="8"/>`;
  // 没有昵称时名字就是 @id，不重复写第二行
  const nameBlock = `<text x="80" y="430" font-size="44" font-weight="700" fill="${INK}">${esc(truncate(name, 440, 44))}</text>${
    card.displayName?.trim()
      ? `\n<text x="80" y="478" font-size="30" fill="${MIST}">@${esc(card.handle)}</text>`
      : ''
  }`;
  const right =
    card.state === 'public' && card.percent !== undefined
      ? `<text x="470" y="200" font-size="30" font-weight="700" fill="${MIST}">AI 味</text>
<text x="462" y="370" font-size="190" font-weight="700" fill="${tone}">${card.percent}<tspan font-size="80">%</tspan></text>
<rect x="470" y="404" width="${Math.min(640, textW(card.level ?? '', 38) + 56)}" height="64" rx="32" fill="${tone}"/>
<text x="498" y="448" font-size="38" font-weight="700" fill="#0a0a0a">${esc(card.level ?? '')}</text>
${
  card.comment
    ? wrapLines(`「${card.comment}」`, 650, 26, 3)
        .map(
          (line, index) =>
            `<text x="470" y="${508 + index * 30}" font-size="26" fill="${SUBTLE}">${esc(line)}</text>`,
        )
        .join('\n')
    : ''
}`
      : card.state === 'human'
        ? `<text x="470" y="200" font-size="30" font-weight="700" fill="${MIST}">社区结论</text>
<text x="462" y="370" font-size="150" font-weight="700" fill="${tone}">真人</text>
<text x="470" y="448" font-size="30" fill="${MIST}">AI ${card.aiVotes ?? 0} 票 · 真人 ${card.humanVotes ?? 0} 票</text>
<text x="470" y="526" font-size="30" fill="${SUBTLE}">社区投票认为这是真人，不是 AI 号</text>`
        : card.state === 'contested'
          ? `<text x="470" y="200" font-size="30" font-weight="700" fill="${MIST}">社区投票</text>
<text x="462" y="370" font-size="110" font-weight="700" fill="${tone}">争议中</text>
<text x="470" y="448" font-size="30" fill="${MIST}">AI ${card.aiVotes ?? 0} 票 · 真人 ${card.humanVotes ?? 0} 票</text>
<text x="470" y="526" font-size="30" fill="${SUBTLE}">两边票数接近，继续投票决定</text>`
          : card.state === 'public'
            ? `<text x="470" y="200" font-size="30" font-weight="700" fill="${MIST}">社区结论</text>
<text x="462" y="370" font-size="150" font-weight="700" fill="${tone}">AI</text>
<text x="470" y="448" font-size="30" fill="${MIST}">AI ${card.aiVotes ?? 0} 票 · 真人 ${card.humanVotes ?? 0} 票</text>
<text x="470" y="526" font-size="30" fill="${SUBTLE}">还没有可公开的判定分数</text>`
            : `<text x="470" y="250" font-size="54" font-weight="700" fill="${INK}">${
                card.state === 'pending' ? '已有人测过 · 待确认' : '还没人测过'
              }</text>
<text x="470" y="318" font-size="30" fill="${MIST}">${
                card.state === 'pending'
                  ? '再有一位用户测到同样的结果就公开'
                  : '装上福滤娃，测测 TA 的回复有多少 AI 味'
              }</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_W}" height="${OG_H}" viewBox="0 0 ${OG_W} ${OG_H}" role="img" aria-label="${esc(name)} 的 AI 味 · 福滤娃 FeedSieve">
<g font-family="${FONT}">
<rect width="${OG_W}" height="${OG_H}" fill="#0a0a0a"/>
<radialGradient id="aiglow"><stop offset="0" stop-color="${tone}" stop-opacity="0.22"/><stop offset="1" stop-color="${tone}" stop-opacity="0"/></radialGradient>
<circle cx="900" cy="120" r="560" fill="url(#aiglow)"/>
<rect x="0.75" y="0.75" width="${OG_W - 1.5}" height="${OG_H - 1.5}" rx="24" fill="none" stroke="${LINE}" stroke-width="1.5"/>
<text x="80" y="92" font-size="30" font-weight="700" fill="${tone}">AI 味检测报告</text>
${avatar}
${ring}
${nameBlock}
${right}
${footer(card.replyCount ? `根据最近 ${card.replyCount} 条公开回复 · 模型判定与锐评可能有误差 · 仅供娱乐参考` : '模型根据公开回复判定与锐评，可能有误差，仅供娱乐参考')}
</g>
</svg>`;
}
