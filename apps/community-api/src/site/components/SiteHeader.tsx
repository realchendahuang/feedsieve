import { Link, useLocation } from '@tanstack/react-router';
import { Moon, Monitor, Sun, Info, BookOpen, ArrowRight, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTheme } from './ThemeProvider';
import { WEEKLY_BAR_STORAGE_KEY, cycleTheme, type ThemeMode } from '../lib/theme';
import { cn } from '../lib/utils';
import { SITE_NAME, GITHUB_URL } from '../site';

/**
 * 全站单层顶栏导航：首页 + AI 号广场 + 黑名单 + 白名单 + 抢救 + 词库 + 教程。
 * 杜绝双层 Tab 嵌套重合，所有名单与功能在一级顶栏平铺直达。
 */
const NAV = [
  { label: '首页', to: '/', match: (p: string) => p === '/' },
  { label: 'AI 号广场', to: '/ai', match: (p: string) => p === '/ai' || p.startsWith('/ai/') },
  { label: '黑名单', to: '/lists/blacklist', match: (p: string) => p === '/lists/blacklist' },
  { label: '白名单', to: '/lists/whitelist', match: (p: string) => p === '/lists/whitelist' },
  { label: '社区抢救', to: '/lists/rescue', match: (p: string) => p === '/lists/rescue' },
  { label: '开源词库', to: '/lists/keywords', match: (p: string) => p === '/lists/keywords' },
  { label: '使用教程', to: '/guide', match: (p: string) => p.startsWith('/guide') },
] as const;

const NAV_BASE_CLS =
  'shrink-0 rounded-full px-3 py-1.5 text-xs sm:text-sm font-semibold text-mist transition-colors hover:text-ink whitespace-nowrap';

const THEME_META: Record<ThemeMode, { label: string; next: string }> = {
  system: { label: '跟随系统', next: '浅色模式' },
  light: { label: '浅色模式', next: '深色模式' },
  dark: { label: '深色模式', next: '跟随系统' },
};

function GithubIcon({ className = 'size-4' }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
      />
    </svg>
  );
}

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

/**
 * 顶部推广条：推荐同域的另一个产品「小筛子周刊」（福滤娃出品）（feedsieve.win/weekly，独立 Worker）。
 * 周刊那边顶部推荐安装插件，两边互相引流。可关闭，记在 localStorage。
 */
function WeeklyBar() {
  function dismiss() {
    try {
      localStorage.setItem(WEEKLY_BAR_STORAGE_KEY, 'off');
    } catch {
      /* 隐私模式写不进就只关本次 */
    }
    document.documentElement.classList.add('weekly-bar-off');
  }
  return (
    <div className="weekly-bar border-b border-gold/20 bg-gold-surface text-gold-deep">
      <div className="mx-auto flex h-9 max-w-5xl items-center gap-2 px-[clamp(18px,2.2vw,34px)] text-xs">
        <BookOpen className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">
          <b className="font-bold">小筛子周刊</b>
          <span className="hidden sm:inline">：福滤娃出品。X、公众号、GitHub、博客上的好内容，筛过一遍，每周五成刊。</span>
          <span className="sm:hidden">：各平台好内容，每周五精选</span>
        </span>
        <a
          href="/weekly/"
          className="inline-flex shrink-0 items-center gap-1 rounded-full bg-gold px-2.5 py-0.5 font-bold text-white transition hover:opacity-90 dark:text-black"
        >
          去看看
          <ArrowRight className="size-3" aria-hidden="true" />
        </a>
        <button
          type="button"
          onClick={dismiss}
          aria-label="关闭推广"
          className="-mr-1 inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-gold/10"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

export function SiteHeader({ withApply = false }: { withApply?: boolean }) {
  const { mode, setMode } = useTheme();
  const pathname = useLocation().pathname;

  return (
    <>
    <WeeklyBar />
    <header className="sticky top-0 z-40 border-b border-line/60 bg-paper/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-2 px-[clamp(18px,2.2vw,34px)] sm:gap-4">
        {/* 左侧：品牌 */}
        <Link to="/" aria-label={SITE_NAME} className="flex shrink-0 items-center gap-2">
          <img src="/assets/avatar.png" alt="" width={30} height={30} className="size-[30px] rounded-full" />
          <span className="text-sm font-bold tracking-tight">{SITE_NAME}</span>
        </Link>

        {/* 中间：导航（移动端横滑，桌面居中） */}
        <nav className="flex items-center gap-1 overflow-x-auto py-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
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
          {/* 周刊是独立 Worker（feedsieve.win/weekly），用普通 a 走整页导航 */}
          <a href="/weekly/" className={cn(NAV_BASE_CLS, 'inline-flex items-center gap-1 text-gold hover:text-gold-deep')}>
            <BookOpen className="size-3.5" aria-hidden="true" />
            周刊
          </a>
        </nav>

        {/* 右侧：申请入口（若需）+ GitHub 快捷入口 + 主题切换 */}
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          {withApply && (
            <Link
              to="/lists/apply"
              className="hidden sm:inline-flex h-8 items-center rounded-full bg-gold-surface px-3.5 text-xs font-semibold text-gold transition-colors hover:text-gold-deep"
            >
              申请入册
            </Link>
          )}

          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex size-8 sm:size-9 shrink-0 cursor-pointer select-none items-center justify-center rounded-full bg-surface text-mist shadow-[var(--panel-elev)] transition-colors duration-150 hover:bg-wash-strong hover:text-ink active:scale-95"
            aria-label="GitHub 源码仓库"
            title="GitHub 开源仓库"
          >
            <GithubIcon className="size-4 text-ink" />
          </a>

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
    </>
  );
}
