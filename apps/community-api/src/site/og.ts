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
  /** 参与判定的回复条数 */
  replyCount?: number;
  /** 这批复覆盖了几个不同的人 */
  sampleAuthors?: number | null;
  /** 样本跨度（秒）：卡面写成「样本（最近 46 分钟内）」 */
  sampleSpan?: number | null;
  /** 回复间隔中位数（秒） */
  medianGap?: number | null;
  /** 长度变异系数：决定「长短波动 大 / 中 / 小」 */
  cv?: number | null;
  /** 判定时间（Unix 秒），写进右上角日期 */
  judgedAt?: number | null;
  aiVotes?: number;
  humanVotes?: number;
}

const AI_TONE = { ai: '#ff4d6d', mixed: '#ffb020', human: '#22d39b' } as const;

/** 秒 → 中文时长（与扩展端的 formatGap 同口径） */
function fmtGap(seconds: number): string {
  if (seconds < 90) return `${Math.round(seconds)} 秒`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} 小时`;
  return `${Math.round(hours / 24)} 天`;
}

/** 长度变异系数 → 长短波动档位 */
function spreadText(cv: number): string {
  return cv >= 0.6 ? '大' : cv >= 0.35 ? '中' : '小';
}

/** 底部数据条的一格：小标签 + 大数值 */
function statCell(x: number, label: string, value: string): string {
  return `<text x="${x}" y="500" font-size="22" fill="${MIST}">${esc(label)}</text>
<text x="${x}" y="540" font-size="30" font-weight="700" fill="${INK}">${esc(value)}</text>`;
}

/**
 * AI 味结果页 OG 卡：卡面结构与产品内的检测卡对齐——左上账号、右上判定与分数、
 * 左下模型锐评、底部一整行判定依据（样本窗口 / 条数与人数 / 回复间隔 / 长短波动 / 社区票数）。
 * 所有数字都来自库里已有的判定记录，没有的字段就整格不画。
 */
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
    ? `<clipPath id="aiav"><circle cx="126" cy="200" r="54"/></clipPath>
<image x="72" y="146" width="108" height="108" clip-path="url(#aiav)" preserveAspectRatio="xMidYMid slice" href="${card.avatar}"/>`
    : `<circle cx="126" cy="200" r="54" fill="#1f2430"/>
<text x="126" y="218" font-size="48" font-weight="700" fill="${INK}" text-anchor="middle">${initial}</text>`;
  const ring = `<circle cx="126" cy="200" r="60" fill="none" stroke="${tone}" stroke-width="5"/>`;
  // 没有昵称时名字就是 @id，不重复写第二行
  const nameBlock = `<text x="204" y="196" font-size="40" font-weight="700" fill="${INK}">${esc(truncate(name, 470, 40))}</text>${
    card.displayName?.trim()
      ? `\n<text x="204" y="236" font-size="24" fill="${MIST}">@${esc(card.handle)}</text>`
      : ''
  }`;

  // 右上：判定结论（分数 + 档位，或社区投票的结论）
  const bigText = (text: string, size: number) =>
    `<text x="694" y="330" font-size="${size}" font-weight="700" fill="${tone}">${esc(text)}</text>`;
  let verdictBlock: string;
  if (card.state === 'public' && card.percent !== undefined) {
    verdictBlock = `<text x="700" y="176" font-size="24" font-weight="700" fill="${MIST}">AI 味</text>
${bigText(String(card.percent), 150).replace('</text>', `<tspan font-size="62">%</tspan></text>`)}
<rect x="700" y="352" width="${Math.min(400, textW(card.level ?? '', 30) + 48)}" height="58" rx="29" fill="${tone}"/>
<text x="724" y="392" font-size="30" font-weight="700" fill="#0a0a0a">${esc(card.level ?? '')}</text>
<rect x="700" y="428" width="420" height="8" rx="4" fill="url(#aibar)"/>
<circle cx="${700 + Math.round((420 * (card.percent ?? 0)) / 100)}" cy="432" r="11" fill="#f7f7f5"/>`;
  } else if (card.state === 'human') {
    verdictBlock = `<text x="700" y="176" font-size="24" font-weight="700" fill="${MIST}">社区结论</text>
${bigText('真人', 118)}`;
  } else if (card.state === 'contested') {
    verdictBlock = `<text x="700" y="176" font-size="24" font-weight="700" fill="${MIST}">社区投票</text>
${bigText('争议中', 96)}`;
  } else if (card.state === 'public') {
    verdictBlock = `<text x="700" y="176" font-size="24" font-weight="700" fill="${MIST}">社区结论</text>
