import { useId, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { MarkStrength } from '@feedsieve/community-lists';
import type { AllowlistItem } from '../../../src/lib/allowlist';
import { normalizeStrictHandle } from '../../../src/lib/xhr-bridge-guard';
import { localizedDetectionReason, UI_COPY, type UiLanguage } from '../../../src/lib/i18n';

export type AppIconName = 'clean' | 'lists' | 'settings' | 'refresh' | 'shield' | 'detect';

export function AppIcon({ name, size = 20 }: { name: AppIconName; size?: number }) {
  const paths: Record<AppIconName, ReactNode> = {
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
  };

  return (
    <svg
      aria-hidden="true"
      className="app-icon"
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

export function HelpIcon({ text }: { text: string }) {
  const [tooltip, setTooltip] = useState<{
    left: number;
    top: number;
    placement: 'top' | 'bottom';
  } | null>(null);
  const tooltipId = useId();

  const showTooltip = (target: HTMLElement) => {
    const rect = target.getBoundingClientRect();
    const placement = rect.top > 84 ? 'top' : 'bottom';
    const left = Math.min(Math.max(rect.left + rect.width / 2, 120), window.innerWidth - 120);
    setTooltip({
      left,
      top: placement === 'top' ? rect.top - 8 : rect.bottom + 8,
      placement,
    });
  };

  return (
    <>
      <span
        className="help-icon"
        role="img"
        tabIndex={0}
        aria-label={text}
        aria-describedby={tooltip ? tooltipId : undefined}
        onMouseEnter={(event) => showTooltip(event.currentTarget)}
        onMouseLeave={() => setTooltip(null)}
        onFocus={(event) => showTooltip(event.currentTarget)}
        onBlur={() => setTooltip(null)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setTooltip(null);
        }}
      >
        !
      </span>
      {tooltip
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
        : null}
    </>
  );
}

export const FAILURE_LABELS: Record<UiLanguage, Record<string, string>> = {
  zh: {
    'no-id': '缺少用户 ID',
    no_user: '账号已不存在',
    auth_required: '登录已失效',
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
  handle: string;
  category: string;
  reason: string;
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
    items.push({ handle, category: raw.category, reason: raw.reason });
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
  const t = UI_COPY[language];
  const minutes = Math.floor((Date.now() - timestamp) / 60000);
  if (minutes < 1) return t.justNow;
  if (minutes < 60) return t.minutesAgo(minutes);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t.hoursAgo(hours);
  return t.daysAgo(Math.floor(hours / 24));
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
