/**
 * X Reader Adapter 的稳定内部结构（对应 TECHNICAL_SPEC.md §5.1）。
 *
 * 注意：xUserId 必须允许为空 —— 从公开 DOM 只能稳定拿到 handle 和 post id。
 */

export type FeedContext = 'timeline' | 'reply' | 'search' | 'profile' | 'other';

export interface FeedItemAuthor {
  xUserId?: string;
  handle: string;
  displayName?: string;
}

export interface FeedItemLink {
  href: string;
  display?: string;
}

export interface FeedItem {
  source: 'x';
  postId?: string;
  author: FeedItemAuthor;
  text: string;
  links: FeedItemLink[];
  context: FeedContext;
  isReply?: boolean;
  isRepost?: boolean;
}
