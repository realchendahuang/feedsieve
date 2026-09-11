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
} from '../../../src/lib/community/hunter';
import { UI_COPY, type UiLanguage } from '../../../src/lib/platform/i18n';
import HunterProfile from './HunterProfile';

/**
 * 打野 tab（一级入口）：我的战报 + 周榜速览 + 猎手档案。
 * 完整榜单在官网（弹窗原则：链接出去，不内嵌）。
 */
export default function HuntingView({
  language,
  notify,
}: {
  language: UiLanguage;
  notify: (message: string | null) => void;
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
    const mePrefix = board?.me?.id ?? null;
    void openLeaderboard(mePrefix);
  }, [board]);

  if (todayBlocked == null) return null;

  const me = board?.me ?? null;
  // 打败百分比 = 1 - 本周排名/总人数；round 下界出 0%（垫底就是 0，不虚）
  const beatenPct =
    me?.rank && board && board.total > 0
      ? Math.max(0, Math.round((1 - me.rank / board.total) * 100))
      : null;

  const openXHandle = (handle: string): void => {
    void browser.tabs.create({ url: `https://x.com/${handle}` });
  };

  return (
    <>
      <section className="settings-card">
        <div className="settings-card-head">
          <h2>{t.hunterReportTitle}</h2>
        </div>
        <div className="hunter-report">
          <span className="hunter-stat">{t.hunterToday(todayBlocked)}</span>
          {bullets ? (
            <span className="hunter-stat">{t.hunterBullets(bullets.left, bullets.total)}</span>
          ) : null}
          {me?.rank ? (
            <span className="hunter-stat">{t.hunterWeek(me.rank, me.kills)}</span>
          ) : null}
          {beatenPct != null ? (
            <span className="hunter-stat hunter-beaten">{t.hunterBeaten(beatenPct)}</span>
          ) : null}
        </div>
        {me?.tier ?? me?.title ? (
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
              <div className="hunter-row" key={row.id}>
                <span className="hunter-rank">{row.rank}</span>
                <span className="hunter-who">
                  <span className="hunter-name">
                    {row.title ? <span className="hunter-title-badge">{row.title}</span> : null}
                    {row.tier ? <span className="hunter-tier">{row.tier}</span> : null}
                    {row.name}
                  </span>
                  {row.x_handle ? (
                    <button
                      type="button"
                      className="hunter-handle"
                      onClick={() => openXHandle(row.x_handle!)}
                    >
                      @{row.x_handle}
                    </button>
                  ) : null}
                </span>
                <span className="hunter-stats">
                  <span className="hunter-kills">{row.kills}</span>
                  <span className="hunter-accuracy">{Math.round(row.accuracy * 100)}%</span>
                </span>
              </div>
            ))}
            {me ? (
              <div className="hunter-row is-me">
                <span className="hunter-rank">{me.rank}</span>
                <span className="hunter-who">
                  <span className="hunter-name">{me.name}</span>
                </span>
                  <span className="hunter-stats">
                    <span className="hunter-kills">{me?.kills ?? ''}</span>
                    <span className="hunter-accuracy">{me ? `${Math.round(me.accuracy * 100)}%` : ''}</span>
                  </span>
              </div>
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
          <div className="hunter-board-empty">{t.hunterError}</div>
        )}
      </section>

      <HunterProfile language={language} notify={notify} />
    </>
  );
}
