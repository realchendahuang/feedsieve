import type { BlockEvidence } from '../../../src/lib/detection/detection-evidence';
import { useId, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { MarkStrength } from '@feedsieve/community-lists';
import type { AllowlistItem } from '../../../src/lib/community/allowlist';
import { normalizeStrictHandle } from '../../../src/lib/platform/xhr-bridge-guard';
import { openOfficialPage, SITE_URLS, type SiteList } from '../../../src/lib/platform/site-links';
import { localizedDetectionReason, type UiLanguage } from '../../../src/lib/platform/i18n';
import { formatAgo as sharedFormatAgo } from '@feedsieve/shared';
import {
  accountTier,
  ageHours,
  replyOpportunity,
  TIER_LEVELS,
  TIER_MAX,
} from '@feedsieve/metrics';

export type AppIconName =
  | 'clean'
  | 'lists'
  | 'settings'
  | 'refresh'
  | 'shield'
  | 'detect'
  | 'plus'
  | 'x'
  | 'check'
  | 'copy'
  | 'contribute'
  | 'sidepanel'
  | 'flame'
  | 'trending'
  | 'external'
  | 'chevron'
  | 'search'
  | 'globe'
  | 'sparkles'
  | 'download'
  | 'image'
  | 'calendar'
  | 'up'
  | 'down'
  | 'chevrons-down';

export function AppIcon({
  name,
  size = 20,
  className,
}: {
  name: AppIconName;
  size?: number;
  className?: string;
}) {
  const paths: Record<AppIconName, ReactNode> = {
    // lucide: external-link / chevron-right（ISC License）
    external: (
      <>
        <path d="M15 3h6v6" />
        <path d="M10 14 21 3" />
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      </>
    ),
    chevron: <path d="m9 18 6-6-6-6" />,
    // lucide calendar-clock / chevron-up / chevron-down（ISC License）
    calendar: (
      <>
        <path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5" />
        <path d="M16 2v4" />
        <path d="M8 2v4" />
        <path d="M3 10h5" />
        <path d="M17.5 17.5 16 16.3V14" />
        <circle cx="16" cy="16" r="6" />
      </>
    ),
    up: <path d="m18 15-6-6-6 6" />,
    down: <path d="m6 9 6 6 6-6" />,
    // lucide: chevrons-down（ISC License）— 两个箭头表示「加载更多」，不是下载
    'chevrons-down': (
      <>
        <path d="m7 6 5 5 5-5" />
        <path d="m7 13 5 5 5-5" />
      </>
    ),
    // lucide: search / globe / sparkles / download（ISC License）
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </>
    ),
    globe: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18" />
        <path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18Z" />
      </>
    ),
    sparkles: (
      <>
        <path d="M10 3.5 11.6 8a2 2 0 0 0 1.3 1.3l4.6 1.6-4.6 1.6a2 2 0 0 0-1.3 1.3L10 18.4l-1.6-4.6a2 2 0 0 0-1.3-1.3L2.5 10.9l4.6-1.6A2 2 0 0 0 8.4 8Z" />
        <path d="M19 3v4M21 5h-4M18 16v4M20 18h-4" />
      </>
    ),
    download: (
      <>
        <path d="M12 3v12" />
        <path d="m7 10 5 5 5-5" />
        <path d="M5 21h14" />
      </>
    ),
    image: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="9" cy="9" r="2" />
        <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
      </>
    ),
    // lucide: trending-up（ISC License）
    trending: (
      <>
        <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
        <polyline points="16 7 22 7 22 13" />
      </>
    ),
    flame: (
      <>
        <path d="M12 21c-3.6 0-6.5-2.7-6.5-6.2 0-2.6 1.5-4.4 2.9-5.9.4 1.4 1.2 2.4 2.3 2.9C10.3 8.6 11.3 5.6 14 3c.3 3 1.8 4.6 3.1 6.2 1 1.3 1.9 2.8 1.9 5 0 3.8-3 6.8-7 6.8Z" />
        <path d="M12 21c-1.7 0-3-1.3-3-3 0-1.5 1-2.5 2-3.5.3 1 .9 1.5 1.6 1.7.2-1 .7-2 1.6-2.7.3 1.5 1.8 2.4 1.8 4.3 0 1.8-1.6 3.2-4 3.2Z" />
      </>
    ),
    sidepanel: (
      <>
        <rect width="18" height="18" x="3" y="3" rx="2" />
        <path d="M15 3v18" />
      </>
    ),
    clean: (
      <>
        <path d="M12 3.25 5 6.1v5.15c0 4.3 2.82 7.7 7 9.5 4.18-1.8 7-5.2 7-9.5V6.1L12 3.25Z" />
        <path d="m8.6 12 2.15 2.15 4.75-5" />
      </>
    ),
    lists: (
      <>
        <path d="M9.25 6.25h9.5M9.25 12h9.5M9.25 17.75h9.5" />
        <circle cx="5.25" cy="6.25" r="1" />
        <circle cx="5.25" cy="12" r="1" />
        <circle cx="5.25" cy="17.75" r="1" />
      </>
    ),
    settings: (
      <>
        <path d="M4 7h10M18 7h2M4 17h2M10 17h10M4 12h4M12 12h8" />
        <circle cx="16" cy="7" r="2" />
        <circle cx="8" cy="17" r="2" />
        <circle cx="10" cy="12" r="2" />
      </>
    ),
    refresh: (
      <>
        <path d="M20 7v5h-5" />
        <path d="M18.35 16.1A8 8 0 1 1 19.6 9" />
      </>
    ),
    shield: (
      <>
        <path d="M12 3.25 5 6.1v5.15c0 4.3 2.82 7.7 7 9.5 4.18-1.8 7-5.2 7-9.5V6.1L12 3.25Z" />
        <path d="m9 12 2 2 4-4" />
      </>
    ),
    detect: (
      <>
        <circle cx="11" cy="11" r="6.5" />
        <path d="m20 20-4.5-4.5" />
      </>
    ),
    plus: (
      <>
        <path d="M12 5v14M5 12h14" />
      </>
    ),
    x: (
      <>
        <path d="M18 6 6 18M6 6l12 12" />
      </>
    ),
    check: (
      <>
        <path d="m4.5 12.5 5 5 10-11" />
      </>
    ),
    copy: (
      <>
        <rect x="9" y="9" width="11" height="11" rx="2" />
        <path d="M5 15V5a2 2 0 0 1 2-2h10" />
      </>
    ),
    contribute: (
      <>
        <path d="M12 14V4M8.5 7.5 12 4l3.5 3.5" />
        <path d="M5 12v6.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V12" />
      </>
    ),
  };

  return (
    <svg
      aria-hidden="true"
      className={`app-icon${className ? ` ${className}` : ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}

/**
 * 悬浮提示（`!` 图标、倍数标签、图标按钮共用）：鼠标移上去或键盘聚焦时显示，
 * 挂到 body 上，弹窗边缘也不会被裁掉。
 */
export function useTip(text: string) {
  const [tooltip, setTooltip] = useState<{
    left: number;
    top: number;
    placement: 'top' | 'bottom';
  } | null>(null);
  const tooltipId = useId();
  const show = (target: HTMLElement) => {
    const rect = target.getBoundingClientRect();
    const placement = rect.top > 84 ? 'top' : 'bottom';
    const left = Math.min(Math.max(rect.left + rect.width / 2, 120), window.innerWidth - 120);
    setTooltip({ left, top: placement === 'top' ? rect.top - 8 : rect.bottom + 8, placement });
  };
  const handlers = {
    'aria-describedby': tooltip ? tooltipId : undefined,
    onMouseEnter: (event: { currentTarget: HTMLElement }) => show(event.currentTarget),
    onMouseLeave: () => setTooltip(null),
    onFocus: (event: { currentTarget: HTMLElement }) => show(event.currentTarget),
    onBlur: () => setTooltip(null),
    onKeyDown: (event: { key: string }) => {
      if (event.key === 'Escape') setTooltip(null);
    },
  };
  const node = tooltip
    ? createPortal(
        <span
          id={tooltipId}
          role="tooltip"
          className="help-tooltip"
          data-placement={tooltip.placement}
          style={{ left: tooltip.left, top: tooltip.top }}
        >
          {text}
        </span>,
        document.body,
      )
    : null;
  return { handlers, node };
}

export function HelpIcon({ text }: { text: string }) {
  const tip = useTip(text);
  return (
    <>
      <span className="help-icon" role="img" tabIndex={0} aria-label={text} {...tip.handlers}>
        !
      </span>
      {tip.node}
    </>
  );
}

/** 只有图标的按钮：功能名和说明都在悬浮提示里。 */
export function IconButton({
  icon,
  label,
  hint,
  onClick,
  disabled = false,
}: {
  icon: AppIconName;
  label: string;
  hint?: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  const tip = useTip(hint ? `${label}\n${hint}` : label);
  return (
    <>
      <button
        type="button"
        className="icon-button"
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
        {...tip.handlers}
      >
        <AppIcon name={icon} size={16} />
      </button>
      {tip.node}
    </>
  );
}

export const FAILURE_LABELS: Record<UiLanguage, Record<string, string>> = {
  zh: {
    'no-id': '缺少用户 ID',
    no_user: '账号已不存在',
    auth_required: '登录已失效',
    challenge: '需要人机验证',
    rate_limited: '请求过于频繁',
    http_error: '请求异常',
    network_error: '网络失败',
    missing_csrf: '登录态缺失',
    no_csrf: '登录态缺失',
    parse: '响应异常',
  },
  en: {
    'no-id': 'Missing user ID',
    no_user: 'Account no longer exists',
    auth_required: 'Sign-in expired',
    challenge: 'Verification required',
    rate_limited: 'Rate limited',
    http_error: 'Request error',
    network_error: 'Network error',
    missing_csrf: 'Missing session',
    no_csrf: 'Missing session',
    parse: 'Unexpected response',
  },
};

export const STRENGTH_LABELS: Record<UiLanguage, Record<MarkStrength, string>> = {
  zh: { refresh: '清爽', standard: '标准', deep_clean: '彻底' },
  en: { refresh: 'Light', standard: 'Standard', deep_clean: 'Deep' },
};

export const STRENGTH_HINTS: Record<UiLanguage, Record<MarkStrength, string>> = {
  zh: {
    refresh: '社区黑名单始终生效；尽量减少间接证据提示',
    standard: '社区黑名单与已启用词库正常生效',
    deep_clean: '社区黑名单之外，也提示相似话术和可疑域名',
  },
  en: {
    refresh: 'The community blocklist stays on; minimize indirect-evidence prompts',
    standard: 'Use the community blocklist and enabled keyword rules',
    deep_clean: 'Also show similar wording and suspicious-domain prompts',
  },
};

export interface PageMarkedItem {
  evidence?: BlockEvidence;
  handle: string;
  category: string;
  reason: string;
  snippet?: string;
  displayName?: string;
}

/** 本页热帖（content script `feedsieve:page-hot-posts` 的回复）。 */
export interface HotPostItem {
  postId: string;
  handle: string;
  displayName?: string;
  avatarUrl?: string;
  verified?: boolean;
  /** 第一张图片或视频封面 */
  mediaUrl?: string;
  /** 帖子语言（X 给的代码，如 zh / en / ja） */
  lang?: string;
  /** 已经在 X 上看过或从热帖里点开过 */
  read?: boolean;
  snippet?: string;
  createdAt?: number;
  /** 第一次出现在屏幕上的时刻（只有「我刷到的」有） */
  seenAt?: number;
  views?: number;
  likes?: number;
  retweets?: number;
  quotes?: number;
  bookmarks?: number;
  followers?: number;
  replies?: number;
  /** 预计 24 小时浏览 */
  projected?: number;
  velocity: number | null;
  breakout: number | null;
  tier: number | null;
  viral: number | null;
  opportunity: { hoursLeft: number; remainingViews: number; competition: number } | null;
  /** 全站热榜：榜内名次（从 1 开始） */
  rank?: number;
  /** 全站热榜：比约半小时前上升的名次（负数是下降）；null = 新上榜 */
  rankDelta?: number | null;
  /** 全站热榜：第一次进榜的时刻 */
  listedAt?: number;
}

function asOpportunity(value: unknown): HotPostItem['opportunity'] {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const hoursLeft = optionalCount(raw.hoursLeft);
  const remainingViews = optionalCount(raw.remainingViews);
  const competition = optionalCount(raw.competition);
  return hoursLeft !== undefined && remainingViews !== undefined && competition !== undefined
    ? { hoursLeft, remainingViews, competition }
    : null;
}

/** 弹窗只加载 X 图床上的图片（内容脚本已经过滤过一次，这里再守一道）。 */
const TWIMG_URL = /^https:\/\/pbs\.twimg\.com\/[\w./-]{1,300}$/;

function optionalImageUrl(value: unknown): string | undefined {
  return typeof value === 'string' && TWIMG_URL.test(value) ? value : undefined;
}

function optionalCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function asHotPostList(value: unknown): HotPostItem[] {
  if (!Array.isArray(value)) return [];
  const items: HotPostItem[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const raw = entry as Record<string, unknown>;
    const handle = normalizeStrictHandle(raw.handle);
    const postId =
      typeof raw.postId === 'string' && /^\d{1,20}$/.test(raw.postId) ? raw.postId : null;
    if (!handle || !postId) continue;
    const tier = nullableNumber(raw.tier);
    const createdAt = optionalCount(raw.createdAt);
    const views = optionalCount(raw.views);
    const followers = optionalCount(raw.followers);
    const replies = optionalCount(raw.replies);
    const viral = nullableNumber(raw.viral);
    const extra = {
      likes: optionalCount(raw.likes),
      retweets: optionalCount(raw.retweets),
      quotes: optionalCount(raw.quotes),
      bookmarks: optionalCount(raw.bookmarks),
      projected: optionalCount(raw.projected),
      seenAt: optionalCount(raw.seenAt),
      avatarUrl: optionalImageUrl(raw.avatarUrl),
      mediaUrl: optionalImageUrl(raw.mediaUrl),
      verified: typeof raw.verified === 'boolean' ? raw.verified : undefined,
      lang:
        typeof raw.lang === 'string' && /^[a-z]{2,3}(-[a-z]{2,4})?$/.test(raw.lang)
          ? raw.lang
          : undefined,
      read: raw.read === true ? true : undefined,
    };
    items.push({
      postId,
      handle,
      ...(typeof raw.displayName === 'string' && raw.displayName.trim()
        ? { displayName: raw.displayName.trim() }
        : {}),
      ...(typeof raw.snippet === 'string' && raw.snippet.trim()
        ? { snippet: raw.snippet.trim() }
        : {}),
      ...(createdAt !== undefined ? { createdAt } : {}),
      ...(views !== undefined ? { views } : {}),
      ...(followers !== undefined ? { followers } : {}),
      ...(replies !== undefined ? { replies } : {}),
      ...Object.fromEntries(Object.entries(extra).filter(([, value]) => value !== undefined)),
      velocity: nullableNumber(raw.velocity),
      breakout: nullableNumber(raw.breakout),
      tier: tier !== null && Number.isInteger(tier) && tier >= 1 && tier <= TIER_MAX ? tier : null,
      viral: viral !== null && viral >= 0 && viral <= 100 ? Math.round(viral) : null,
      opportunity: asOpportunity(raw.opportunity),
      ...(typeof raw.rank === 'number' && Number.isInteger(raw.rank) && raw.rank >= 1
        ? { rank: raw.rank }
        : {}),
      ...(raw.rankDelta === null
        ? { rankDelta: null }
        : typeof raw.rankDelta === 'number' && Number.isInteger(raw.rankDelta)
          ? { rankDelta: raw.rankDelta }
          : {}),
      ...(optionalCount(raw.listedAt) !== undefined
        ? { listedAt: optionalCount(raw.listedAt) }
        : {}),
    });
  }
  return items;
}

/**
 * 全站热榜（`GET /v1/hot`）→ 弹窗用的条目：量级和回复机会在本地算（与「我刷到的」同一套公式），
 * 再走 asHotPostList 的形态校验。
 */
export interface GlobalHotList {
  generatedAt: number;
  /** 「飙升」榜 */
  items: HotPostItem[];
  /** 「24 小时」榜（旧版服务端没有，为空） */
  day: HotPostItem[];
}

export function asGlobalHotList(value: unknown, now: number): GlobalHotList | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as { generated_at?: unknown; posts?: unknown; day?: unknown };
  if (typeof raw.generated_at !== 'number' || !Array.isArray(raw.posts)) return null;
  return {
    generatedAt: raw.generated_at,
    items: enrichGlobal(raw.posts, now),
    day: Array.isArray(raw.day) ? enrichGlobal(raw.day, now) : [],
  };
}

function enrichGlobal(posts: unknown[], now: number): HotPostItem[] {
  const enriched = posts.map((post) => {
    if (!post || typeof post !== 'object') return post;
    const p = post as Record<string, unknown>;
    const velocity = typeof p.velocity === 'number' ? p.velocity : null;
    const createdAt = typeof p.createdAt === 'number' ? p.createdAt : undefined;
    return {
      ...p,
      tier: accountTier(typeof p.followers === 'number' ? p.followers : undefined),
      viral: null,
      opportunity: replyOpportunity({
        velocityPerHour: velocity,
        ageHours: ageHours(createdAt, now),
        ...(typeof p.replies === 'number' ? { replies: p.replies } : {}),
      }),
    };
  });
  return asHotPostList(enriched);
}

/** 本页简报（content script `feedsieve:page-brief` 的回复）。 */
export interface PageBriefItem {
  seen: number;
  authors: number;
  hot: number;
  /** 当前热帖门槛（浏览/小时） */
  threshold: number | null;
  medianVelocity: number | null;
  topBreakout: { ratio: number; handle: string; postId: string } | null;
  tiers: number[];
}

export function asPageBrief(value: unknown): PageBriefItem | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const seen = optionalCount(raw.seen);
  const authors = optionalCount(raw.authors);
  const hot = optionalCount(raw.hot);
  if (seen === undefined || authors === undefined || hot === undefined) return null;
  const tiersRaw = (raw.tiers ?? {}) as Record<string, unknown>;
  const tiers = TIER_LEVELS.map(
    (tier) => optionalCount(tiersRaw[tier]) ?? 0,
  ) as PageBriefItem['tiers'];
  const top = raw.topBreakout as Record<string, unknown> | null | undefined;
  const topHandle = top ? normalizeStrictHandle(top.handle) : null;
  const topRatio = top ? optionalCount(top.ratio) : undefined;
  const topPostId =
    top && typeof top.postId === 'string' && /^\d{1,20}$/.test(top.postId) ? top.postId : null;
  return {
    seen,
    authors,
    hot,
    threshold: nullableNumber(raw.threshold),
    medianVelocity: nullableNumber(raw.medianVelocity),
    topBreakout:
      topHandle && topRatio !== undefined && topPostId
        ? { ratio: topRatio, handle: topHandle, postId: topPostId }
        : null,
    tiers,
  };
}

export interface CommunityMeta {
  version: string;
  count: number;
  syncedAt: number;
}

export function asPageMarkedList(value: unknown): PageMarkedItem[] {
  if (!Array.isArray(value)) return [];
  // 内部通道但仍过最小形态校验：畸形条目静默丢弃，避免渲染成 @undefined（review F6）
  const items: PageMarkedItem[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const raw = entry as Record<string, unknown>;
    const handle = normalizeStrictHandle(raw.handle);
    if (!handle || typeof raw.category !== 'string' || typeof raw.reason !== 'string') continue;
    const snippet =
      typeof raw.snippet === 'string' && raw.snippet.trim().length > 0
        ? raw.snippet.trim()
        : undefined;
    const displayName =
      typeof raw.displayName === 'string' && raw.displayName.trim().length > 0
        ? raw.displayName.trim()
        : undefined;
    items.push({
      handle,
      ...(raw.evidence && typeof raw.evidence === 'object'
        ? { evidence: raw.evidence as BlockEvidence }
        : {}),
      category: raw.category,
      reason: raw.reason,
      snippet,
      displayName,
    });
  }
  return items;
}

export function formatDate(timestamp: number, language: UiLanguage): string {
  return new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en', {
    month: 'short',
    day: 'numeric',
  }).format(new Date(timestamp));
}

export function formatAgo(timestamp: number, language: UiLanguage): string {
  // 语义与文案收敛到 @feedsieve/shared（Unix 秒）；此处的毫秒时间戳签名保留，调用方零改动。
  // 边界等价性见 packages/shared/src/shared.test.ts 的「毫秒时间戳语义等价」用例。
  return sharedFormatAgo(Math.floor(timestamp / 1000), language);
}

export function allowlistReason(item: AllowlistItem, language: UiLanguage): string | undefined {
  if (!item.detectionReason) return undefined;
  if (!item.ruleId) return item.detectionReason;
  return localizedDetectionReason(language, {
    source: item.detectionSource ?? '',
    ruleId: item.ruleId,
    reason: item.detectionReason,
  });
}

export function normalizeManualInput(value: string): string | null {
  const trimmed = value.trim();
  let candidate = trimmed;
  try {
    const url = new URL(trimmed);
    if (['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(url.hostname)) {
      candidate = url.pathname.split('/').filter(Boolean)[0] ?? '';
    }
  } catch {
    // not a URL; treat it as @handle
  }
  const handle = candidate.replace(/^@+/, '').toLowerCase();
  return /^[a-z0-9_]{1,15}$/.test(handle) ? handle : null;
}

export { getChromeSidePanel, type ChromeSidePanelApi } from '../../../src/lib/platform/sidepanel';

/**
 * 官网公示页图标入口：按 tab 对应官网同名公示页引流（黑名单/白名单/词库）。
 * 图标即控件，靠 aria-label 表达去处。
 */
export function OfficialLinkIcon({ target, label }: { target: SiteList; label: string }) {
  return (
    <button
      type="button"
      className="official-link-icon"
      aria-label={label}
      title={label}
      onClick={() => void openOfficialPage(SITE_URLS[target])}
    >
      <AppIcon name="external" size={13} />
    </button>
  );
}

/** 开关（设置页和「发帖」页共用） */
export function Toggle({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="switch">
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span aria-hidden="true" />
    </label>
  );
}
