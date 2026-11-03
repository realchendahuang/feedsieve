/**
 * X 高级搜索的查询构建（纯函数，弹窗和页面注入共用）。
 *
 * 输入是界面上的几个选项，输出可以直接塞进 `x.com/search?q=` 的字符串。
 * 用户在「关键词」里手写的运算符原样保留，所以这里只负责补上结构化选项；
 * 想用 min_retweets、lang、url 这类没做控件的语法，直接写进关键词即可。
 */
import { profileFromPath } from '@feedsieve/x-adapter';

export type SearchRange = 'any' | 'w' | 'm' | 'y';
export type SearchContent =
  | 'any'
  | 'images'
  | 'videos'
  | 'native_video'
  | 'media'
  | 'links'
  | 'quote';
export type SearchSort = 'top' | 'live';
/** 回复筛选：全部 / 只看主帖 / 只看回复。 */
export type RepliesMode = 'any' | 'exclude' | 'only';
export type DistanceUnit = 'km' | 'mi';

export const SEARCH_RANGES: readonly SearchRange[] = ['any', 'w', 'm', 'y'];
export const SEARCH_CONTENTS: readonly SearchContent[] = [
  'any',
  'images',
  'videos',
  'native_video',
  'media',
  'links',
  'quote',
];
export const SEARCH_SORTS: readonly SearchSort[] = ['top', 'live'];
export const REPLIES_MODES: readonly RepliesMode[] = ['any', 'exclude', 'only'];

/** 预设时间范围对应的天数；X 的 since: 只认日期。 */
const RANGE_DAYS: Record<Exclude<SearchRange, 'any'>, number> = {
  w: 7,
  m: 30,
  y: 365,
};

const CONTENT_FILTER: Record<Exclude<SearchContent, 'any'>, string> = {
  images: 'filter:images',
  videos: 'filter:videos',
  native_video: 'filter:native_video',
  media: 'filter:media',
  links: 'filter:links',
  quote: 'filter:quote',
};

/** 关键词最多带这么多字符，避免拼出超长 URL。 */
const KEYWORD_MAX = 400;
const GOOGLE_KEYWORD_MAX = 200;

/**
 * 能从这些运算符里认出「这是筛选条件」；Google 搜的时候要把它们去掉，
 * 否则 Google 会把 `min_faves:3000` 当成普通词去匹配。
 */
const X_OPERATOR =
  /^(?:-)?(?:from|to|min_faves|min_retweets|min_replies|min_reposts|since|until|filter|lang|domain|url|geocode|near|within|listed|source|conversation_id|in_reply_to|card_name|place|place_country|has|include):/i;

/** 解析最低点赞：允许 `3,000`、`3000`，空值或 0 表示不限。 */
export function parseMinLikes(value: string | number | null | undefined): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
  }
  if (typeof value !== 'string') return null;
  const digits = value.replace(/[,，\s_]/g, '');
  if (!/^\d{1,10}$/.test(digits)) return null;
  const parsed = Number(digits);
  return parsed > 0 ? parsed : null;
}

