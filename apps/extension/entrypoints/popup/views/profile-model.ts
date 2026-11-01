/**
 * 「主页」视图的数据处理（纯函数）：校验后台传来的帖子库、跟随标签页找出当前博主、
 * 排序筛选、导出给 AI 的 Markdown 和 CSV。
 */
import { profileFromPath } from '@feedsieve/x-adapter';
import type {
  PostScore,
  ProfileAnalysis,
  ProfilePostKind,
  ProfilePostMedia,
} from '@feedsieve/metrics';
import type {
  CatalogAccount,
  CatalogEntry,
  CatalogPost,
} from '../../../src/lib/insight/profile-catalog';
import { cleanText, formatMultipleText } from '../../../src/lib/insight/format';

// 分享卡和导出共用同一套格式化：ProfileView 仍从这里取
export { formatMultipleText };

export type ProfileSort = 'multiple' | 'views' | 'likes' | 'bookmarks' | 'saveRate' | 'recent';
export const PROFILE_SORTS: readonly ProfileSort[] = [
  'multiple',
  'views',
  'likes',
  'bookmarks',
  'saveRate',
  'recent',
];
export type ProfileRange = '30' | '90' | '365' | 'all';
export const PROFILE_RANGES: readonly ProfileRange[] = ['30', '90', '365', 'all'];

export function isProfileSort(value: unknown): value is ProfileSort {
  return typeof value === 'string' && (PROFILE_SORTS as readonly string[]).includes(value);
}

export function isProfileRange(value: unknown): value is ProfileRange {
  return typeof value === 'string' && (PROFILE_RANGES as readonly string[]).includes(value);
}

const HANDLE = /^[a-z0-9_]{1,15}$/;
const POST_ID = /^\d{1,20}$/;
const TWIMG_URL = /^https:\/\/pbs\.twimg\.com\/[\w./-]{1,300}$/;
const KINDS = new Set<ProfilePostKind>(['original', 'reply', 'quote']);
const MEDIA = new Set<ProfilePostMedia>(['none', 'photo', 'video', 'gif', 'mixed']);
const COUNT_KEYS = ['views', 'likes', 'retweets', 'replies', 'quotes', 'bookmarks'] as const;

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * 当前标签页对应的博主：个人主页，或者 `from:handle` 的 X 搜索（「搜高赞帖」打开的页面）。
 * 其他页面返回 null，调用方保留上一个博主，切到帖子详情再回来时面板不闪。
 */
export function handleFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!/^(www\.)?x\.com$/.test(parsed.hostname)) return null;
  const profile = profileFromPath(parsed.pathname);
  if (profile) return profile.handle;
  if (parsed.pathname === '/search') {
    const match = /(?:^|\s)from:@?([A-Za-z0-9_]{1,15})(?=\s|$)/.exec(
      parsed.searchParams.get('q') ?? '',
    );
    if (match) return match[1]!.toLowerCase();
  }
  return null;
}

/** 是不是博主主页本身（打开弹窗时决定默认落到哪个视图；搜索页不算）。 */
export function isProfileUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return /^(www\.)?x\.com$/.test(parsed.hostname) && profileFromPath(parsed.pathname) !== null;
  } catch {
    return false;
  }
}

function readPost(raw: unknown): CatalogPost | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.postId !== 'string' || !POST_ID.test(r.postId)) return null;
  const post: CatalogPost = {
    postId: r.postId,
    firstSeenAt: count(r.firstSeenAt) ?? 0,
    updatedAt: count(r.updatedAt) ?? 0,
  };
  const createdAt = count(r.createdAt);
  if (createdAt !== undefined) post.createdAt = createdAt;
  for (const key of COUNT_KEYS) {
    const value = count(r[key]);
    if (value !== undefined) post[key] = value;
  }
  if (KINDS.has(r.kind as ProfilePostKind)) post.kind = r.kind as ProfilePostKind;
  if (MEDIA.has(r.media as ProfilePostMedia)) post.media = r.media as ProfilePostMedia;
  if (r.pinned === true) post.pinned = true;
  if (typeof r.snippet === 'string' && r.snippet.trim())
    post.snippet = r.snippet.trim().slice(0, 1_000);
  if (typeof r.mediaUrl === 'string' && TWIMG_URL.test(r.mediaUrl)) post.mediaUrl = r.mediaUrl;
  if (typeof r.lang === 'string') post.lang = r.lang;
  return post;
}

