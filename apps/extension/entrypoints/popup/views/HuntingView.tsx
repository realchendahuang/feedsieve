import { useCallback, useEffect, useState } from 'react';
import {
  getTodayStat,
  subscribeDaily,
  todayKey,
} from '../../../src/lib/stats/daily-stats';
import {
  loadSafetyLedger,
  remainingQuota,
  rolloverBudget,
  subscribeSafetyLedger,
} from '../../../src/lib/queue/block-safety';
import {
  fetchHunterBoard,
  openLeaderboard,
  type HunterBoard,
  type HunterBoardRow,
} from '../../../src/lib/community/hunter';
import { UI_COPY, type UiLanguage } from '../../../src/lib/platform/i18n';

/**
 * 打野 tab（一级入口）：我的战报 + 周榜速览 + 猎手档案。
 * 完整榜单在官网（弹窗原则：链接出去，不内嵌）。
 */
export default function HuntingView({
  language,
}: {
  language: UiLanguage;
  notify?: (message: string | null) => void;
}) {
  const t = UI_COPY[language];
  const [todayBlocked, setTodayBlocked] = useState<number | null>(null);
  const [bullets, setBullets] = useState<{ left: number; total: number } | null>(null);
  const [board, setBoard] = useState<HunterBoard | null>(null);

  useEffect(() => {
    void getTodayStat().then((stat) => setTodayBlocked(stat.blocked));
    const applyLedger = (): void => {
      void loadSafetyLedger().then((ledger) => {
        const rolled = rolloverBudget(ledger, Date.now());
        setBullets({ left: remainingQuota(rolled, Date.now()), total: rolled.budget });
      });
    };
    applyLedger();
    void fetchHunterBoard().then(setBoard).catch(() => setBoard(null));
    const unsubs = [
      subscribeDaily((stats) => setTodayBlocked(stats.days[todayKey()]?.blocked ?? 0)),
      subscribeSafetyLedger(() => applyLedger()),
    ];
    return () => unsubs.forEach((unsub) => unsub());
  }, []);

  const openFullBoard = useCallback(() => {
    void openLeaderboard(board?.me?.id ?? null);
  }, [board]);

  const openXProfile = useCallback((handle: string): void => {
    void browser.tabs.create({ url: `https://x.com/${handle}` });
  }, []);

  if (todayBlocked == null) return null;

  const me = board?.me ?? null;
  // 打败百分比 = 1 - 本周排名/总人数；垫底就是 0%，不虚报
  const beatenPct =
    me?.rank && board && board.total > 0
      ? Math.max(0, Math.round((1 - me.rank / board.total) * 100))
      : null;

  return (
    <>
      <section className="settings-card">
        <div className="settings-card-head">
          <h2>{t.hunterReportTitle}</h2>
        </div>
        <div className="hunter-report-grid">
          <HunterStat label={t.statToday} value={String(todayBlocked)} />
          <HunterStat
            label={t.statBullets}
            value={bullets ? `${bullets.left}/${bullets.total}` : '—'}
          />
          <HunterStat
            label={t.statWeek}
            value={me?.rank ? `#${me.rank}` : '—'}
            sub={me ? `${me.kills} ${t.hunterKillsUnit}` : t.hunterUnrankedShort}
          />
          <HunterStat
            label={t.statBeaten}
            value={beatenPct != null ? `${beatenPct}%` : '—'}
            hero={beatenPct != null}
          />
        </div>
        {me?.tier || me?.title ? (
          <div className="hunter-titles">
            {me?.tier ? <span className="hunter-tier">{me.tier}</span> : null}
            {me?.title ? <span className="hunter-title-badge">{me.title}</span> : null}
          </div>
        ) : null}
      </section>

      <section className="settings-card">
        <div className="settings-card-head">
          <h2>{t.hunterTopBoard}</h2>
          <button type="button" className="text-action" onClick={openFullBoard}>
            {t.hunterFullBoard}
          </button>
        </div>
        {board && board.rows.length ? (
          <div className="hunter-board">
            {board.rows.map((row) => (
              <BoardRow
                key={row.id}
                row={row}
                isMe={false}
                onOpenX={openXProfile}
                killsUnit={t.hunterKillsUnit}
              />
            ))}
            {me ? (
              <BoardRow
                row={me}
                isMe
                onOpenX={openXProfile}
                killsUnit={t.hunterKillsUnit}
              />
            ) : (
              <button type="button" className="text-action hunter-unranked" onClick={openFullBoard}>
                {t.hunterUnranked}
              </button>
            )}
          </div>
        ) : board ? (
          <button type="button" className="text-action hunter-unranked" onClick={openFullBoard}>
            {t.hunterUnranked}
          </button>
        ) : (
          <div className="hunter-board-empty">{t.hunterLoadFailed}</div>
        )}
      </section>
    </>
  );
}

function HunterStat({
  label,
  value,
  sub,
  hero,
}: {
  label: string;
  value: string;
  sub?: string;
  /** hero：百分位这种"荣誉值"用主题色放大表现 */
  hero?: boolean;
}) {
  return (
    <div className={hero ? 'hunter-stat hunter-stat-hero' : 'hunter-stat'}>
      <span className="hunter-stat-value">{value}</span>
      <span className="hunter-stat-label">{label}</span>
      {sub ? <span className="hunter-stat-sub">{sub}</span> : null}
    </div>
  );
}

function BoardRow({
  row,
  isMe,
  onOpenX,
  killsUnit,
}: {
  row: HunterBoardRow;
  isMe: boolean;
  onOpenX: (handle: string) => void;
  killsUnit: string;
}) {
  return (
    <div className={isMe ? 'hunter-row is-me' : 'hunter-row'}>
      <span className={row.rank != null && row.rank <= 3 ? 'hunter-rank top' : 'hunter-rank'}>
        {row.rank}
      </span>
      <span className="hunter-who">
        <span className="hunter-name">
          {row.tier ? <span className="hunter-tier">{row.tier}</span> : null}
          {row.title ? <span className="hunter-title-badge">{row.title}</span> : null}
          {row.name}
        </span>
        {row.bio ? <span className="hunter-row-bio">{row.bio}</span> : null}
        {row.x_handle ? (
          <button
            type="button"
            className="hunter-handle"
            onClick={() => onOpenX(row.x_handle!)}
          >
            @{row.x_handle}
          </button>
        ) : null}
      </span>
      <span className="hunter-stats">
        <span className="hunter-kills">
          {row.kills} {killsUnit}
        </span>
        <span className="hunter-accuracy">{Math.round(row.accuracy * 100)}%</span>
      </span>
    </div>
  );
}
