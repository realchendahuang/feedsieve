import type { BlockEvidence } from '../../../src/lib/detection/detection-evidence';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  STRENGTH_LABELS as canonicalStrengthLabels,
  type MarkStrength,
} from '@feedsieve/community-lists';
import type { AllowlistItem } from '../../../src/lib/community/allowlist';
import { normalizeStrictHandle } from '../../../src/lib/platform/xhr-bridge-guard';
import { openOfficialPage, SITE_URLS, type SiteList } from '../../../src/lib/platform/site-links';
import { localizedDetectionReason, UI_COPY, type UiLanguage } from '../../../src/lib/platform/i18n';
import { formatAgo as sharedFormatAgo } from '@feedsieve/shared';
import { accountTier, ageHours, replyOpportunity, TIER_LEVELS, TIER_MAX } from '@feedsieve/metrics';

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
    // lucide: settings（齿轮，ISC License）
    settings: (
      <>
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
        <circle cx="12" cy="12" r="3" />
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

/** 提示框和锚点、提示框和弹窗边缘之间的空隙。 */
const TIP_GAP = 8;
const TIP_EDGE = 8;

interface TipAnchor {
  top: number;
  bottom: number;
  left: number;
  width: number;
}

/** 量出来的提示框尺寸；首帧还没量时是 null。 */
interface TipBox {
  width: number;
  height: number;
}

/** 只取定位要用的四个数：DOMRect 在滚动后会变成快照，留着元素每次重算更可靠。 */
function anchorRect(el: HTMLElement): TipAnchor {
  const rect = el.getBoundingClientRect();
  return { top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width };
}

export interface TipPlacement {
  left: number;
  top: number;
  placement: 'top' | 'bottom';
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

/**
 * 提示框落点：默认放在锚点下方——上方是导航和页面标题，盖住就什么都看不见了；
 * 下方放不下（贴近弹窗底部）才翻上去。左右和上下都夹在弹窗里，不越界。
 *
 * 尺寸必须量过再算：文案行数不固定，用固定阈值猜的话，稍长一点就顶出弹窗被裁掉。
 */
export function placeTip(anchor: TipAnchor, box: TipBox | null): TipPlacement {
  const width = box?.width ?? 0;
  const height = box?.height ?? 0;
  const roomBelow = window.innerHeight - anchor.bottom - TIP_GAP - TIP_EDGE;
  const roomAbove = anchor.top - TIP_GAP - TIP_EDGE;
  const placement: 'top' | 'bottom' = height <= roomBelow || height > roomAbove ? 'bottom' : 'top';
  const top =
    placement === 'bottom'
      ? clamp(anchor.bottom + TIP_GAP, TIP_EDGE, Math.max(TIP_EDGE, window.innerHeight - height - TIP_EDGE))
      : clamp(anchor.top - TIP_GAP - height, TIP_EDGE, Math.max(TIP_EDGE, window.innerHeight - height - TIP_EDGE));
  const left = clamp(
    anchor.left + anchor.width / 2 - width / 2,
    TIP_EDGE,
    Math.max(TIP_EDGE, window.innerWidth - width - TIP_EDGE),
  );
  return { left, top, placement };
}

/**
 * 悬浮提示（`!` 图标、倍数标签、图标按钮共用）：鼠标移上去或键盘聚焦时显示，
 * 挂到 body 上，弹窗边缘也不会被裁掉。
 */
export function useTip(text: string) {
  const [tip, setTip] = useState<{ anchor: TipAnchor; box: TipBox | null } | null>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  const nodeRef = useRef<HTMLSpanElement | null>(null);
  const tooltipId = useId();

  const show = (target: HTMLElement) => {
    anchorRef.current = target;
    setTip({ anchor: anchorRect(target), box: null });
  };
  const hide = () => {
    anchorRef.current = null;
    setTip(null);
  };

  // 先挂上去量出真实尺寸再定位：useLayoutEffect 在绘制前跑，看不到中间态
  useLayoutEffect(() => {
    if (!tip || tip.box) return;
    const el = nodeRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const box = { width: rect.width, height: rect.height };
    setTip((prev) => (prev && !prev.box ? { anchor: prev.anchor, box } : prev));
  }, [tip]);

  // 锚点一挪（滚列表、改窗口大小、键盘焦点把元素滚进视野）固定定位的框就会挂在半空，
  // 所以跟着重算；锚点整体滚出视野才收起来。
  const open = tip !== null;
  useEffect(() => {
    if (!open) return;
    const follow = (remeasure: boolean) => () => {
      const el = anchorRef.current;
      if (!el || !el.isConnected) {
        setTip(null);
        return;
      }
      const rect = anchorRect(el);
      if (rect.bottom < 0 || rect.top > window.innerHeight) {
        setTip(null);
        return;
      }
      setTip((prev) => (prev ? { anchor: rect, box: remeasure ? null : prev.box } : prev));
    };
    const onScroll = follow(false);
    const onResize = follow(true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  const handlers = {
    'aria-describedby': tip ? tooltipId : undefined,
    onMouseEnter: (event: { currentTarget: HTMLElement }) => show(event.currentTarget),
    onMouseLeave: hide,
    onFocus: (event: { currentTarget: HTMLElement }) => show(event.currentTarget),
    onBlur: hide,
    onKeyDown: (event: { key: string }) => {
      if (event.key === 'Escape') hide();
    },
  };
  const position = tip ? placeTip(tip.anchor, tip.box) : null;
  const node =
    tip && position
      ? createPortal(
          <span
            ref={nodeRef}
            id={tooltipId}
            role="tooltip"
            className="help-tooltip"
            data-placement={position.placement}
            style={{
              left: position.left,
              top: position.top,
              visibility: tip.box ? undefined : 'hidden',
            }}
          >
            {text}
          </span>,
          document.body,
        )
      : null;
  return { handlers, node };
}

/**
 * 会被 CSS 截断的一行字：鼠标悬浮和键盘聚焦都能看到全文。
 * 只挂 title 的话键盘用户永远读不到——focus 不触发原生 title。
 */
export function TipText({
  text,
  children,
  className,
}: {
  text: string;
  children: ReactNode;
  className?: string;
}) {
  const tip = useTip(text);
  return (
    <>
      <span className={className} tabIndex={0} {...tip.handlers}>
        {children}
      </span>
      {tip.node}
    </>
  );
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

/**
 * 二级页顶部：‹ 父级名 + 页面标题。
 * 调校、模块设置、静音三处二级页共用；返回按钮的 aria-label 固定为「返回 · 父级名」。
 */
export function SubpageHeader({
  language,
  title,
  backLabel,
  onBack,
}: {
  language: UiLanguage;
  title: ReactNode;
  backLabel: string;
  onBack: () => void;
}) {
  return (
    <header className="subpage-head">
      <button
        type="button"
        className="back-button"
        aria-label={`${UI_COPY[language].goBack} · ${backLabel}`}
        onClick={onBack}
      >
        <AppIcon name="chevron" size={14} className="is-back" />
        {backLabel}
      </button>
      <h2>{title}</h2>
    </header>
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

/* 档位名只有一份：community-lists 的 STRENGTH_LABELS，官网页、CHANGELOG、测试都用它。
   弹窗早先自己写过「彻底」，和全站的「大扫除」对不上，现在直接引用。 */
export const STRENGTH_LABELS: Record<UiLanguage, Record<MarkStrength, string>> = {
  zh: canonicalStrengthLabels,
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

/** 设置页统一的一行：左标签（可带 ! 说明）+ 右控件。 */
export function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="row">
      <div className="row-label">
        <span>{label}</span>
        {hint ? <HelpIcon text={hint} /> : null}
      </div>
      <div className="row-control">{children}</div>
    </div>
  );
}

/**
 * 空态：可选图标 + 文案 + 「!」悬浮说明。
 * 根节点 class 固定为 empty-state，is-clean / write-empty 等变体由 className 叠加；
 * 文案之外还要放说明行或按钮时用 extra。
 */
export function EmptyState({
  icon,
  hint,
  className,
  extra,
  children,
}: {
  icon?: AppIconName;
  hint?: string;
  className?: string;
  extra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={className ? `empty-state ${className}` : 'empty-state'}>
      {icon ? <AppIcon name={icon} size={18} /> : null}
      <p>{children}</p>
      {extra ?? null}
      {hint ? <HelpIcon text={hint} /> : null}
    </div>
  );
}

/** 骨架占位：固定 3 行，加载完成时屏高不跳。 */
export function SkeletonList() {
  return (
    <div className="loading-list" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  );
}

/** 「再点一次确认」的时间窗：3 秒内再点才真正执行。 */
export const CONFIRM_TIMEOUT_MS = 3_000;

/**
 * 「再点一次确认」：第一次 arm 进入确认态，超时自动复位；
 * 确认态下再次 arm 返回 true，调用方这时才执行危险操作。
 * 按行区分（如静音词逐条删除）时用 key 区分。
 */
export function useArmedConfirm<K = string>(timeoutMs = CONFIRM_TIMEOUT_MS) {
  const [armedKey, setArmedKey] = useState<K | null>(null);
  useEffect(() => {
    if (armedKey === null) return;
    const timer = window.setTimeout(() => setArmedKey(null), timeoutMs);
    return () => window.clearTimeout(timer);
  }, [armedKey, timeoutMs]);
  const isArmed = useCallback((key: K) => armedKey === key, [armedKey]);
  const arm = useCallback(
    (key: K): boolean => {
      if (armedKey === key) return true;
      setArmedKey(key);
      return false;
    },
    [armedKey],
  );
  const reset = useCallback(() => setArmedKey(null), []);
  return { armedKey, isArmed, arm, reset };
}
