import { Link, useLocation } from '@tanstack/react-router';
import { Moon, Monitor, Sun, Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTheme } from './/ThemeProvider';
import { cycleTheme, type ThemeMode } from './../lib/theme';
import { cn } from './../lib/utils';
import { SITE_NAME } from '../site';

/**
 * 全站导航：一级入口 = 名单公示家族（黑名单/白名单/词库/排位赛）+ 教程。
 * 页面状态下一律不再解释文案；免责声明收进 ! 图标悬浮。
 */
const NAV = [
  { label: '首页', to: '/', match: (p: string) => p === '/' },
  {
    label: '名单公示',
    to: '/lists/blacklist',
    match: (p: string) => p.startsWith('/lists'),
  },
  { label: '使用教程', to: '/guide', match: (p: string) => p.startsWith('/guide') },
] as const;

const NAV_BASE_CLS =
  'shrink-0 rounded-full px-3 py-1.5 text-sm font-semibold text-mist transition-colors hover:text-ink';

const THEME_META: Record<ThemeMode, { label: string; next: string }> = {
  system: { label: '跟随系统', next: '浅色模式' },
  light: { label: '浅色模式', next: '深色模式' },
  dark: { label: '深色模式', next: '跟随系统' },
};

/** 标题/控件旁的 ! 辅助说明图标：仅在悬浮时显示（文案克制约定） */
export function HelpIcon({ children, ariaLabel = '说明' }: { children: ReactNode; ariaLabel?: string }) {
  return (
    <span className="relative inline-flex items-center group">
      <Info
        className="size-3.5 text-fog hover:text-mist cursor-help"
        aria-label={ariaLabel}
        role="img"
      />
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-50 mt-2 w-72 -translate-x-1/2 rounded-xl bg-surface px-3.5 py-3 text-xs leading-relaxed text-mist shadow-[var(--panel-elev)] opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {children}
      </span>
    </span>
  );
}

export function SiteHeader({ withApply = false }: { withApply?: boolean }) {
  const { mode, setMode } = useTheme();
  const pathname = useLocation().pathname;

  return (
    <header className="sticky top-0 z-40 border-b border-line/60 bg-paper/85 backdrop-blur-md">
      <div className="mx-auto grid h-14 max-w-5xl grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-[clamp(18px,2.2vw,34px)] sm:gap-3">
        {/* 左格：品牌 */}
        <Link to="/" aria-label={SITE_NAME} className="flex items-center gap-2">
          <img src="/assets/avatar.png" alt="" width={30} height={30} className="size-[30px] rounded-full" />
          <span className="text-sm font-bold">{SITE_NAME}</span>
        </Link>

        {/* 中格：导航居中；公示家族激活包含 /lists 全部子路由 */}
        <nav className="flex items-center justify-center gap-1">
          {NAV.map((n) => {
            const active = n.match(pathname);
            return (
              <Link
                key={n.label}
                to={n.to}
                aria-current={active ? 'page' : undefined}
                className={cn(NAV_BASE_CLS, active && 'bg-surface text-ink shadow-sm')}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>

        {/* 右格：申请入口（公示页）+ 主题切换；辅助说明只进 ! 图标悬浮 */}
        <div className="flex items-center justify-end gap-1.5 sm:gap-2">
          {withApply && (
            <Link
              to="/lists/apply"
              className="hidden sm:inline-flex h-8 items-center rounded-full bg-gold-surface px-3.5 text-sm font-semibold text-gold transition-colors hover:text-gold-deep"
            >
              申请
            </Link>
          )}
          <button
            type="button"
            onClick={() => setMode(cycleTheme(mode))}
            aria-label={`主题：${THEME_META[mode].label}，点击切换为${THEME_META[mode].next}`}
            title={`主题：${THEME_META[mode].label}（点击切换为${THEME_META[mode].next}）`}
            className="inline-flex size-8 sm:size-9 shrink-0 cursor-pointer select-none items-center justify-center rounded-full bg-surface text-mist shadow-[var(--panel-elev)] transition-colors duration-150 hover:bg-wash-strong hover:text-ink active:scale-95"
          >
            <Sun className="theme-icon theme-icon-light size-3.5 sm:size-4" aria-hidden="true" />
            <Moon className="theme-icon theme-icon-dark size-3.5 sm:size-4" aria-hidden="true" />
            <Monitor className="theme-icon theme-icon-system size-3.5 sm:size-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </header>
  );
}
