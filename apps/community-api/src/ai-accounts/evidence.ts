/**
 * AI 号判定的证据整理与决策（纯函数，可单测）。
 * 与 scripts/eval-ai-accounts.mjs 的口径一致：评测脚本调参，这里落地。
 */

/** TikHub fetch_user_tweet_replies 返回里用到的字段。 */
export interface VendorTweet {
  tweet_id: string;
  created_at: string;
  text: string;
  in_reply_to_status_id_str?: string | null;
  author?: { screen_name?: string | null; rest_id?: string | null; blue_verified?: boolean | null };
}

export interface VendorTimeline {
  timeline: VendorTweet[];
  user?: { rest_id?: string | null; blue_verified?: boolean | null; protected?: boolean | null };
}

export interface ReplyEvidence {
  id: string;
  parent: string | null;
  text: string;
}

export interface Rhythm {
  /** 回复间隔 ≤90 秒的占比 */
  fast: number;
  /** ≤6 字短回复的占比 */
  short: number;
  /** 回复长度的变异系数 */
  cv: number;
}

export type AiVerdict = 'ai' | 'suspect' | 'human' | 'insufficient';

/** 每次判定最多 10 条、至少 6 条（2026-10-31 为省 token 从 15 / 8 下调） */
export const MAX_REPLIES = 10;
export const MIN_REPLIES = 6;
/** 截断长度：原帖只给上下文，回复看写法，都不需要全文（省 token） */
export const MAX_REPLY_CHARS = 200;
export const MAX_PARENT_CHARS = 80;

/**
 * 判定阈值（按判定模型重新校准：2026-11-07 换成 Cloudflare 自家 Clef 后重扫 247 个标注账号）。
 *
 * 口径：AI 号 33 / 真人 210，10 条一批、灰区补判第二批取平均，节奏分支条件不变。
 * 结果：强线 0.80 / 节奏分支 0.65 / 疑似 0.75 → AI 号命中 20/33，真人误判为 AI 号 4/210（1.9%，
 * 与旧政策「≤3%」同档），真人落入疑似 3/210。
 * 对照：Jev 口径 0.55 / 0.45 / 0.40 是 18/33、1/212、5/212；两套模型分数不可互比，缓存里过期的旧分数
 * 只能按其 verdict 展示，不能按新阈值重新解释。
 */
export const DECISION = {
  strong: 0.8,
  /** 节奏分支下限：Clef ≥ 0.65 且节奏机械 → ai */
  weak: 0.65,
  /** 疑似下限：Clef ≥ 0.75 → 至少 suspect（Clef 的真人分数上限比 Jev 高，疑似线也随之上移） */
  suspect: 0.75,
  fast: 0.6,
  maxShort: 0.05,
  maxCv: 0.45,
} as const;

const LEADING_MENTIONS = /^(@\w+\s+)+/;
const TCO_LINK = /https:\/\/t\.co\/\S+/g;

/** 按码点截断，并去掉截断产生的孤立代理项（模型 API 会拒绝非法 Unicode）。 */
function cut(value: string, max: number): string {
  return [...value]
    .slice(0, max)
    .join('')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD');
}

function ownReplies(handle: string, data: VendorTimeline): VendorTweet[] {
  const lower = handle.toLowerCase();
  return data.timeline.filter(
    (t) => t.author?.screen_name?.toLowerCase() === lower && Boolean(t.in_reply_to_status_id_str),
  );
}

/** 该账号自己的回复并配对原帖；同一原帖只取一条，最多 15 条。 */
export function buildReplies(handle: string, data: VendorTimeline): ReplyEvidence[] {
  const byId = new Map(data.timeline.map((t) => [t.tweet_id, t]));
  const seenParents = new Set<string>();
  const out: ReplyEvidence[] = [];
  for (const t of ownReplies(handle, data)) {
    const parentId = t.in_reply_to_status_id_str as string;
    if (seenParents.has(parentId)) continue;
    seenParents.add(parentId);
    const text = t.text.replace(LEADING_MENTIONS, '').replace(TCO_LINK, '').trim();
    if (!text) continue;
    const parent = byId.get(parentId);
    out.push({
      id: t.tweet_id,
      parent: parent ? cut(parent.text.replace(TCO_LINK, '').trim(), MAX_PARENT_CHARS) : null,
      text: cut(text, MAX_REPLY_CHARS),
    });
    if (out.length >= MAX_REPLIES) break;
  }
  return out;
}

/** 回复间隔（秒，按时间先后，最多 15 个）。 */
export function replyGaps(handle: string, data: VendorTimeline): number[] {
  const at = ownReplies(handle, data)
    .map((t) => Date.parse(t.created_at))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  return at
    .slice(1)
    .map((x, i) => Math.round((x - (at[i] as number)) / 1000))
    .slice(-15);
}

export function rhythm(handle: string, data: VendorTimeline): Rhythm {
  const gaps = replyGaps(handle, data);
  const lens = ownReplies(handle, data).map(
    (t) => [...t.text.replace(LEADING_MENTIONS, '').replace(TCO_LINK, '').trim()].length,
  );
  return rhythmFrom(lens, gaps);
}

/**
 * 从已配对的回复证据直接算节奏（证据直传路径用，不依赖 TikHub timeline）。
 * 口径与 rhythm() 一致：≤90 秒间隔占比、≤6 字短回复占比、长度变异系数。
 */
export function rhythmFromReplies(replies: ReplyEvidence[], gaps: number[]): Rhythm {
  const lens = replies.map(
    (r) => [...r.text.replace(LEADING_MENTIONS, '').replace(TCO_LINK, '').trim()].length,
  );
  return rhythmFrom(lens, gaps);
}

function rhythmFrom(lens: number[], gaps: number[]): Rhythm {
  const n = Math.max(lens.length, 1);
  const mean = lens.reduce((s, v) => s + v, 0) / n;
  const sd = Math.sqrt(lens.reduce((s, v) => s + (v - mean) ** 2, 0) / n);
  return {
    fast: gaps.filter((g) => g <= 90).length / Math.max(gaps.length, 1),
    short: lens.filter((v) => v <= 6).length / n,
    cv: mean ? sd / mean : 0,
  };
}

/** 模型分 ≥ 0.80 → ai；≥ 0.65 且节奏机械 → ai；其余 ≥ 0.75 → suspect；更低 → human。 */
export function decide(score: number, r: Rhythm): Exclude<AiVerdict, 'insufficient'> {
  if (score >= DECISION.strong) return 'ai';
  const mechanical =
    r.fast >= DECISION.fast && r.short <= DECISION.maxShort && r.cv <= DECISION.maxCv;
  if (score >= DECISION.weak && mechanical) return 'ai';
  return score >= DECISION.suspect ? 'suspect' : 'human';
}
