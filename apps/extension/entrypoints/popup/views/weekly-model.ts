/**
 * 「周刊」Tab 的数据：向周刊站点要最新一期。
 *
 * 接口在 feedsieve-weekly 的 /weekly/api/public/latest-issue（只读、CORS 放行），
 * 返回期号、标题、条数、期页地址和这一期的 OG 封面。拿不到就退回站点封面和第 1 期，
 * 推荐位不能因为网络问题变成空白或错误页。
 */
export const WEEKLY_URL = 'https://feedsieve.win/weekly';
export const WEEKLY_SITE_COVER = `${WEEKLY_URL}/og/site.png?v=2`;
export const WEEKLY_LATEST_API = `${WEEKLY_URL}/api/public/latest-issue`;
/** 接口不可用时的兜底：目前唯一一期。 */
export const WEEKLY_FALLBACK_ISSUE_URL = `${WEEKLY_URL}/issues/1`;

export interface WeeklyIssue {
  number: number;
  title: string | null;
  postCount: number;
  publishedAt: string;
  url: string;
  cover: string;
}

/** 跨消息/网络边界读回来的数据再校验一遍：只认周刊自己的期页和 OG 图。 */
export function asWeeklyIssue(value: unknown): WeeklyIssue | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const number =
    typeof raw.number === 'number' && Number.isInteger(raw.number) && raw.number > 0
      ? raw.number
      : null;
  const url =
    typeof raw.url === 'string' && raw.url.startsWith(`${WEEKLY_URL}/issues/`) ? raw.url : null;
  const cover =
    typeof raw.cover === 'string' && raw.cover.startsWith(`${WEEKLY_URL}/og/`) ? raw.cover : null;
  if (number === null || !url || !cover) return null;
  return {
    number,
    title:
      typeof raw.title === 'string' && raw.title.trim()
        ? raw.title.trim().slice(0, 200)
        : null,
    postCount:
      typeof raw.postCount === 'number' && Number.isFinite(raw.postCount) && raw.postCount >= 0
        ? Math.floor(raw.postCount)
        : 0,
    publishedAt: typeof raw.publishedAt === 'string' ? raw.publishedAt : '',
    url,
    cover,
  };
}

export async function fetchLatestIssue(signal?: AbortSignal): Promise<WeeklyIssue | null> {
  try {
    const response = await fetch(WEEKLY_LATEST_API, {
      headers: { accept: 'application/json' },
      signal,
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { issue?: unknown };
    return asWeeklyIssue(data?.issue);
  } catch {
    return null;
  }
}
