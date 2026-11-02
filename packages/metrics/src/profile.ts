/**
 * 主页洞察：一个博主的帖子相对他自己的表现。
 *
 * 核心是「爆款倍数」：帖子浏览 ÷ 这个博主帖子浏览的中位数。用中位数不用平均数，
 * 一两条大爆款不会把基线拉高（X Sort 用平均数，XOutlier 用中位数，见 docs/07 §1）。
 *
 * 基线只算原创和引用、发出满 24 小时的帖子：回复的浏览天然低，刚发的帖子还在涨。
 * 刚发的帖子用「预计 24 小时浏览」算倍数，标记为估算。
 */
import { resolveConfig, type MetricsConfig } from './config';
import { ageHours, projectedViews } from './tweet';

export type ProfilePostKind = 'original' | 'reply' | 'quote';
export type ProfilePostMedia = 'none' | 'photo' | 'video' | 'gif' | 'mixed';
/** 主页洞察里比较的内容形式。 */
export type ProfileFormat = 'text' | 'photo' | 'video' | 'quote';
export const PROFILE_FORMATS: readonly ProfileFormat[] = ['text', 'photo', 'video', 'quote'];

export interface ProfilePost {
  postId: string;
  createdAt?: number;
  views?: number;
  likes?: number;
  retweets?: number;
  replies?: number;
  quotes?: number;
  bookmarks?: number;
  kind?: ProfilePostKind;
  media?: ProfilePostMedia;
  pinned?: boolean;
}

/** 少于这么多条成熟帖子，不算基线，也不算倍数。 */
export const PROFILE_MIN_SAMPLE = 10;
/** 发出满这么久才算进基线。 */
export const PROFILE_MATURE_HOURS = 24;
/** 倍数达到这个值算爆款。 */
export const OUTLIER_MULTIPLE = 3;
/** 各形式至少这么多条才显示。 */
export const PROFILE_GROUP_MIN = 5;
/**
 * 热力图按 4 小时一段（7 × 6 格）：几百条帖子分到 7 × 24 格里大多是空格，看不出规律。
 * 一格至少 2 条才着色；着色的格子不到 4 个时整张图不显示。
 */
export const HEATMAP_SLOT_HOURS = 4;
export const HEATMAP_SLOTS = 24 / HEATMAP_SLOT_HOURS;
const HEATMAP_CELL_MIN = 2;
const HEATMAP_MIN_CELLS = 4;

export interface ProfileBaseline {
  medianViews: number;
  medianLikes: number;
  /** 参与基线的帖子数。 */
  sample: number;
}

export interface PostScore {
  /** 爆款倍数；没有基线或没有浏览数时为 null。 */
  multiple: number | null;
  /** 发出不满 24 小时，倍数按预计浏览估算。 */
  estimated: boolean;
}

export interface FormatStat {
  format: ProfileFormat;
  count: number;
  medianMultiple: number;
}

