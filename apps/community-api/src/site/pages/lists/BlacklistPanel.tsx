import { useMemo, useState } from 'react';
import { categoryLabel } from '@feedsieve/shared';
import type { RosterBlacklistEntry } from '../../../roster';
import { HandleLink, fmtDate } from './lists-common';
import { cn } from './../../lib/utils';

/**
 * 黑名单公示面板：搜索 + 100/页分页 + 行展开明细（维护者说明 / 证据帖 / 外链 / 历史名）。
 * 数据来自 SSR loader（RosterPayload），数据来自 SSR loader（RosterPayload），
 * 搜索/分页为客户端状态，行为口径不变。
 */
export function BlacklistPanel({ entries }: { entries: RosterBlacklistEntry[] }) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const PAGE_SIZE = 100;

  const sorted = useMemo(() => [...entries].sort((a, b) => b.net_votes - a.net_votes), [entries]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^@/, '');
    return q ? sorted.filter((e) => e.handle.toLowerCase().includes(q)) : sorted;
  }, [sorted, query]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pages - 1);
  const rows = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
          placeholder="搜账号"
          aria-label="搜索黑名单账号"
          id="blacklist-search"
          className="h-9 w-56 rounded-full border border-line bg-surface px-4 text-sm outline-none focus:border-gold focus:ring-[3px] focus:ring-ring/30"
        />
      </div>
      <div className="panel-card overflow-hidden">
        <table className="w-full text-sm" id="blacklist-table">
          <thead>
            <tr className="border-b border-line/70 text-left text-xs text-mist">
              <th className="px-4 py-3 font-semibold">账号</th>
              <th className="px-4 py-3 font-semibold">分类</th>
              <th className="px-4 py-3 font-semibold">来源</th>
              <th className="px-4 py-3 text-right font-semibold">拉黑</th>
              <th className="px-4 py-3 text-right font-semibold">抢救</th>
              <th className="px-4 py-3 text-right font-semibold">净票</th>
              <th className="px-4 py-3 font-semibold">更新</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((entry) => {
              const expandable =
                !!(entry.maintainer_note || entry.aliases?.length || entry.evidence_post_ids?.length || entry.domains?.length);
              return (
                <>
                  <tr
                    key={entry.handle}
                    onClick={(e) => {
                      const t = e.target as HTMLElement;
                      if (t.closest('a')) return;
                      if (!expandable) return;
                      setOpen((prev) => ({ ...prev, [entry.handle]: !prev[entry.handle] }));
                    }}
                    className={cn('border-b border-line/40', expandable && 'cursor-pointer hover:bg-wash')}
                  >
                    <td className="px-4 py-2.5"><HandleLink handle={entry.handle} /></td>
                    <td className="px-4 py-2.5 text-mist">{categoryLabel(entry.category)}</td>
                    <td className="px-4 py-2.5">
                      {entry.sources.map((src) => (
                        <span key={src} className="mr-1 rounded-full bg-gold-surface px-2 py-0.5 text-xs font-semibold text-gold">
                          {src === 'maintainer' ? '维护者' : '社区'}
                        </span>
                      ))}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{entry.report_count}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{entry.rescue_count}</td>
                    <td className="px-4 py-2.5 text-right font-bold tabular-nums">{entry.net_votes}</td>
                    <td className="px-4 py-2.5 text-mist tabular-nums">{fmtDate(entry.updated_at)}</td>
                  </tr>
                  {open[entry.handle] && expandable && (
                    <tr key={`${entry.handle}-detail`} className="border-b border-line/40 bg-soft-surface">
                      <td colSpan={7} className="px-4 py-3 text-xs text-mist">
                        <DetailLine label="自述与说明" value={entry.maintainer_note} />
                        {entry.evidence_post_ids?.length ? (
                          <DetailLine label="证据帖">
                            {entry.evidence_post_ids.map((id) => (
                              <a
                                key={id}
                                href={`https://x.com/i/web/status/${encodeURIComponent(id)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="mr-3 text-ink underline-offset-4 hover:underline"
                              >
                                {id}
                              </a>
                            ))}
                          </DetailLine>
                        ) : null}
                        {entry.domains?.length ? <DetailLine label="外链" value={entry.domains.join(' · ')} /> : null}
                        {entry.aliases?.length ? <DetailLine label="历史名" value={entry.aliases.join(' · ')} /> : null}
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && <p className="px-4 py-10 text-center text-mist">无匹配</p>}
      </div>
      {pages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3 text-sm text-mist">
          <button
            type="button"
            disabled={safePage <= 0}
            onClick={() => setPage(safePage - 1)}
            className="rounded-full border border-line px-4 py-1.5 transition-colors hover:bg-soft-surface disabled:opacity-40"
          >
            上一页
          </button>
          <span className="tabular-nums">
            第 {safePage + 1} / {pages} 页 · {filtered.length} 条
          </span>
          <button
            type="button"
            disabled={safePage >= pages - 1}
            onClick={() => setPage(safePage + 1)}
            className="rounded-full border border-line px-4 py-1.5 transition-colors hover:bg-soft-surface disabled:opacity-40"
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
}

function DetailLine({ label, value, children }: { label: string; value?: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 py-0.5">
      <span className="shrink-0 font-semibold text-mist">{label}</span>
      <span className="min-w-0 break-all">{value ?? children}</span>
    </div>
  );
}
