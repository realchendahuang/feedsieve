/**
 * AI 味检测的证据收集（纯函数，可单测）。
 *
 * 用户打开某个账号的「回复」页（/{handle}/with_replies），X 按会话把「被回复的原帖」和
 * 「这个账号的回复」上下排在一起。这里按页面顺序配对：主人的一条帖子前面紧挨着别人的帖子，
 * 就是一条回复，前面那条是原帖。X 的列表是虚拟滚动，滚过去的节点会被回收，所以证据要跨多次
 * 扫描累积（ReplyCollector）。
 *
 * 只读页面上已经显示的内容，不额外请求 X。口径与服务端 ai-accounts/evidence.ts 一致：
 * 同一原帖只取一条、最多 15 条、至少 8 条才判；回复间隔从帖子 ID（snowflake）算发帖时间。
 */

/** 每批 10 条、至少 6 条（与服务端同口径；为省 token 从 15 / 8 下调） */
export const MAX_REPLIES = 10;
export const MIN_REPLIES = 6;
/** 至少回给这么多个不同的人：都回同一个人时看不出「换个话题照样套模板」 */
export const MIN_AUTHORS = 4;
/** 同一个原帖作者最多取几条 */
export const MAX_PER_AUTHOR = 2;
const TWITTER_EPOCH = 1288834974657n;
/** 截断：原帖只给上下文、回复看写法，都不需要全文（每个字都是 token） */
const MAX_TEXT = 200;
const MAX_PARENT = 80;

export interface PageTweet {
  postId?: string;
  handle: string;
  text: string;
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

const TCO = /https:\/\/t\.co\/\S+/g;
const cut = (value: string, max: number) =>
  [...value.replace(TCO, '').trim()].slice(0, max).join('').trim();

/** snowflake 帖子 ID → 发帖时间（毫秒）；不是合法 ID 返回 null。 */
export function snowflakeMs(id: string): number | null {
  if (!/^\d{1,20}$/.test(id)) return null;
  const ms = Number((BigInt(id) >> 22n) + TWITTER_EPOCH);
  return ms > Number(TWITTER_EPOCH) ? ms : null;
}

/** 跨多次扫描累积某个账号的回复证据（新的在前，与页面顺序一致）。 */
/** X 接口返回的一条帖子（xhr-bridge 消毒后的子集）。 */
export interface ApiTweet {
  postId?: string;
  handle: string;
  text?: string;
  inReplyToId?: string;
  inReplyToHandle?: string;
}

export class ReplyCollector {
  private replies = new Map<string, ReplyEvidence>();
  /** 收到过的帖子正文（找原帖用） */
  private known = new Map<string, { text: string; handle: string }>();
  private parents = new Set<string>();
  private perAuthor = new Map<string, number>();
  private authorOf = new Map<string, string>();
  /** 收集上限：灰色地带补判时调高，继续往下读 */
  limit = MAX_REPLIES;

  constructor(readonly handle: string) {}

  get size(): number {
    return this.replies.size;
  }

  get full(): boolean {
    return this.replies.size >= this.limit;
  }

  /** 证据够判：条数够、回给的人也够分散 */
  get enough(): boolean {
    return this.replies.size >= MIN_REPLIES && this.authorCount() >= MIN_AUTHORS;
  }

  /** 回给了几个不同的人（只统计，不上传这些人的账号） */
  authorCount(ids?: readonly string[]): number {
    const pick = ids ?? [...this.replies.keys()];
    return new Set(pick.map((id) => this.authorOf.get(id)).filter(Boolean)).size;
  }

  /** 读一次页面上按顺序排列的帖子，返回新增条数。 */
  observe(tweets: readonly PageTweet[]): number {
    const owner = this.handle.toLowerCase();
    let added = 0;
    for (let i = 1; i < tweets.length && !this.full; i++) {
      const tweet = tweets[i]!;
      const prev = tweets[i - 1]!;
      if (tweet.handle.toLowerCase() !== owner || prev.handle.toLowerCase() === owner) continue;
      if (!tweet.postId || this.replies.has(tweet.postId)) continue;
      const text = cut(tweet.text, MAX_TEXT);
      const parent = cut(prev.text, MAX_PARENT) || null;
      // 纯图片 / 纯表情回复没有可判的文字；同一原帖只取一条
      if (!text) continue;
      const parentKey = prev.postId ?? parent ?? '';
      if (parentKey && this.parents.has(parentKey)) continue;
      const author = prev.handle.toLowerCase();
      if ((this.perAuthor.get(author) ?? 0) >= MAX_PER_AUTHOR) continue;
      if (parentKey) this.parents.add(parentKey);
      this.perAuthor.set(author, (this.perAuthor.get(author) ?? 0) + 1);
      this.authorOf.set(tweet.postId, author);
      this.replies.set(tweet.postId, { id: tweet.postId, parent, text });
      added += 1;
    }
    return added;
  }