export interface ProfileAnalysis {
  baseline: ProfileBaseline | null;
  scores: Map<string, PostScore>;
  /** 成熟基线帖子里倍数 ≥ 3 的比例。 */
  outlierRate: number | null;
  /** 样本够的形式，按中位倍数从高到低。 */
  formats: FormatStat[];
  /**
   * 7 × 6 格子（星期日 = 0；每格 4 小时，按本地时间）：这个时段发的帖子的中位倍数；
   * 样本不够的格子是 null。着色的格子太少时整张图为 null。
   */
  heatmap: { cells: Array<Array<number | null>>; counts: number[][] } | null;
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** 能参与基线的帖子：不是回复，有浏览数和发帖时间。 */
export function isBaselinePost(post: ProfilePost): boolean {
  return post.kind !== 'reply' && isCount(post.views) && isCount(post.createdAt);
}

function isMature(post: ProfilePost, now: number): boolean {
  const age = ageHours(post.createdAt, now);
  return age !== null && age >= PROFILE_MATURE_HOURS;
}

export function profileBaseline(
  posts: readonly ProfilePost[],
  now: number,
): ProfileBaseline | null {
  const mature = posts.filter((post) => isBaselinePost(post) && isMature(post, now));
  if (mature.length < PROFILE_MIN_SAMPLE) return null;
  const medianViews = median(mature.map((post) => post.views!))!;
  if (medianViews <= 0) return null;
  return {
    medianViews,
    medianLikes: median(mature.map((post) => (isCount(post.likes) ? post.likes : 0)))!,
    sample: mature.length,
  };
}

/** 单条帖子的倍数：成熟帖子用实际浏览，刚发的用预计 24 小时浏览。 */
export function outlierMultiple(
  post: Pick<ProfilePost, 'views' | 'createdAt'>,
  baseline: ProfileBaseline | null,
  now: number,
  overrides?: Partial<MetricsConfig>,
): { value: number; estimated: boolean } | null {
  if (!baseline || !isCount(post.views)) return null;
  const age = ageHours(post.createdAt, now);
  if (age === null) return null;
  if (age >= PROFILE_MATURE_HOURS) {
    return { value: post.views / baseline.medianViews, estimated: false };
  }
  const projected = projectedViews(post.views, age, resolveConfig(overrides)) ?? post.views;
  return { value: projected / baseline.medianViews, estimated: true };
}

export function formatOf(post: ProfilePost): ProfileFormat {
  if (post.kind === 'quote') return 'quote';
  if (post.media === 'photo') return 'photo';
  if (post.media === 'video' || post.media === 'gif' || post.media === 'mixed') return 'video';
  return 'text';
}

const defaultLocalParts = (timestamp: number): { day: number; hour: number } => {
  const date = new Date(timestamp);
  return { day: date.getDay(), hour: date.getHours() };
};

export function analyzeProfile(
  posts: readonly ProfilePost[],
  now: number,
  options: { localParts?: (timestamp: number) => { day: number; hour: number } } = {},
): ProfileAnalysis {
  const localParts = options.localParts ?? defaultLocalParts;
  const baseline = profileBaseline(posts, now);
  const scores = new Map<string, PostScore>();
  const mature = posts.filter((post) => isBaselinePost(post) && isMature(post, now));

  for (const post of posts) {
    const result = outlierMultiple(post, baseline, now);
    scores.set(post.postId, {
      multiple: result?.value ?? null,
      estimated: result?.estimated ?? false,
    });
  }

  if (!baseline) return { baseline, scores, outlierRate: null, formats: [], heatmap: null };

  const outliers = mature.filter((post) => scores.get(post.postId)!.multiple! >= OUTLIER_MULTIPLE);
  const outlierRate = mature.length > 0 ? outliers.length / mature.length : null;

  const byFormat = new Map<ProfileFormat, number[]>();
  for (const post of mature) {
    const format = formatOf(post);
    byFormat.set(format, [...(byFormat.get(format) ?? []), scores.get(post.postId)!.multiple!]);
  }
  const formats = [...byFormat.entries()]
    .filter(([, values]) => values.length >= PROFILE_GROUP_MIN)
    .map(([format, values]) => ({ format, count: values.length, medianMultiple: median(values)! }))
    .sort((a, b) => b.medianMultiple - a.medianMultiple);

  const grid: number[][][] = Array.from({ length: 7 }, () =>
    Array.from({ length: HEATMAP_SLOTS }, () => []),
  );
  for (const post of mature) {
    const { day, hour } = localParts(post.createdAt!);
    grid[day]?.[Math.floor(hour / HEATMAP_SLOT_HOURS)]?.push(scores.get(post.postId)!.multiple!);
  }
  const counts = grid.map((row) => row.map((cell) => cell.length));
  const cells = grid.map((row) =>
    row.map((cell) => (cell.length >= HEATMAP_CELL_MIN ? median(cell) : null)),
  );
  const colored = cells.flat().filter((cell) => cell !== null).length;
  const heatmap = colored >= HEATMAP_MIN_CELLS ? { cells, counts } : null;

  return { baseline, scores, outlierRate, formats, heatmap };
}

/**
 * 「在 X 搜这个人的高赞帖」用的点赞门槛：中位点赞的 5 倍，取整到好看的数，
 * 最低 10（再低就搜出普通帖子了）。
 */
export function highLikesThreshold(baseline: ProfileBaseline | null): number {
  const raw = baseline ? baseline.medianLikes * 5 : 0;
  if (raw < 10) return 10;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  return Math.round(raw / magnitude) * magnitude;
}

/** X 帖子 ID 里编码的发帖时间（毫秒）。众包防伪造用：上报的 created_at 必须和它对得上（docs/07 §3.3）。 */
export function snowflakeTime(postId: string): number | null {
  if (!/^\d{1,20}$/.test(postId)) return null;
  try {
    return Number((BigInt(postId) >> 22n) + 1288834974657n);
  } catch {
    return null;
  }
}