/** 后台回复的帖子库：按形状逐项校验，不合格的帖子丢掉。 */
export function asCatalogEntry(value: unknown, handle: string): CatalogEntry | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const account = raw.account as Record<string, unknown> | undefined;
  if (!account || account.handle !== handle || !HANDLE.test(handle)) return null;
  const cleanAccount: CatalogAccount = { handle };
  for (const key of ['followers', 'followingCount', 'tweets', 'createdAt', 'updatedAt'] as const) {
    const value = count(account[key]);
    if (value !== undefined) cleanAccount[key] = value;
  }
  if (typeof account.displayName === 'string' && account.displayName.trim()) {
    cleanAccount.displayName = account.displayName.trim().slice(0, 64);
  }
  if (typeof account.avatarUrl === 'string' && TWIMG_URL.test(account.avatarUrl)) {
    cleanAccount.avatarUrl = account.avatarUrl;
  }
  if (typeof account.verified === 'boolean') cleanAccount.verified = account.verified;
  const posts: Record<string, CatalogPost> = {};
  if (raw.posts && typeof raw.posts === 'object') {
    for (const item of Object.values(raw.posts as Record<string, unknown>)) {
      const post = readPost(item);
      if (post) posts[post.postId] = post;
    }
  }
  return {
    account: cleanAccount,
    posts,
    firstVisitAt: count(raw.firstVisitAt) ?? 0,
    lastVisitAt: count(raw.lastVisitAt) ?? 0,
  };
}

/** 收藏率 = 收藏 ÷ 浏览：比点赞更能说明内容「值得留着」。 */
export function saveRate(post: CatalogPost): number | null {
  return post.views && post.bookmarks !== undefined ? post.bookmarks / post.views : null;
}

