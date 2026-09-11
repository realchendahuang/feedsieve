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
import { fetchHunterStatus, openLeaderboard, type HunterStatus } from '../../../src/lib/community/hunter';
import { UI_COPY, type UiLanguage } from '../../../src/lib/platform/i18n';

/**
 * 战报线（popup 首页底部）：今日猎获 / 子弹余量 / 本周排名。本地数据实时
 * 订阅，排名打开时拉一次；榜单本体在网页（弹窗原则：链接出去，不内嵌）。
 */
export default function HunterBar({ language }: { language: UiLanguage }) {
  const t = UI_COPY[language];
  const [todayBlocked, setTodayBlocked] = useState<number | null>(null);
  const [bullets, setBullets] = useState<{ left: number; total: number } | null>(null);
  const [status, setStatus] = useState<HunterStatus | null>(null);

  useEffect(() => {
    void getTodayStat().then((stat) => setTodayBlocked(stat.blocked));
    const applyLedger = (): void => {
      void loadSafetyLedger().then((ledger) => {
        const rolled = rolloverBudget(ledger, Date.now());
        setBullets({ left: remainingQuota(rolled, Date.now()), total: rolled.budget });
      });
    };
    applyLedger();
    void fetchHunterStatus().then(setStatus).catch(() => setStatus(null));
    const unsubs = [
      subscribeDaily((stats) => setTodayBlocked(stats.days[todayKey()]?.blocked ?? 0)),
      subscribeSafetyLedger(() => applyLedger()),
    ];
    return () => unsubs.forEach((unsub) => unsub());
  }, []);

  const openBoard = useCallback(async () => {
    await openLeaderboard(status?.mePrefix ?? null);
  }, [status]);

  if (todayBlocked == null) return null;

  return (
    <div className="hunter-bar">
      <span className="hunter-stat">{t.hunterToday(todayBlocked)}</span>
      {bullets ? (
        <span className="hunter-stat">{t.hunterBullets(bullets.left, bullets.total)}</span>
      ) : null}
      {status?.rank ? (
        <button type="button" className="hunter-link" onClick={() => void openBoard()}>
          {t.hunterWeek(status.rank, status.kills ?? 0)}
          <span aria-hidden="true">→</span>
        </button>
      ) : null}
    </div>
  );
}
