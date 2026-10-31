/**
 * 推文 → Markdown（纯函数，便于测试）。思路参考 X Viral Monitor 的「复制为 Markdown」。
 */
import type { UiLanguage } from '../platform/i18n';

export interface MarkdownTweet {
  handle: string;
  displayName?: string;
  postId?: string;
  text: string;
  /** Unix 毫秒 */
  createdAt?: number;
}

/** 本地时区的 `2026-10-29 23:34`。 */
export function formatLocalTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Markdown 行内特殊字符转义（昵称里常见 * _ [ ] 等）。 */
function escapeInline(value: string): string {
  return value.replace(/([\\`*_[\]<>#|])/g, '\\$1');
}

export function tweetUrl(tweet: Pick<MarkdownTweet, 'handle' | 'postId'>): string | undefined {
  return tweet.postId ? `https://x.com/${tweet.handle}/status/${tweet.postId}` : undefined;
}

function author(tweet: MarkdownTweet): string {
  const name = tweet.displayName?.trim();
  return name ? `**${escapeInline(name)}** (@${tweet.handle})` : `**@${tweet.handle}**`;
}

/**
 * ```
 * **昵称** (@handle) · 2026-10-29 23:34
 *
 * 正文（原样保留换行）
 *
 * [原帖](https://x.com/handle/status/id)
 * ```
 */
export function tweetToMarkdown(tweet: MarkdownTweet, language: UiLanguage): string {
  const head = [author(tweet)];
  if (tweet.createdAt !== undefined) head.push(formatLocalTime(tweet.createdAt));
  const parts = [head.join(' · '), tweet.text.trim()];
  const url = tweetUrl(tweet);
  if (url) parts.push(`[${language === 'zh' ? '原帖' : 'Original post'}](${url})`);
  return parts.filter(Boolean).join('\n\n');
}

/** 主推文 + 当前页面已加载的评论。 */
export function threadToMarkdown(
  main: MarkdownTweet,
  replies: MarkdownTweet[],
  language: UiLanguage,
): string {
  const body = tweetToMarkdown(main, language);
  if (replies.length === 0) return body;
  const title =
    language === 'zh' ? `## 评论（${replies.length}）` : `## Replies (${replies.length})`;
  const items = replies.map((reply) => {
    const text = reply.text.trim().replace(/\n+/g, ' ');
    const url = tweetUrl(reply);
    return `- ${author(reply)}${language === 'zh' ? '：' : ': '}${text}${url ? ` [↗](${url})` : ''}`;
  });
  return `${body}\n\n${title}\n\n${items.join('\n')}`;
}
