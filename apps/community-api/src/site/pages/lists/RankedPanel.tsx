import { useEffect, useState } from 'react';
import type { PublicBoard } from '../../data.functions';
import { HandleLink } from './lists-common';

/**
 * 排位赛榜单面板：周榜/总榜切换 + 30 秒静默刷新 + 葫芦娃徽章（自带 SSR 初始数据）。
 * 初始数据来自 SSR loader；切档与轮询走 server function 的客户端 RPC。
 */
export function RankedPanel({
  initial,
  refetch,
}: {
  initial: PublicBoard;
  refetch: (scope: 'week' | 'all') => Promise<PublicBoard>;
}) {
  const [scope, setScope] = useState<'week' | 'all'>('week');
  const [board, setBoard] = useState(initial);
  const [loading, setLoading] = useState(false);

  const isAll = scope === 'all';
  const rows = board.rows;

  // 停留在本页时 30 秒静默刷新周榜；页面不可见（切后台/tab 隐藏）即跳过
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.hidden || scope !== 'week') return;
      refetch('week')
        .then(setBoard)
        .catch(() => {});
    }, 30_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  const switchScope = (next: 'week' | 'all') => {
    if (scope === next) return;
    setScope(next);
    setLoading(true);
    refetch(next)
      .then(setBoard)
      .finally(() => setLoading(false));
  };

  const seasonText = isAll || !board.season ? '累计总分 · 一人一娃' : `第 ${board.season.id % 100} 周 · 剩 ${Math.max(0, Math.ceil((board.season.ends_at - board.updated_at) / 86400))} 天`;

  const foot =
    !isAll && board.last_season?.champions?.length
      ? `上届冠军 ${board.last_season.champions.map((c) => c.name).join('、')} · 第 ${board.last_season.id % 100} 周`
      : '确认击杀 +1 · 首杀 +1 · 误伤 −2 · 周一开榜';

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <span id="ranked-season" className="rounded-full bg-gold-surface px-3 py-1 text-sm font-semibold text-gold">
          {seasonText}
        </span>
        <div className="flex gap-1" role="tablist" aria-label="周榜/总榜">
          <button
            id="ranked-tab-week"
            type="button"
            aria-pressed={!isAll}
            onClick={() => switchScope('week')}
            className="rounded-full px-4 py-1.5 text-sm font-semibold transition-colors aria-pressed:bg-gold-surface aria-pressed:text-gold"
          >
            周榜
          </button>
          <button
            id="ranked-tab-all"
            type="button"
            aria-pressed={isAll}
            onClick={() => switchScope('all')}
            className="rounded-full px-4 py-1.5 text-sm font-semibold transition-colors aria-pressed:bg-gold-surface aria-pressed:text-gold"
          >
            总榜
          </button>
        </div>
      </div>
      <div className="grid gap-1" id="ranked-list" data-loading={loading ? 'true' : undefined}>
        {rows.length === 0 && (
          <p className="panel-card px-4 py-12 text-center text-mist">
            {isAll ? '总榜还没有人' : '本周还没有人开火'}
          </p>
        )}
        {rows.map((row) => (
          <RankedRow key={row.id} row={row} isAll={isAll} />
        ))}
      </div>
      <p className="mt-4 text-center text-xs text-mist" id="ranked-foot">
        {foot} · 更新于 {board.updated_at ? new Date(board.updated_at * 1000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '—'}
      </p>
    </div>
  );
}

function huluBadge(rank: number): string {
  if (rank <= 7) return ['大娃', '二娃', '三娃', '四娃', '五娃', '六娃', '七娃'][rank - 1] ?? '';
  if (rank <= 50) return '小金刚';
  return '';
}

function RankedRow({
  row,
  isAll,
}: {
  row: import('../../data.functions').PublicBoardRow;
  isAll: boolean;
}) {
  const badge = isAll ? huluBadge(row.rank) : '';
  const rankColor =
    row.rank === 1 ? 'text-rank-1' : row.rank === 2 ? 'text-rank-2' : row.rank === 3 ? 'text-rank-3' : 'text-fog';
  return (
    <div
      className={`flex items-center gap-3 border-b border-line/40 px-3 py-2.5 last:border-b-0 first:rounded-t-[var(--radius)] last:rounded-b-[var(--radius)] ${
        row.rank === 1 ? 'bg-gradient-to-r from-gold-surface/60 to-transparent' : ''
      }`}
      data-testid="ranked-row"
      data-tier={row.tier ?? ''}
      data-x-handle={row.x_handle ?? ''}
    >
      <span className={`w-10 shrink-0 text-right font-bold tabular-nums ${rankColor}`}>{row.rank}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-sm font-semibold">
          {badge && <span className="font-bold text-gold">{badge}</span>}
          {row.title && <span className="font-semibold text-gold-deep">◆ {row.title}</span>}
          {row.tier && <span className="text-mist">{row.tier}</span>}
          <span className="truncate">{row.name}</span>
        </div>
        {(row.bio || row.x_handle) && (
          <div className="mt-0.5 flex items-center gap-2 text-xs text-mist">
            {row.bio && <span className="max-w-xs truncate">{row.bio}</span>}
            {row.x_handle && <HandleLink handle={row.x_handle} className="text-xs" />}
          </div>
        )}
      </div>
      <div className="shrink-0 text-right text-sm tabular-nums">
        <span className="font-bold">{row.kills} 只野</span>
        <span className="ml-2 text-xs text-mist">{Math.round(row.accuracy * 100)}%</span>
      </div>
    </div>
  );
}