function normalizeKeyword(value: string | null | undefined, max: number): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** 本地时区的 YYYY-MM-DD；X 的 since 只到日期，差一天不影响使用。 */
export function dateDaysAgo(now: number, days: number): string {
  const date = new Date(now - days * 24 * 60 * 60 * 1_000);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export interface XQueryOptions {
  /** 当前主页/搜索页关联的博主；没有上下文时不加 from:。 */
  handle?: string | null;
  /** 勾了「仅看 @handle」才加 from:；默认在有 handle 时加。 */
  onlyFrom?: boolean;
  /** 用户手写的内容，可包含任意 X 运算符。 */
  keyword?: string | null;
  minLikes?: string | number | null;
  range?: SearchRange;
  content?: SearchContent;
  excludeReplies?: boolean;
  now?: number;
}

/** 拼 X 搜索查询：`from:handle 关键词 min_faves:3000 since:… filter:… -filter:replies`。 */
export function buildXQuery(options: XQueryOptions): string {
  const parts: string[] = [];
  const keyword = normalizeKeyword(options.keyword, KEYWORD_MAX);
  // 用户已经写进搜索框的条件优先，不再重复追加一份。
  if (options.onlyFrom !== false && options.handle && !/(?:^|\s)from:/i.test(keyword)) {
    parts.push(`from:${options.handle}`);
  }
  if (keyword) parts.push(keyword);
  const minLikes = parseMinLikes(options.minLikes);
  if (minLikes !== null && !/(?:^|\s)min_faves:/i.test(keyword)) {
    parts.push(`min_faves:${minLikes}`);
  }
  const range = options.range ?? 'any';
  const days = RANGE_DAYS[range as Exclude<SearchRange, 'any'>];
  if (days && !/(?:^|\s)since:/i.test(keyword)) {
    parts.push(`since:${dateDaysAgo(options.now ?? Date.now(), days)}`);
  }
  const content = options.content ?? 'any';
  const filter = CONTENT_FILTER[content as Exclude<SearchContent, 'any'>];
  if (filter && !/(?:^|\s)filter:/i.test(keyword)) {
    parts.push(filter);
  }
  if (options.excludeReplies && !/(?:^|\s)-filter:replies/i.test(keyword)) {
    parts.push('-filter:replies');
  }
  return parts.join(' ');
}

/** 打开 X 搜索结果页；sort=top 是「最热」，live 是「最新」。 */
export function xSearchUrl(query: string, sort: SearchSort = 'top'): string {
  const params = new URLSearchParams({ q: query, src: 'typed_query', f: sort });
  return `https://x.com/search?${params.toString()}`;
}

export interface AdvancedQueryOptions {
  /** 包含全部词。 */
  allWords?: string;
  /** 精确短语，自动加引号。 */
  exactPhrase?: string;
  /** 任意一个词，生成 `(a OR b)`。 */
  anyWords?: string;
  /** 排除词，每个词前加 `-`。 */
  noneWords?: string;
  /** 话题标签，自动补 `#`。 */
  hashtags?: string;
  /** 语言代码，如 zh / en。 */
  language?: string;
  /** 来自这些账号（from:）。 */
  from?: string;
  /** 发给这些账号（to:）。 */
  to?: string;
  /** 提到这些账号（@handle）。 */
  mention?: string;
  since?: string;
  until?: string;
  minReplies?: string | number;
  minRetweets?: string | number;
  minLikes?: string | number;
  content?: SearchContent;
  replies?: RepliesMode;
  excludeRetweets?: boolean;
  verifiedOnly?: boolean;
  near?: string;
  within?: string | number;
  unit?: DistanceUnit;
  /** 原样拼进查询的自定义运算符。 */
  raw?: string;
}

function splitTerms(value: string | null | undefined): string[] {
  return tokenize(normalizeKeyword(value, KEYWORD_MAX));
}

/** 带空格的词要加引号，已经包在引号里的保持原样。 */
function quoteTerm(term: string): string {
  if (term.startsWith('"') && term.endsWith('"')) return term;
  return /\s/.test(term) ? `"${term}"` : term;
}

/** 账号名只保留 X 允许的字符；不合法就当作没填。 */
export function cleanHandle(value: string | null | undefined): string {
  const handle = (value ?? '').trim().replace(/^@+/, '');
  return /^[A-Za-z0-9_]{1,15}$/.test(handle) ? handle : '';
}

/** 只接受真实存在的 YYYY-MM-DD，避免 2026-02-31 这种被 Date 静默进位。 */
export function validDate(value: string | null | undefined): string {
  const text = (value ?? '').trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return '';
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return '';
  }
  return text;
}

/**
 * 完整高级搜索：把表单里的每一项翻译成 X 运算符。
 * 空字段不产生任何片段；用户写在「自定义条件」里的内容原样追加。
 */