  /**
   * 读 X 接口已经返回的帖子（回复页的 UserTweetsAndReplies 等）：回复自带「回的哪条帖子、回的是谁」，
   * 不用靠页面上下顺序猜配对。原帖正文从同一批或之前收到的帖子里找；找不到就只给回复本身。
   * 新增的回复按发帖时间从新到旧插入，和页面顺序一致。
   */
  observeApi(tweets: readonly ApiTweet[]): number {
    const owner = this.handle.toLowerCase();
    for (const t of tweets) {
      if (t.postId && t.text)
        this.known.set(t.postId, { text: t.text, handle: t.handle.toLowerCase() });
    }
    let added = 0;
    const own = tweets
      .filter((t) => t.handle.toLowerCase() === owner && t.inReplyToId && t.postId && t.text)
      .sort((a, b) => (snowflakeMs(b.postId!) ?? 0) - (snowflakeMs(a.postId!) ?? 0));
    for (const t of own) {
      if (this.full) break;
      if (this.replies.has(t.postId!)) continue;
      const author = (
        t.inReplyToHandle ??
        this.known.get(t.inReplyToId!)?.handle ??
        ''
      ).toLowerCase();
      // 回自己的帖子（自己串自己）不算回复别人
      if (!author || author === owner) continue;
      if (this.parents.has(t.inReplyToId!)) continue;
      if ((this.perAuthor.get(author) ?? 0) >= MAX_PER_AUTHOR) continue;
      const text = cut((t.text ?? '').replace(/^(@\w+\s+)+/, ''), MAX_TEXT);
      if (!text) continue;
      const parentText = this.known.get(t.inReplyToId!)?.text;
      this.parents.add(t.inReplyToId!);
      this.perAuthor.set(author, (this.perAuthor.get(author) ?? 0) + 1);
      this.authorOf.set(t.postId!, author);
      this.replies.set(t.postId!, {
        id: t.postId!,
        parent: parentText ? cut(parentText, MAX_PARENT) || null : null,
        text,
      });
      added += 1;
    }
    return added;
  }

  list(): ReplyEvidence[] {
    // 从新到旧：服务端先判最近的一批
    return [...this.replies.values()].sort(
      (a, b) => (snowflakeMs(b.id) ?? 0) - (snowflakeMs(a.id) ?? 0),
    );
  }
}

/** 回复间隔（秒，按时间先后）。 */
export function replyGaps(replies: readonly ReplyEvidence[]): number[] {
  const at = replies
    .map((r) => snowflakeMs(r.id))
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);
  return at.slice(1).map((x, i) => Math.round((x - at[i]!) / 1000));
}

export function rhythmOf(replies: readonly ReplyEvidence[], gaps: readonly number[]): Rhythm {
  const lens = replies.map((r) => [...r.text.replace(/https:\/\/t\.co\/\S+/g, '').trim()].length);
  const n = Math.max(lens.length, 1);
  const mean = lens.reduce((s, v) => s + v, 0) / n;
  const sd = Math.sqrt(lens.reduce((s, v) => s + (v - mean) ** 2, 0) / n);
  return {
    fast: gaps.filter((g) => g <= 90).length / Math.max(gaps.length, 1),
    short: lens.filter((v) => v <= 6).length / n,
    cv: mean ? sd / mean : 0,
  };
}

/** 样本跨越的时间（秒）：最早到最晚一条回复。 */
export function replySpan(replies: readonly ReplyEvidence[]): number | null {
  const at = replies.map((r) => snowflakeMs(r.id)).filter((v): v is number => v !== null);
  return at.length >= 2 ? Math.round((Math.max(...at) - Math.min(...at)) / 1000) : null;
}

/** 间隔中位数（秒），报告里显示「平均隔多久回一条」。 */
export function medianGap(gaps: readonly number[]): number | null {
  if (!gaps.length) return null;
  const sorted = [...gaps].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}
