import React from 'react';
import { Link, Outlet } from '@tanstack/react-router';
import {
  ClipboardList,
  History,
  Inbox,
  LayoutDashboard,
  MessageSquareWarning,
  CircleAlert,
  Settings,
  ShieldCheck,
  UserRoundX,
  UserSearch,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { errorText } from '../lib/errors';

const navigation = [
  { to: '/', label: '概览', icon: LayoutDashboard },
  { to: '/accounts', label: '账号', icon: UserRoundX },
  { to: '/community', label: '候选', icon: UserSearch },
  { to: '/verified', label: '验证正常', icon: ShieldCheck },
  { to: '/applications', label: '公示申请', icon: ClipboardList },
  { to: '/keywords', label: '词库', icon: MessageSquareWarning },
  { to: '/feedback', label: '反馈', icon: Inbox },
  { to: '/releases', label: '发布', icon: History },
  { to: '/settings', label: '设置', icon: Settings },
] as const;

const navItemClass =
  'group flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap text-muted-foreground transition-all duration-150 hover:bg-amber-500/10 hover:text-amber-950 dark:hover:text-amber-100 data-[status=active]:bg-amber-500/15 data-[status=active]:font-semibold data-[status=active]:text-amber-900 dark:data-[status=active]:text-amber-300 data-[status=active]:shadow-xs';

export function Layout() {
  return (
    <div className="relative flex min-h-svh flex-col bg-background md:flex-row">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_70%_50%_at_50%_-10%,rgba(245,158,11,0.06),transparent)]" />
      <aside className="relative flex shrink-0 flex-row items-center gap-4 border-b bg-sidebar/90 px-4 py-3 backdrop-blur-md md:w-56 md:flex-col md:items-stretch md:gap-7 md:border-r md:border-b-0 md:px-3.5 md:py-6">
        <div className="flex items-center gap-3 px-1 py-1">
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 via-amber-500 to-amber-600 text-white shadow-md shadow-amber-500/25 ring-1 ring-amber-400/40">
            <svg
              aria-hidden="true"
              className="size-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 3.25 5 6.1v5.15c0 4.3 2.82 7.7 7 9.5 4.18-1.8 7-5.2 7-9.5V6.1L12 3.25Z" />
              <path d="m8.6 12 2.15 2.15 4.75-5" />
            </svg>
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5">
              <span className="text-base font-extrabold tracking-tight text-foreground">FeedSieve</span>
              <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9.5px] font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider">
                Admin
              </span>
            </div>
          </div>
        </div>
        <nav aria-label="管理导航" className="flex gap-1 overflow-x-auto md:flex-col">
          {navigation.map(({ to, label, icon: Icon }) => (
            <Link key={to} to={to} className={navItemClass}>
              <Icon className="size-4 transition-colors group-data-[status=active]:text-amber-600 dark:group-data-[status=active]:text-amber-400 group-hover:text-amber-700" />
              {label}
            </Link>
          ))}
        </nav>
      </aside>
      <main className="relative min-w-0 flex-1 px-5 py-7 md:px-8 lg:px-12">
        <div className="mx-auto w-full max-w-6xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

export function PageHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-border/60">
      <h1 className="text-2xl font-extrabold tracking-tight text-foreground">{title}</h1>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </header>
  );
}

/** 辅助说明收进 `!` 图标，悬浮才显示。 */
export function Hint({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger className="text-muted-foreground/60 transition-colors hover:text-amber-600" aria-label={text}>
        <CircleAlert className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent className="bg-zinc-900 text-zinc-100 border-zinc-800 shadow-lg text-xs py-1.5 px-2.5 max-w-xs">{text}</TooltipContent>
    </Tooltip>
  );
}

export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="mt-6 space-y-3">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-12 w-full rounded-xl" />
      ))}
    </div>
  );
}

export function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  // Access 会话过期（401）后重试 API 永远失败，需要整页重载走边缘登录。
  const message = errorText(error);
  const needsRelogin = message === 'access_required' || message === 'http_401';
  return (
    <div className="mt-6 flex flex-col items-start gap-3 rounded-xl border border-dashed border-destructive/40 bg-destructive/5 p-6 text-sm text-foreground">
      <span className="font-medium text-destructive">{message}</span>
      {needsRelogin ? (
        <Button variant="outline" size="sm" onClick={() => window.location.reload()} className="border-destructive/30 hover:bg-destructive/10">
          重新登录
        </Button>
      ) : (
        <Button variant="outline" size="sm" onClick={onRetry} className="border-destructive/30 hover:bg-destructive/10">
          重试
        </Button>
      )}
    </div>
  );
}
