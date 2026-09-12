import { useState } from 'react';
import type { RosterWhitelistEntry } from '../../../roster';
import { cn, fmtDate, xProfileUrl } from './lists-common';

/**
 * 推荐白名单公示面板：人均一张入册卡片（头像/昵称/简介/入册日期），
 * 社区抢救拆到 /lists/rescue。
 */
export function WhitelistPanel({ maintained }: { maintained: RosterWhitelistEntry[] }) {
  if (maintained.length === 0) {
    return <p className="panel-card px-4 py-10 text-center text-mist">暂无推荐白名单账号</p>;
  }
  return (
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {maintained.map((entry) => (
        <WhitelistCard key={entry.handle} entry={entry} />
      ))}
    </section>
  );
}

function WhitelistCard({ entry }: { entry: RosterWhitelistEntry }) {
  return (
    <article className="panel-card flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Avatar entry={entry} />
        <div className="min-w-0">
          {entry.name && <div className="truncate text-sm font-bold">{entry.name}</div>}
          <HandleAt handle={entry.handle} className={cn(!entry.name && 'mt-0.5')} />
        </div>
      </div>
      <p className="text-sm leading-relaxed" style={{ wordBreak: 'break-word' }}>
        {entry.note}
      </p>
      <div className="mt-auto pt-1 text-xs text-mist tabular-nums">入册 {fmtDate(entry.added_at)}</div>
    </article>
  );
}

function Avatar({ entry }: { entry: RosterWhitelistEntry }) {
  const [broken, setBroken] = useState(false);
  const fallback = entry.name?.trim().charAt(0) || entry.handle.charAt(0).toUpperCase();
  return (
    <a
      href={xProfileUrl(entry.handle)}
      target="_blank"
      rel="noopener noreferrer"
      className="relative inline-flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-soft-surface text-base font-bold text-mist"
      aria-hidden="true"
    >
      {fallback}
      {entry.avatar_url && !broken && (
        <img
          src={entry.avatar_url}
          alt=""
          loading="lazy"
          onError={() => setBroken(true)}
          className="absolute inset-0 h-full w-full rounded-full object-cover"
        />
      )}
    </a>
  );
}

function HandleAt({ handle, className }: { handle: string; className?: string }) {
  return (
    <a
      href={xProfileUrl(handle)}
      target="_blank"
      rel="noopener noreferrer"
      className={cn('text-xs font-semibold text-gold transition-colors hover:text-ink', className)}
    >
      @{handle}
    </a>
  );
}
