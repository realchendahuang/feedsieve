import { useEffect, useState } from 'react';
import { getBlockedAccounts, subscribeBlocked, type BlockedAccount } from '../../../src/lib/blocked-accounts';
import { getStats, subscribeStats, type LocalStats } from '../../../src/lib/local-stats';
import {
  getAllowlist,
  removeAllowed,
  subscribeAllowlist,
  type AllowlistItem,
} from '../../../src/lib/allowlist';
import {
  getFollowingAllowlist,
  getFollowingSyncState,
  subscribeFollowingAllowlist,
  subscribeFollowingSyncState,
  type FollowingAllowlistItem,
  type FollowingSyncState,
} from '../../../src/lib/following-allowlist';
import { UI_COPY, type UiLanguage } from '../../../src/lib/i18n';
import type { UnblockBatchResult } from '../../../src/lib/run-unblock-batch';
import { allowlistReason, AppIcon, FAILURE_LABELS, formatDate } from './shared';

type ListView = 'blocked' | 'allowlist' | 'following';

function initialListView(): ListView {
  const value = new URLSearchParams(globalThis.location?.search ?? '').get('list');
  return value === 'allowlist' || value === 'following' ? value : 'blocked';
}

interface ListsViewProps {
  language: UiLanguage;
  notify: (message: string | null) => void;
  sendToXPage: (message: { type: string; handle?: string }) => Promise<unknown>;
  refreshPageMarked: () => Promise<void>;
}

