import type { ReactNode } from 'react';
import { Link, useLocation } from '@tanstack/react-router';
import { cn } from './../../lib/utils';
import { HelpIcon } from './../../components/SiteHeader';
import { xProfileUrl } from '../../site';

/** 公示家族子导航（真路由替代旧 hash tabs）：当前路由高亮。 */
const TABS = [
  { key: 'blacklist', label: '黑名单', to: '/lists/blacklist' },
  { key: 'whitelist', label: '白名单', to: '/lists/whitelist' },
  { key: 'rescue', label: '抢救', to: '/lists/rescue' },
  { key: 'keywords', label: '词库', to: '/lists/keywords' },
  { key: 'ranked', label: '排位赛', to: '/lists/ranked' },
] as const;

export function ListsTabs() {
  const pathname = useLocation().pathname;
  return (
    <nav className="flex flex-wrap items-center gap-1" aria-label="公示分区">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          to={tab.to}
          aria-current={pathname === tab.to ? 'page' : undefined}
          className={cn(
            'rounded-full px-3.5 py-1.5 text-sm font-semibold text-mist transition-colors hover:text-ink',
            pathname === tab.to && 'bg-surface text-ink shadow-sm',
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

/** 公示页家族共用页头（标题行 + 计数徽章位） */
export function ListPageHeader({
  title,
  meta,
  aside,
}: {
  title: string;
  meta?: string;
  aside?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {meta && <p className="mt-1 text-sm text-mist">{meta}</p>}
      </div>
      {aside}
    </div>
  );
}

export function HandleLink({ handle, className }: { handle: string; className?: string }) {
  return (
    <a
      href={xProfileUrl(handle)}
      target="_blank"
      rel="noopener noreferrer"
      className={cn('font-medium text-ink transition-colors hover:text-gold', className)}
    >
      @{handle}
    </a>
  );
}

export function fmtDate(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : '—';
}

export { HelpIcon, xProfileUrl, cn };
