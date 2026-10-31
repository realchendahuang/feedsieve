import { useEffect, useState } from 'react';
import {
  getFollowingSyncState,
  subscribeFollowingSyncState,
  type FollowingSyncState,
} from '../../../../src/lib/community/following-allowlist';
import { UI_COPY, type UiLanguage } from '../../../../src/lib/platform/i18n';
import { HelpIcon } from '../shared';
import type { SubpageSendToXPage } from './types';

interface FollowingPageProps {
  language: UiLanguage;
  notify: (message: string | null) => void;
  sendToXPage: SubpageSendToXPage;
  count: number | null;
}

/** 关注保护：同步关注列表，关注的人永远不会被标注或拉黑。 */
export default function FollowingPage({
  language,
  notify,
  sendToXPage,
  count,
}: FollowingPageProps) {
  const t = UI_COPY[language];
  const [sync, setSync] = useState<FollowingSyncState>({
    status: 'idle',
    collected: 0,
    updatedAt: 0,
  });
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    void getFollowingSyncState().then(setSync);
    return subscribeFollowingSyncState(setSync);
  }, []);

  const active = sync.status === 'running' || sync.status === 'waiting';
  // 同步「卡住」判断：render 期不调 Date.now，由 effect 每 5 秒重算
  const [stale, setStale] = useState(false);
  useEffect(() => {
    const refresh = (): void => setStale(active && Date.now() - sync.updatedAt > 60_000);
    refresh();
    if (!active) return;
    const id = window.setInterval(refresh, 5_000);
    return () => window.clearInterval(id);
  }, [active, sync.updatedAt]);

  async function start(): Promise<void> {
    setStarting(true);
    notify(null);
    try {
      const result = (await sendToXPage({ type: 'feedsieve:following-sync-start' })) as {
        status?: string;
        error?: string;
      };
      if (result?.status === 'error') notify(`${t.syncFailed}: ${result.error ?? t.unavailable}`);
    } catch {
      notify(t.openXNotice);
    } finally {
      setStarting(false);
    }
  }

  const status = stale
    ? { text: t.syncFollowingInterrupted, failure: true }
    : active
      ? { text: t.syncFollowingWorking(sync.collected), failure: false }
      : sync.status === 'error'
        ? { text: `${t.syncFailed}: ${sync.error ?? t.unknown}`, failure: true }
        : null;

  return (
    <>
      <div className="group">
        <div className="row">
          <div className="row-label">
            <span>{t.followingProtected}</span>
            <HelpIcon text={t.followingProtectHint} />
          </div>
          <span className="row-value">{count ?? '…'}</span>
        </div>
        <div className="row">
          <div className="row-label">
            <span>{t.followingLastSync}</span>
          </div>
          <span className="row-value">
            {sync.updatedAt > 0
              ? new Date(sync.updatedAt).toLocaleDateString(language === 'zh' ? 'zh-CN' : 'en', {
                  month: 'short',
                  day: 'numeric',
                })
              : '—'}
          </span>
        </div>
      </div>
      {status ? (
        <p className={status.failure ? 'alert' : 'result'} role="status">
          {status.text}
        </p>
      ) : null}
      <div className="action-bar">
        <button
          type="button"
          className="secondary-button"
          disabled={starting || (active && !stale)}
          onClick={() => void start()}
        >
          {stale ? t.resyncFollowing : t.syncFollowing}
        </button>
      </div>
    </>
  );
}
