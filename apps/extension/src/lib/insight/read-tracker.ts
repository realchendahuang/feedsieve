/**
 * 「已读」追踪（内容脚本）：帖子在 X 上真正被看过，热帖列表就可以把它藏起来。
 *
 * 算已读的两种情况：
 * - 推文至少 60% 在屏幕里、连续停留 READ_DWELL_MS（快速滑过的不算）；
 * - 打开了帖子详情页（地址是 /用户/status/帖子ID）。
 * 从弹窗热帖里点开的帖子由弹窗自己标记。
 *
 * 另外记「上屏」：推文第一次至少 60% 出现在屏幕上的时刻（不要求停留），
 * 热帖「最近刷到」按它排序。X 会预加载还没滑到的推文，用加载时刻排会把没看到的排上去。
 *
 * 只在本地用：已读的帖子 ID 批量交给后台，存在 storage.session，不上传。
 */
import { extractTweetIdentity } from '@feedsieve/x-adapter';

export const READ_DWELL_MS = 2_000;
export const INSIGHT_READ_MESSAGE = 'feedsieve:insight-read';
export const INSIGHT_SEEN_MESSAGE = 'feedsieve:insight-seen';
const FLUSH_MS = 3_000;
/** 上屏记录发得快一些：弹窗「最近刷到」要跟得上滑动。 */
const SEEN_FLUSH_MS = 1_000;

export interface SeenPost {
  postId: string;
  at: number;
}
const STATUS_PATH = /^\/[A-Za-z0-9_]{1,15}\/status\/(\d{1,20})/;

export function createReadTracker(deps: {
  send: (postIds: string[]) => Promise<unknown>;
  sendSeen?: (posts: SeenPost[]) => Promise<unknown>;
  dwellMs?: number;
  now?: () => number;
}) {
  const now = deps.now ?? (() => Date.now());
  const dwellMs = deps.dwellMs ?? READ_DWELL_MS;
  const timers = new Map<Element, ReturnType<typeof setTimeout>>();
  const watched = new WeakSet<Element>();
  const reported = new Set<string>();
  let pending: string[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  const seenReported = new Set<string>();
  let pendingSeen: SeenPost[] = [];
  let seenTimer: ReturnType<typeof setTimeout> | undefined;

  function flushSeen(): void {
    seenTimer = undefined;
    if (pendingSeen.length === 0 || !deps.sendSeen) return;
    const batch = pendingSeen;
    pendingSeen = [];
    void deps.sendSeen(batch).catch(() => undefined);
  }

  function markSeen(postId: string): void {
    if (!deps.sendSeen || seenReported.has(postId)) return;
    seenReported.add(postId);
    pendingSeen.push({ postId, at: now() });
    seenTimer ??= setTimeout(flushSeen, SEEN_FLUSH_MS);
  }

  function flush(): void {
    flushTimer = undefined;
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    void deps.send(batch).catch(() => undefined);
  }

  function markRead(postId: string): void {
    if (reported.has(postId)) return;
    reported.add(postId);
    pending.push(postId);
    flushTimer ??= setTimeout(flush, FLUSH_MS);
  }

  const observer =
    typeof IntersectionObserver === 'undefined'
      ? null
      : new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              const article = entry.target;
              const existing = timers.get(article);
              if (entry.isIntersecting) {
                const visible = article.isConnected
                  ? extractTweetIdentity(article)?.postId
                  : undefined;
                if (visible) markSeen(visible);
                if (existing) continue;
                timers.set(
                  article,
                  setTimeout(() => {
                    timers.delete(article);
                    // X 会复用节点显示别的推文：到点时再读一次当前是哪条
                    const postId = article.isConnected
                      ? extractTweetIdentity(article)?.postId
                      : undefined;
                    if (postId) markRead(postId);
                  }, dwellMs),
                );
              } else if (existing) {
                clearTimeout(existing);
                timers.delete(article);
              }
            }
          },
          { threshold: 0.6 },
        );

  function watch(article: Element): void {
    if (!observer || watched.has(article)) return;
    watched.add(article);
    observer.observe(article);
  }

  /** 打开帖子详情页即视为已读。 */
  function visit(pathname: string): void {
    const postId = STATUS_PATH.exec(pathname)?.[1];
    if (postId) markRead(postId);
  }

  return {
    watch,
    visit,
    flush: () => {
      flush();
      flushSeen();
    },
  };
}

export type ReadTracker = ReturnType<typeof createReadTracker>;
