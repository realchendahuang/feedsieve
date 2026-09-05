import React from 'react';
import { Link, Outlet } from '@tanstack/react-router';
import {
  History,
  Inbox,
  LayoutDashboard,
  MessageSquareWarning,
  CircleAlert,
  Settings,
  UserRoundX,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { errorText } from '../lib/errors';

const navigation = [
  { to: '/', label: '概览', icon: LayoutDashboard },
  { to: '/accounts', label: '账号', icon: UserRoundX },
  { to: '/keywords', label: '词库', icon: MessageSquareWarning },
  { to: '/feedback', label: '反馈', icon: Inbox },
  { to: '/releases', label: '发布', icon: History },
  { to: '/settings', label: '设置', icon: Settings },
] as const;

const navItemClass =
  'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground data-[status=active]:bg-accent data-[status=active]:font-semibold data-[status=active]:text-accent-foreground';

export function Layout() {
  return (
    <div className="flex min-h-svh flex-col md:flex-row">
      <aside className="flex shrink-0 flex-row items-center gap-4 border-b bg-sidebar px-4 py-3 md:w-52 md:flex-col md:items-stretch md:gap-8 md:border-r md:border-b-0 md:px-3 md:py-6">
        <div className="px-2 text-lg font-extrabold tracking-tight md:px-2.5">FeedSieve</div>
        <nav aria-label="管理导航" className="flex gap-1 overflow-x-auto md:flex-col">
          {navigation.map(({ to, label, icon: Icon }) => (
            <Link key={to} to={to} className={navItemClass}>
              <Icon className="size-4" />
              {label}
            </Link>
          ))}
        </nav>
      </aside>
      <main className="min-w-0 flex-1 px-5 py-7 md:px-8 lg:px-12">
        <div className="mx-auto w-full max-w-6xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

export function PageHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </header>
  );
}

/** 辅助说明收进 `!` 图标，悬浮才显示。 */
export function Hint({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger className="text-muted-foreground/70 hover:text-muted-foreground" aria-label={text}>
        <CircleAlert className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent>{text}</TooltipContent>
    </Tooltip>
  );
}

export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="mt-6 space-y-3">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-12 w-full" />
      ))}
    </div>
  );
}

export function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div className="mt-6 flex flex-col items-start gap-3 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
      <span>{errorText(error)}</span>
      <Button variant="outline" size="sm" onClick={onRetry}>
        重试
      </Button>
    </div>
  );
}
