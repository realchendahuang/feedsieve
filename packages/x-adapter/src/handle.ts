import type { FeedContext } from './types';

/** 判定为非账号路径的保留前缀（这些不是用户 handle）。 */
const RESERVED_PATH_SEGMENTS = new Set([
  'home',
  'explore',
  'notifications',
  'messages',
  'search',
  'settings',
  'i',
  'intent',
  'hashtag',
  'compose',
]);

/**
 * 从 x.com 站内链接的 pathname 中提取账号 handle。
 *
 * 输入形如 "/kim/status/123?s=20"，输出 "kim"（小写、无 @）。
 * 非账号路径（/home、/i/flow、空路径等）返回 null。
 */
export function extractHandleFromPath(pathname: string): string | null {
  let path = pathname;
  try {
    if (!path.startsWith('/')) {
      // 允许直接传 href（含协议），统一解析取 pathname
      const url = new URL(path);
      if (url.hostname !== 'x.com' && url.hostname !== 'twitter.com') {
        return null;
      }
      path = url.pathname;
    } else {
      // 纯路径输入：先剥掉 query / hash 再取首段
      path = path.split(/[?#]/)[0] ?? path;
    }
  } catch {
    return null;
  }

  const first = path.split('/').filter(Boolean)[0];
  if (!first) {
    return null;
  }
  const decoded = decodeURIComponent(first).toLowerCase();
  if (RESERVED_PATH_SEGMENTS.has(decoded)) {
    return null;
  }
  return decoded;
}

/** X 的 handle 合法字符集（含中文等 Unicode 时 X 实际允许更宽，这里按 ASCII 协议处理）。 */
const CONTEXT_BY_PREFIX: ReadonlyArray<readonly [RegExp, FeedContext]> = [
  [/^\/home/, 'timeline'],
  [/^\/search/, 'search'],
  [/^\/[^/]+\/status\//, 'reply'],
  [/^\/notifications|^\/messages|^\/explore/, 'other'],
];

/** 个人主页上的 Tab；`other` 是关注 / 粉丝列表等不是帖子的页面。 */
export type ProfileTab =
  'posts' | 'replies' | 'reposts' | 'subs' | 'media' | 'highlights' | 'articles' | 'other';

const PROFILE_TABS: Record<string, ProfileTab> = {
  '': 'posts',
  with_replies: 'replies',
  reposts: 'reposts',
  subs: 'subs',
  media: 'media',
  highlights: 'highlights',
  articles: 'articles',
};

/**
 * 个人主页路径 → 主页主人与 Tab：`/kim` → posts，`/kim/with_replies` → replies。
 * 不是个人主页（帖子详情、首页、保留路径）返回 null。
 */
export function profileFromPath(pathname: string): { handle: string; tab: ProfileTab } | null {
  if (contextFromPath(pathname) !== 'profile') return null;
  const handle = extractHandleFromPath(pathname);
  if (!handle || !/^[a-z0-9_]{1,15}$/.test(handle)) return null;
  const second = (pathname.split(/[?#]/)[0] ?? '').split('/').filter(Boolean)[1] ?? '';
  return { handle, tab: PROFILE_TABS[second.toLowerCase()] ?? 'other' };
}

/** URL path -> FeedItem.context。v0.1 只区分四类，其余归 other。 */
export function contextFromPath(pathname: string): FeedContext {
  for (const [pattern, context] of CONTEXT_BY_PREFIX) {
    if (pattern.test(pathname)) {
      return context;
    }
  }
  // 剩下的形如 /handle 或 /handle/following 视为 profile
  return extractHandleFromPath(pathname) ? 'profile' : 'other';
}
