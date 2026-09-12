import { useMemo, useState } from 'react';
import type { RosterVerifiedEntry } from '../../../roster';
import { HandleLink, fmtDate } from './lists-common';

/**
 * 社区抢救公示面板：被验证为「误标正常」的账号，50/页分页（净票降序）。
 */
export function RescuePanel({ verified }: { verified: RosterVerifiedEntry[] }) {
  const PAGE_SIZE = 50;
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => [...verified].sort((a, b) => b.net_votes - a.net_votes), [verified]);
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, pages - 1);
  const rows = sorted.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  return (
    <section>
      <div className="panel-card overflow-hidden">
        <table className="w-full text-sm" id="verified-table">
          <thead>
            <tr className="border-b border-line/70 text-left text-xs text-mist">
              <th className="px-4 py-3 font-semibold">账号</th>
              <th className="px-4 py-3 text-right font-semibold">抢救</th>
              <th className="px-4 py-3 text-right font-semibold">拉黑</th>
              <th className="px-4 py-3 text-right font-semibold">净票</th>
              <th className="px-4 py-3 font-semibold">更新</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((entry) => (
              <tr key={entry.handle} className="border-b border-line/40">
                <td className="px-4 py-2.5"><HandleLink handle={entry.handle} /></td>
                <td className="px-4 py-2.5 text-right tabular-nums">{entry.rescue_count}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{entry.report_count}</td>
                <td className="px-4 py-2.5 text-right font-bold tabular-nums">{entry.net_votes}</td>
                <td className="px-4 py-2.5 text-mist tabular-nums">{fmtDate(entry.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {sorted.length === 0 && <p className="px-4 py-10 text-center text-mist">暂无记录</p>}
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
            第 {safePage + 1} / {pages} 页 · {sorted.length} 条
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
    </section>
  );
}