export function buildAdvancedQuery(options: AdvancedQueryOptions): string {
  const parts: string[] = [];

  const all = normalizeKeyword(options.allWords, KEYWORD_MAX);
  if (all) parts.push(all);
  const exact = normalizeKeyword(options.exactPhrase, 200);
  if (exact) parts.push(`"${normalizeKeyword(exact.replace(/"/g, ' '), 200)}"`);
  const any = splitTerms(options.anyWords).map(quoteTerm);
  if (any.length > 0) parts.push(`(${any.join(' OR ')})`);
  for (const term of splitTerms(options.noneWords)) parts.push(`-${quoteTerm(term)}`);
  for (const tag of splitTerms(options.hashtags)) {
    const cleaned = tag.replace(/^#+/, '');
    if (cleaned) parts.push(`#${cleaned}`);
  }

  const language = normalizeKeyword(options.language, 10).toLowerCase();
  if (/^[a-z]{2,5}(?:-[a-z0-9]{2,8})?$/.test(language)) parts.push(`lang:${language}`);

  const from = cleanHandle(options.from);
  if (from) parts.push(`from:${from}`);
  const to = cleanHandle(options.to);
  if (to) parts.push(`to:${to}`);
  const mention = cleanHandle(options.mention);
  if (mention) parts.push(`@${mention}`);

  const since = validDate(options.since);
  if (since) parts.push(`since:${since}`);
  const until = validDate(options.until);
  if (until) parts.push(`until:${until}`);

  const minimums: Array<[string, string | number | undefined]> = [
    ['min_replies', options.minReplies],
    ['min_retweets', options.minRetweets],
    ['min_faves', options.minLikes],
  ];
  for (const [operator, value] of minimums) {
    const count = parseMinLikes(value);
    if (count !== null) parts.push(`${operator}:${count}`);
  }

  const filter = CONTENT_FILTER[(options.content ?? 'any') as Exclude<SearchContent, 'any'>];
  if (filter) parts.push(filter);
  if (options.replies === 'exclude') parts.push('-filter:replies');
  else if (options.replies === 'only') parts.push('filter:replies');
  if (options.excludeRetweets) parts.push('-filter:retweets');
  if (options.verifiedOnly) parts.push('filter:verified');

  const near = normalizeKeyword(options.near, 100);
  if (near) parts.push(`near:${quoteTerm(near)}`);
  const within = parseMinLikes(options.within);
  if (within !== null) parts.push(`within:${within}${options.unit === 'mi' ? 'mi' : 'km'}`);

  const raw = normalizeKeyword(options.raw, KEYWORD_MAX);
  if (raw) parts.push(raw);

  return parts.join(' ');
}

/** 按引号、空格和逗号切词；引号里的空格与逗号都不拆开。 */
function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quoted = false;
  for (const char of text) {
    if (char === '"') {
      quoted = !quoted;
      current += char;
      continue;
    }
    if (!quoted && (/[\s,]/.test(char) || char === '，')) {
      if (current) tokens.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current) tokens.push(current);
  return tokens;
}

/** 去掉 X 专用运算符，留下能交给 Google 的关键词。 */
export function stripXOperators(text: string | null | undefined): string {
  return tokenize(normalizeKeyword(text, KEYWORD_MAX))
    .filter((token) => !X_OPERATOR.test(token))
    .join(' ');
}

export interface GoogleQueryOptions {
  handle?: string | null;
  onlyFrom?: boolean;
  keyword?: string | null;
  range?: SearchRange;
  /** 结构化表单字段；填了就不再吃 keyword。 */
  from?: string;
  allWords?: string;
  exactPhrase?: string;
  anyWords?: string;
  noneWords?: string;
  hashtags?: string;
  since?: string;
  until?: string;
}

function googleDate(date: string): string {
  const [year = '', month = '', day = ''] = date.split('-');
  return `${Number(month)}/${Number(day)}/${year}`;
}

/** 结构化字段 → Google 能理解的普通关键词（运算符不适合直接给 Google）。 */
function googleWords(options: GoogleQueryOptions): string {
  const parts: string[] = [];
  const all = normalizeKeyword(options.allWords, GOOGLE_KEYWORD_MAX);
  if (all) parts.push(all);
  const exact = normalizeKeyword(options.exactPhrase, 100);
  if (exact) parts.push(`"${normalizeKeyword(exact.replace(/"/g, ' '), 100)}"`);
  const any = splitTerms(options.anyWords).map(quoteTerm);
  if (any.length > 0) parts.push(`(${any.join(' OR ')})`);
  for (const term of splitTerms(options.noneWords)) parts.push(`-${quoteTerm(term)}`);
  for (const tag of splitTerms(options.hashtags)) {
    const cleaned = tag.replace(/^#+/, '');
    if (cleaned) parts.push(`#${cleaned}`);
  }
  const structured = normalizeKeyword(parts.join(' '), GOOGLE_KEYWORD_MAX);
  if (structured) return structured;
  return normalizeKeyword(stripXOperators(options.keyword), GOOGLE_KEYWORD_MAX);
}

/**
 * Google 站内搜索：只搜这个人的帖子页（x.com 和旧的 twitter.com 地址都算），
 * 没有博主上下文时搜整个站。日期用 tbs=cdr 自定义范围，旧的 range 用 qdr。
 */
export function googleSearchUrl(options: GoogleQueryOptions): string {
  const words = googleWords(options);
  const from = cleanHandle(options.from);
  const handle = from || (options.onlyFrom !== false ? cleanHandle(options.handle) : '');
  const site = handle
    ? `(site:x.com/${handle}/status OR site:twitter.com/${handle}/status)`
    : '(site:x.com OR site:twitter.com)';
  const params = new URLSearchParams({ q: words ? `${site} ${words}` : site });

  const since = validDate(options.since);
  const until = validDate(options.until);
  if (since || until) {
    const min = since ? `,cd_min:${googleDate(since)}` : '';
    const max = until ? `,cd_max:${googleDate(until)}` : '';
    params.set('tbs', `cdr:1${min}${max}`);
  } else {
    const range = options.range ?? 'any';
    if (range !== 'any') params.set('tbs', `qdr:${range}`);
  }
  return `https://www.google.com/search?${params.toString()}`;
}

/**
 * 当前页面对应的博主：个人主页，或带 `from:` 的 X 搜索页。
 * 和弹窗里的识别规则一致，保证两边看到的是同一个人。
 */
export function handleFromLocation(pathname: string, search: string): string | null {
  const profile = profileFromPath(pathname);
  if (profile) return profile.handle;
  if (pathname === '/search') {
    const query = new URLSearchParams(search).get('q') ?? '';
    const match = /(?:^|\s)from:@?([A-Za-z0-9_]{1,15})(?=\s|$)/.exec(query);
    if (match) return match[1]!.toLowerCase();
  }
  return null;
}

/** 跨 storage 边界读回来的偏好再校验一遍。 */
export function normalizeSearchRange(value: unknown): SearchRange {
  return typeof value === 'string' && (SEARCH_RANGES as readonly string[]).includes(value)
    ? (value as SearchRange)
    : 'any';
}

export function normalizeSearchContent(value: unknown): SearchContent {
  return typeof value === 'string' && (SEARCH_CONTENTS as readonly string[]).includes(value)
    ? (value as SearchContent)
    : 'any';
}

export function normalizeSearchSort(value: unknown): SearchSort {
  return typeof value === 'string' && (SEARCH_SORTS as readonly string[]).includes(value)
    ? (value as SearchSort)
    : 'top';
}

export function normalizeRepliesMode(value: unknown): RepliesMode {
  return typeof value === 'string' && (REPLIES_MODES as readonly string[]).includes(value)
    ? (value as RepliesMode)
    : 'any';
}

export function normalizeDistanceUnit(value: unknown): DistanceUnit {
  return value === 'mi' ? 'mi' : 'km';
}
