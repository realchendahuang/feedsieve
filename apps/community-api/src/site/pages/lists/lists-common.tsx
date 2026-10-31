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

/**
 * 公示页家族共用页头标题行。
 * Tab 行单独渲染（tabs 独立参数）：左对齐锚定不动——各页右侧说明/按钮内容不同
 * （如白名单页的「申请入册」），若和 tabs 同处右侧会互相挤压造成切页时 Tab 跳动。
 */
export function ListPageHeader({
  title,
  meta,
  tabs,
  aside,
}: {
  title: string;
  meta?: string;
  /** 可选子导航（全站已统一至顶栏单层导航，此项默认留空） */
  tabs?: ReactNode;
  /** 页面专属工具（右侧，宽度可变）：HelpIcon、申请入册外链等 */
  aside?: ReactNode;
}) {
  return (
    <div className="border-b border-line/60 pb-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">{title}</h1>
          {meta && <p className="mt-1 text-sm text-mist">{meta}</p>}
        </div>
        {aside != null && <div className="flex flex-wrap items-center gap-3">{aside}</div>}
      </div>
      {tabs != null && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {tabs}
        </div>
      )}
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