export default function ListsView({
  language,
  notify,
  sendToXPage,
  refreshPageMarked,
}: ListsViewProps) {
  const t = UI_COPY[language];
  const [listView, setListView] = useState<ListView>(initialListView);
  const [blocked, setBlocked] = useState<BlockedAccount[] | null>(null);
  const [allowlist, setAllowlist] = useState<AllowlistItem[] | null>(null);
  const [following, setFollowing] = useState<FollowingAllowlistItem[] | null>(null);
  const [followingSync, setFollowingSync] = useState<FollowingSyncState>({
    status: 'idle',
    collected: 0,
    updatedAt: 0,
  });
  const [stats, setStats] = useState<LocalStats>({ detected: 0, blocked: 0, unblocked: 0 });
  const [unblockResult, setUnblockResult] = useState<UnblockBatchResult | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    void getBlockedAccounts().then(setBlocked);
    void getAllowlist().then(setAllowlist);
    void getFollowingAllowlist().then(setFollowing);
    void getFollowingSyncState().then(setFollowingSync);
    void getStats().then(setStats);
    const unsubs = [
      subscribeBlocked(setBlocked),
      subscribeAllowlist(setAllowlist),
      subscribeFollowingAllowlist(setFollowing),
      subscribeFollowingSyncState(setFollowingSync),
      subscribeStats(setStats),
    ];
    return () => unsubs.forEach((unsub) => unsub());
  }, []);

  async function runUnblock(handle?: string): Promise<void> {
    setRunning(true);
    notify(null);
    try {
      const result = (await sendToXPage({
        type: 'feedsieve:unblock',
        ...(handle ? { handle } : {}),
      })) as UnblockBatchResult;
      setUnblockResult(result);
      await refreshPageMarked();
    } catch {
      notify(t.openXNotice);
    } finally {
      setRunning(false);
    }
  }

  async function removeFromAllowlist(handle: string): Promise<void> {
    await removeAllowed(handle);
    await browser.runtime.sendMessage({ type: 'feedsieve:labels-sync' }).catch(() => undefined);
  }

  async function startFollowingSync(): Promise<void> {
    setRunning(true);
    notify(null);
    try {
      const result = (await sendToXPage({ type: 'feedsieve:following-sync-start' })) as {
        status?: string;
        error?: string;
      };
      if (result?.status === 'error') {
        notify(`${t.syncFailed}: ${result.error ?? t.unavailable}`);
      }
    } catch {
      notify(t.openXNotice);
    } finally {
      setRunning(false);
    }
  }

  const blockedCount = blocked?.length ?? null;
  const followingSyncActive =
    followingSync.status === 'running' || followingSync.status === 'waiting';
  // 关注同步"过期"提示：render 期不调用 Date.now（保持纯净），
  // 由 effect 每 5 秒重算一次，popup 打开期间提示会随最新状态自动刷新。
  const [followingSyncStale, setFollowingSyncStale] = useState(false);
  useEffect(() => {
    const refresh = (): void =>
      setFollowingSyncStale(
        followingSyncActive && Date.now() - followingSync.updatedAt > 60_000,
      );
    refresh();
    if (!followingSyncActive) return;
    const id = window.setInterval(refresh, 5_000);
    return () => window.clearInterval(id);
  }, [followingSyncActive, followingSync.updatedAt]);
  const failedSummary = (result: { failed: Array<{ handle: string; code: string }> } | null) =>
    result?.failed.length
      ? result.failed
          .map(
            (failure) =>
              `@${failure.handle} (${FAILURE_LABELS[language][failure.code] ?? failure.code})`,
          )
          .join(' · ')
      : null;

  return (
    <div className="view-stack lists-view">
      <section className="summary-card overview-total">
        <div className="section-heading compact">
          <h2>{t.totals}</h2>
        </div>
        <div className="metric-grid" aria-label={t.totals}>
          <div>
            <strong>{stats.detected}</strong>
            <span>{t.marked}</span>
          </div>
          <div>
            <strong>{stats.blocked}</strong>
            <span>{t.blocked}</span>
          </div>
          <div>
            <strong>{stats.unblocked}</strong>
            <span>{t.restored}</span>
          </div>
        </div>
      </section>
      <div className="list-tabs" role="tablist" aria-label={t.lists}>
        <button
          id="blocked-list-tab"
          type="button"
          role="tab"
          aria-selected={listView === 'blocked'}
          className={listView === 'blocked' ? 'is-selected' : ''}
          onClick={() => setListView('blocked')}
        >
          <span>{t.manageBlocked}</span>
          <strong>{blockedCount === null ? '…' : blockedCount}</strong>
        </button>
        <button
          id="allowlist-tab"
          type="button"
          role="tab"
          aria-selected={listView === 'allowlist'}
          className={listView === 'allowlist' ? 'is-selected' : ''}
          onClick={() => setListView('allowlist')}
        >
          <span>{t.falsePositiveList}</span>
          <strong>{allowlist === null ? '…' : allowlist.length}</strong>
        </button>
        <button
          id="following-tab"
          type="button"
          role="tab"
          aria-selected={listView === 'following'}
          className={listView === 'following' ? 'is-selected' : ''}
          onClick={() => setListView('following')}
        >
          <span>{t.followingTab}</span>
          <strong>{following === null ? '…' : following.length}</strong>
        </button>
      </div>

      <section
        className="manage-card"
        role="tabpanel"
        aria-labelledby={
          listView === 'blocked'
            ? 'blocked-list-tab'
            : listView === 'allowlist'
              ? 'allowlist-tab'
              : 'following-tab'
        }
      >
        {listView === 'blocked' ? (
          <>
            {blockedCount === null ? (
              <div className="loading-list" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
            ) : blockedCount > 0 ? (
              <ul className="manage-list">
                {blocked!.map((account) => (
                  <li key={account.handle} className="manage-item">
                    <span className="account-avatar is-muted" aria-hidden="true">
                      {account.handle.slice(0, 1).toUpperCase()}
                    </span>
                    <div className="account-info">
                      <span className="account-handle">@{account.handle}</span>
                      <span className="account-reason">
                        {formatDate(account.blockedAt, language)}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="secondary-inline"
                      disabled={running}
                      onClick={() => void runUnblock(account.handle)}
                    >
                      {t.undo}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="empty-panel">
                <AppIcon name="lists" size={26} />
                <p>{t.noBlocked}</p>
              </div>
            )}

            {unblockResult ? (
              <p className="result-message" role="status">
                {t.restoredResult(unblockResult.unblocked.length)}
                {failedSummary(unblockResult) ? (
                  <span className="result-failure">
                    {' '}
                    · {t.failedResult(unblockResult.failed.length)} ·{' '}
                    {failedSummary(unblockResult)}
                  </span>
                ) : null}
              </p>
            ) : null}
            {blockedCount ? (
              <button
                className="secondary-action"
                disabled={running}
                onClick={() => void runUnblock()}
              >
                {t.undoAll}
              </button>
            ) : null}
          </>
        ) : listView === 'allowlist' ? (
          <>
            {allowlist === null ? (
              <div className="loading-list" aria-hidden="true">
                <span />
                <span />
              </div>
            ) : allowlist.length > 0 ? (
              <ul className="manage-list allowlist-list">
                {allowlist.map((item) => (
                  <li key={item.handle} className="manage-item allowlist-item">
                    <span className="account-avatar is-safe" aria-hidden="true">
                      {item.handle.slice(0, 1).toUpperCase()}
                    </span>
                    <div className="account-info">
                      <span className="account-handle">@{item.handle}</span>
                      <span className="account-meta">
                        {formatDate(item.addedAt, language)}
                      </span>
                      {item.detectionReason ? (
                        <span
                          className="account-reason"
                          title={allowlistReason(item, language)}
                        >
                          {allowlistReason(item, language)}
                        </span>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className="remove-action"
                      aria-label={`${t.removeAllowlist}: @${item.handle}`}
                      title={t.removeAllowlist}
                      onClick={() => void removeFromAllowlist(item.handle)}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="empty-panel">
                <AppIcon name="shield" size={26} />
                <p>{t.allowlistEmpty}</p>
              </div>
            )}
          </>
        ) : (
          <>
            {followingSyncStale ? (
              <p className="inline-notice result-failure">{t.syncFollowingInterrupted}</p>
            ) : followingSyncActive ? (
              <p className="inline-notice">{t.syncFollowingWorking(followingSync.collected)}</p>
            ) : followingSync.status === 'complete' ? (
              <p className="inline-notice">{t.syncFollowingComplete(followingSync.collected)}</p>
            ) : followingSync.status === 'error' ? (
              <p className="inline-notice result-failure">
                {t.syncFailed}: {followingSync.error ?? t.unknown}
              </p>
            ) : null}
            <button
              type="button"
              className="secondary-action"
              disabled={running || (followingSyncActive && !followingSyncStale)}
              onClick={() => void startFollowingSync()}
            >
              {followingSyncStale ? t.resyncFollowing : t.syncFollowing}
            </button>
          </>
        )}
      </section>
    </div>
  );
}
