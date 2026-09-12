import { useCallback, useEffect, useState } from 'react';
import {
  fetchHunterBoard,
  openLeaderboard,
  type HunterBoard,
  type HunterBoardRow,
} from '../../../src/lib/community/hunter';
import { UI_COPY, type UiLanguage } from '../../../src/lib/platform/i18n';
import { AppIcon, HelpIcon } from './shared';

/**
 * 打野 tab：只有打野榜本身——榜单速览（Top 行 + 我的战况）与官网完整榜单入口。
 * 战报（今日/子弹）与个人资料在「我的」页。
 * 三态分离：loading（骨架）/ error（可重试）/ 数据，绝不把加载中当成失败。
 */
export default function HuntingView({
  language,
}: {
  language: UiLanguage;
  notify?: (message: string | null) => void;
}) {
  const t = UI_COPY[language];
  const [board, setBoard] = useState<HunterBoard | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void fetchHunterBoard()
      .then((next) => {
        if (cancelled) return;
        setBoard(next);
        setStatus('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const retry = useCallback(() => {
    setStatus('loading');
    setReloadKey((key) => key + 1);
  }, []);

  const openFullBoard = useCallback(() => {
    void openLeaderboard();
  }, []);

  const openXProfile = useCallback((handle: string): void => {
    void browser.tabs.create({ url: `https://x.com/${handle}` });
  }, []);

  const me = board?.me ?? null;

  return (
    <div className="view-stack hunting-view">
      <section className="settings-card hunting-board-card">
        <div className="settings-card-head">
          <h2>{t.hunterTopBoard}</h2>
          <HelpIcon text={t.hunterAccuracyHint} />
        </div>
        {status === 'loading' ? (
          <p className="hunter-board-empty">{t.hunterLoading}</p>
        ) : status === 'error' ? (
          <div className="hunter-board-empty hunter-board-error">
            <p>{t.hunterLoadFailed}</p>
            <button type="button" className="hunter-retry" onClick={retry}>
              {t.hunterRetry}
            </button>
          </div>
        ) : board && board.rows.length ? (
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
              <p className="hunter-board-empty">{t.hunterUnranked}</p>
            )}
          </div>
        ) : (
          <p className="hunter-board-empty">{t.hunterUnranked}</p>
        )}

        <button type="button" className="hunter-site-cta" onClick={openFullBoard}>
          <AppIcon name="sidepanel" size={14} />
          <span>{t.hunterOpenSite}</span>
        </button>
      </section>
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
          {killsUnit ? `${row.kills} ${killsUnit}` : `${row.kills}`}
        </span>
        <span className="hunter-accuracy">{Math.round(row.accuracy * 100)}%</span>
      </span>
    </div>
  );
}
