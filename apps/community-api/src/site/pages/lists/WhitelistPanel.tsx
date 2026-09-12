import { useState } from 'react';
import type { RosterWhitelistEntry } from '../../../roster';
import { fmtDate, xProfileUrl } from './lists-common';

/**
 * 推荐白名单公示面板：KOSX MiniMemberCard 同款名片卡（横幅渐变 + 头像压边 +
 * 昵称/@handle + 简介 line-clamp + 入册日期），社区抢救拆到 /lists/rescue。
 */
export function WhitelistPanel({ maintained }: { maintained: RosterWhitelistEntry[] }) {
  if (maintained.length === 0) {
    return <p className="panel-card px-4 py-10 text-center text-mist">暂无推荐白名单账号</p>;
  }
  return (
    <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {maintained.map((entry) => (
        <WhitelistCard key={entry.handle} entry={entry} />
      ))}
    </section>
  );
}

function WhitelistCard({ entry }: { entry: RosterWhitelistEntry }) {
  return (
    <a
      href={xProfileUrl(entry.handle)}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex h-full flex-col overflow-hidden rounded-2xl bg-surface shadow-[var(--panel-elev)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/40"
    >
      <div className="bg-gradient-to-r from-gold/15 via-surface to-surface size-full h-14 sm:h-16" aria-hidden="true">
        <div className="size-full bg-gradient-to-t from-surface via-surface/30 to-transparent" />
      </div>
      <div className="relative z-10 -mt-6 flex flex-1 flex-col px-4 pb-4">
        <Avatar url={entry.avatar_url} name={entry.name ?? entry.handle} className="size-12 ring-4 ring-surface" />
        <div className="mt-2 min-w-0">
          <div className="truncate text-sm font-semibold leading-tight text-ink">{entry.name ?? `@${entry.handle}`}</div>
          <div className="mt-0.5 truncate text-xs text-mist group-hover:text-gold">@{entry.handle}</div>
        </div>
        <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-mist" style={{ wordBreak: 'break-word' }}>
          {entry.note}
        </p>
        <div className="mt-auto pt-2 text-[11px] text-mist tabular-nums">入册 {fmtDate(entry.added_at)}</div>
      </div>
    </a>
  );
}

/**
 * 卡片头像：默认尝试 400x400 高清变体（pbs.twimg.com 支持换后缀），404 逐级
 * 回退 API 原图，再失败退首字母占位（KOSX Avatar 同款三档）。
 */
function Avatar({
  url,
  name,
  className,
}: {
  url: string | undefined;
  name: string;
  className: string;
}) {
  const hd = url ? hdVariant(url) : null;
  const [stage, setStage] = useState(hd && hd !== url ? 0 : 1);
  const initial = (name.trim()[0] ?? '?').toUpperCase();

  if (!url || stage >= 2) {
    return (
      <div
        className={`flex items-center justify-center rounded-full bg-soft-surface font-semibold text-mist ${className}`}
        aria-hidden="true"
      >
        {initial}
      </div>
    );
  }
  return (
    <img
      src={stage === 0 && hd ? hd : url}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setStage((s) => s + 1)}
      className={`rounded-full bg-soft-surface object-cover ${className}`}
    />
  );
}

function hdVariant(url: string): string {
  return url.replace(/_(?:normal|bigger|mini|\d+x\d+)(\.(?:jpe?g|png|webp|gif))$/i, '_400x400$1');
}