${bigText('AI', 150)}`;
  } else if (card.state === 'pending') {
    verdictBlock = `<text x="700" y="176" font-size="24" font-weight="700" fill="${MIST}">社区结论</text>
${bigText('待复核', 96)}`;
  } else {
    verdictBlock = `<text x="700" y="176" font-size="24" font-weight="700" fill="${MIST}">AI 味检测</text>
${bigText('还没人测', 64)}`;
  }

  // 左下：模型锐评（没有就换成一句状态说明，不编评语）
  const hint =
    card.state === 'human'
      ? '社区投票认为这是真人，不是 AI 号'
      : card.state === 'contested'
        ? '两边票数接近，继续投票决定'
        : card.state === 'pending'
          ? '再有一位用户测到同样的结果就公开'
          : card.state === 'none'
            ? '装上福滤娃，测测 TA 的回复有多少 AI 味'
            : '';
  const quote = card.comment
    ? wrapLines(`「${card.comment}」`, 580, 28, 3)
        .map(
          (line, index, lines) =>
            `${
              index === 0
                ? `<rect x="${PAD}" y="306" width="4" height="${lines.length * 40}" rx="2" fill="${tone}"/>\n`
                : ''
            }<text x="${PAD + 18}" y="${330 + index * 40}" font-size="28" fill="${SUBTLE}">${esc(line)}</text>`,
        )
        .join('\n')
    : hint
      ? `<text x="${PAD}" y="356" font-size="28" fill="${MIST}">${esc(truncate(hint, 580, 28))}</text>`
      : '';

  // 底部数据条：有多少画多少
  const statsData: Array<[string, string]> = [];
  const sampleLabel = card.sampleSpan ? `样本（最近 ${fmtGap(card.sampleSpan)}内）` : '样本';
  const sampleValue = card.replyCount
    ? `${card.replyCount} 条${card.sampleAuthors ? ` · ${card.sampleAuthors} 人` : ''}`
    : '';
  if (sampleValue) statsData.push([sampleLabel, sampleValue]);
  if (card.medianGap != null) statsData.push(['回复间隔', `中位 ${fmtGap(card.medianGap)}`]);
  if (card.cv != null) statsData.push(['长短波动', spreadText(card.cv)]);
  if ((card.aiVotes ?? 0) + (card.humanVotes ?? 0) > 0) {
    statsData.push(['社区投票', `AI ${card.aiVotes ?? 0} · 真人 ${card.humanVotes ?? 0}`]);
  }
  // 有几格就均分几列：公开结论通常 4 格，真人 / 争议中只剩票数一格时也不会挤在最右边
  const stats = statsData.length
    ? `<rect x="${PAD}" y="452" width="${CONTENT_W}" height="1" fill="${LINE}"/>
${statsData
  .map(([label, value], index) =>
    statCell(PAD + Math.round((CONTENT_W / statsData.length) * index), label, value),
  )
  .join('\n')}`
    : '';

  // 右上角：判定时间（UTC 日期，和扩展分享卡同口径）
  const date = card.judgedAt ? new Date(card.judgedAt * 1000).toISOString().slice(0, 10) : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_W}" height="${OG_H}" viewBox="0 0 ${OG_W} ${OG_H}" role="img" aria-label="${esc(name)} 的 AI 味 · 福滤娃 FeedSieve">
<g font-family="${FONT}">
<rect width="${OG_W}" height="${OG_H}" fill="#0a0a0a"/>
<linearGradient id="aibar" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#22d39b"/><stop offset="0.5" stop-color="#ffb020"/><stop offset="1" stop-color="#ff4d6d"/></linearGradient>
<radialGradient id="aiglow"><stop offset="0" stop-color="${tone}" stop-opacity="0.22"/><stop offset="1" stop-color="${tone}" stop-opacity="0"/></radialGradient>
<circle cx="900" cy="120" r="560" fill="url(#aiglow)"/>
<rect x="0.75" y="0.75" width="${OG_W - 1.5}" height="${OG_H - 1.5}" rx="24" fill="none" stroke="${LINE}" stroke-width="1.5"/>
<text x="${PAD}" y="92" font-size="30" font-weight="700" fill="${tone}">AI 味检测报告</text>
${date ? `<text x="${OG_W - PAD}" y="92" font-size="24" fill="${MIST}" text-anchor="end">${date}</text>` : ''}
${avatar}
${ring}
${nameBlock}
${verdictBlock}
${quote}
${stats}
${footer(card.replyCount ? `根据最近 ${card.replyCount} 条公开回复 · 模型判定与锐评可能有误差 · 仅供娱乐参考` : '模型根据公开回复判定与锐评，可能有误差，仅供娱乐参考')}
</g>
</svg>`;
}