function sortKey(post: CatalogPost, score: PostScore | undefined, sort: ProfileSort): number {
  switch (sort) {
    case 'multiple':
      // 疑似投流的不算数：排在所有有机帖子后面（倍数 ≥ 0，所以减一个足够大的数）
      if (score?.multiple === null || score?.multiple === undefined) return -Infinity;
      return score.boosted ? score.multiple - 1e9 : score.multiple;
    case 'views':
      return post.views ?? -1;
    case 'likes':
      return post.likes ?? -1;
    case 'bookmarks':
      return post.bookmarks ?? -1;
    case 'saveRate':
      return saveRate(post) ?? -1;
    case 'recent':
      return post.createdAt ?? -1;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** 按时间范围、是否含回复筛选，再排序；同分按浏览。 */
export function visiblePosts(
  posts: readonly CatalogPost[],
  analysis: ProfileAnalysis,
  options: { sort: ProfileSort; range: ProfileRange; includeReplies: boolean; now: number },
): CatalogPost[] {
  const since = options.range === 'all' ? -Infinity : options.now - Number(options.range) * DAY_MS;
  return posts
    .filter(
      (post) =>
        (options.includeReplies || post.kind !== 'reply') &&
        (post.createdAt === undefined ? options.range === 'all' : post.createdAt >= since),
    )
    .sort(
      (a, b) =>
        sortKey(b, analysis.scores.get(b.postId), options.sort) -
          sortKey(a, analysis.scores.get(a.postId), options.sort) ||
        (b.views ?? 0) - (a.views ?? 0),
    );
}

/** 爆款 Top N：只取有倍数、不是疑似投流的原创和引用。 */
export function topOutliers(
  posts: readonly CatalogPost[],
  analysis: ProfileAnalysis,
  limit = 20,
): CatalogPost[] {
  return posts
    .filter((post) => {
      const score = analysis.scores.get(post.postId);
      return (
        post.kind !== 'reply' && score?.multiple !== null && score !== undefined && !score.boosted
      );
    })
    .sort(
      (a, b) =>
        (analysis.scores.get(b.postId)!.multiple ?? 0) -
        (analysis.scores.get(a.postId)!.multiple ?? 0),
    )
    .slice(0, limit);
}

export function postUrl(handle: string, postId: string): string {
  return `https://x.com/${handle}/status/${postId}`;
}

export interface MarkdownCopy {
  header: (handle: string) => string;
  meta: (median: string, sample: number, date: string) => string;
  ask: string;
  item: (rank: number, multiple: string, views: string, likes: string, saves: string) => string;
}

/** 「复制 Top 20 给 AI」：带分析要求的 Markdown。 */
export function outliersMarkdown(
  handle: string,
  posts: readonly CatalogPost[],
  analysis: ProfileAnalysis,
  copy: MarkdownCopy,
  options: { now: number; formatNumber: (value: number) => string },
): string {
  const day = (ts: number) => new Date(ts).toISOString().slice(0, 10);
  const lines = [copy.header(handle), ''];
  if (analysis.baseline) {
    lines.push(
      copy.meta(
        options.formatNumber(Math.round(analysis.baseline.medianViews)),
        analysis.baseline.sample,
        day(options.now),
      ),
      '',
    );
  }
  lines.push(copy.ask, '');
  posts.forEach((post, index) => {
    const multiple = analysis.scores.get(post.postId)?.multiple;
    lines.push(
      copy.item(
        index + 1,
        multiple === null || multiple === undefined ? '—' : formatMultipleText(multiple),
        post.views === undefined ? '—' : options.formatNumber(post.views),
        post.likes === undefined ? '—' : options.formatNumber(post.likes),
        post.bookmarks === undefined ? '—' : options.formatNumber(post.bookmarks),
      ),
      `${post.createdAt !== undefined ? `${day(post.createdAt)} · ` : ''}${postUrl(handle, post.postId)}`,
      '',
      cleanText(post.snippet),
      '',
    );
  });
  return lines.join('\n').trimEnd() + '\n';
}

function csvCell(value: string | number | boolean | undefined | null): string {
  if (value === undefined || value === null) return '';
  const text = String(value);
  // 防 CSV 注入：= + - @ 开头的单元格在表格软件里会被当成公式
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function postsCsv(
  handle: string,
  posts: readonly CatalogPost[],
  analysis: ProfileAnalysis,
): string {
  const header = [
    'post_id',
    'url',
    'created_at',
    'kind',
    'media',
    'pinned',
    'views',
    'likes',
    'retweets',
    'replies',
    'quotes',
    'bookmarks',
    'multiple',
    'estimated',
    'likely_boosted',
    'text',
  ];
  const rows = posts.map((post) => {
    const score = analysis.scores.get(post.postId);
    return [
      post.postId,
      postUrl(handle, post.postId),
      post.createdAt !== undefined ? new Date(post.createdAt).toISOString() : '',
      post.kind ?? '',
      post.media ?? '',
      post.pinned === true,
      post.views,
      post.likes,
      post.retweets,
      post.replies,
      post.quotes,
      post.bookmarks,
      score?.multiple !== null && score?.multiple !== undefined ? score.multiple.toFixed(2) : '',
      score?.estimated ?? false,
      score?.boosted ?? false,
      cleanText(post.snippet),
    ]
      .map(csvCell)
      .join(',');
  });
  // BOM：Excel 打开中文不乱码
  return '\uFEFF' + [header.join(','), ...rows].join('\r\n') + '\r\n';
}

export type GoogleRange = 'any' | 'y' | 'm' | 'w';
export const GOOGLE_RANGES: readonly GoogleRange[] = ['any', 'y', 'm', 'w'];

/**
 * Google 站内搜索：只搜这个人的帖子页（x.com 和旧的 twitter.com 地址都算），
 * 可加关键词和时间范围（tbs=qdr:y / m / w）。
 */
export function googleSearchUrl(handle: string, keyword: string, range: GoogleRange): string {
  const site = `(site:x.com/${handle}/status OR site:twitter.com/${handle}/status)`;
  const words = keyword.replace(/\s+/g, ' ').trim().slice(0, 200);
  const params = new URLSearchParams({ q: words ? `${site} ${words}` : site });
  if (range !== 'any') params.set('tbs', `qdr:${range}`);
  return `https://www.google.com/search?${params.toString()}`;
}
