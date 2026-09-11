import { useEffect, useState } from 'react';
import type { CommunityEntry } from '@feedsieve/community-lists';
import { getBlockedAccounts, subscribeBlocked, type BlockedAccount } from '../../../src/lib/blocked-accounts';
import {
  addAllowlist,
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
import {
  blockQueueProgress,
  getPersistentBlockQueue,
  subscribePersistentBlockQueue,
  type PersistentBlockQueueState,
} from '../../../src/lib/block-queue-store';
import {
  DEFAULT_PRESET,
  loadSafetyLedger,
  SAFETY_PRESETS,
  subscribeSafetyLedger,
  type SafetyLedger,
} from '../../../src/lib/block-safety';
import { UI_COPY, type UiLanguage } from '../../../src/lib/i18n';
import type { UnblockBatchResult } from '../../../src/lib/run-unblock-batch';
import {
  allowlistReason,
  AppIcon,
  FAILURE_LABELS,
  formatAgo,
  formatDate,
  HelpIcon,
  normalizeManualInput,
  type CommunityMeta,
} from './shared';
import QueuePanel from './QueuePanel';

type ListView = 'community' | 'blocked' | 'allowlist' | 'following';

function initialListView(): ListView {
  const value = new URLSearchParams(globalThis.location?.search ?? '').get('list');
  return value === 'blocked' ||
    value === 'allowlist' ||
    value === 'following' ||
    value === 'community'
    ? value
    : 'community';
}

interface SendMessageShape {
  type: string;
  handle?: string;
  force?: boolean;
  items?: Array<{ handle: string; xUserId?: string; category: string }>;
}

interface ListsViewProps {
  language: UiLanguage;
  notify: (message: string | null) => void;
  sendToXPage: (message: SendMessageShape) => Promise<unknown>;
  refreshPageMarked: () => Promise<void>;
  pauseDestructive: boolean;
  communityEntries: CommunityEntry[];
  communityMeta: CommunityMeta | null;
  onRefreshCommunitySnapshot: () => Promise<void>;
}

export default function ListsView({
  language,
  notify,
  sendToXPage,
  refreshPageMarked,
  pauseDestructive,
  communityEntries,
  communityMeta,
  onRefreshCommunitySnapshot,
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
  const [unblockResult, setUnblockResult] = useState<UnblockBatchResult | null>(null);
  const [running, setRunning] = useState(false);
  const [allowHandle, setAllowHandle] = useState('');
  const [allowAdding, setAllowAdding] = useState(false);
  const [manualHandle, setManualHandle] = useState('');
  const [manualRunning, setManualRunning] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [queue, setQueue] = useState<PersistentBlockQueueState | null>(null);
  // 安全额度条：滚动 24h 已用数（暂停原因文案用到预算上限）
  const [safety, setSafety] = useState<SafetyLedger | null>(null);

  async function runManualBlock(): Promise<void> {
    const handle = normalizeManualInput(manualHandle);
    if (!handle) {
      notify(t.invalidHandle);
      return;
    }
    setManualRunning(true);
    notify(null);
    try {
      const result = (await sendToXPage({
        type: 'feedsieve:manual-spam-block',
        handle,
      })) as { ok?: boolean; code?: string };
      if (result?.ok) {
        setManualHandle('');
        notify(t.manualBlocked(handle));
        setBlocked(await getBlockedAccounts());
        await refreshPageMarked();
      } else {
        notify(`${t.failed}: ${result?.code ?? t.unknown}`);
      }
    } catch {
      notify(t.openXNotice);
    } finally {
      setManualRunning(false);
    }
  }

  useEffect(() => {
    void getBlockedAccounts().then(setBlocked);
    void getAllowlist().then(setAllowlist);
    void getFollowingAllowlist().then(setFollowing);
    void getFollowingSyncState().then(setFollowingSync);
    void getPersistentBlockQueue().then(setQueue);
    void loadSafetyLedger().then(setSafety);
    const unsubs = [
      subscribeBlocked(setBlocked),
      subscribeAllowlist(setAllowlist),
      subscribeFollowingAllowlist(setFollowing),
      subscribeFollowingSyncState(setFollowingSync),
      subscribePersistentBlockQueue(setQueue),
      subscribeSafetyLedger(setSafety),
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

  /** 手动加入白名单（覆盖 @handle / x.com 主页链接两种输入）。 */
  async function addToAllowlist(): Promise<void> {
    const handle = normalizeManualInput(allowHandle);
    if (!handle) {
      notify(t.invalidHandle);
      return;
    }
    setAllowAdding(true);
    notify(null);
    try {
      await addAllowlist(handle);
      setAllowHandle('');
      notify(t.allowlistAdded(handle));
      await browser.runtime.sendMessage({ type: 'feedsieve:labels-sync' }).catch(() => undefined);
    } finally {
      setAllowAdding(false);
    }
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

  async function syncCommunityNow(): Promise<void> {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = (await browser.runtime.sendMessage({
        type: 'feedsieve:community-sync',
        force: true,
      })) as { outcome?: { status: string; version?: string; error?: string } };
      const outcome = res?.outcome;
      if (outcome?.status === 'updated' || outcome?.status === 'unchanged') {
        await onRefreshCommunitySnapshot();
        // 瞬时成功提示走 toast（4s 自动消失，AGENTS 红线：不常驻遮挡界面）；
        // 错误留在 inline 供排查。
        notify(outcome.status === 'updated' ? t.synced(outcome.version) : t.upToDate);
      } else if (outcome?.status === 'error') {
        setSyncMsg(outcome.error ? `${t.syncFailed}: ${outcome.error}` : t.syncFailed);
      } else {
        setSyncMsg(t.unavailable);
      }
    } catch {
      setSyncMsg(t.backgroundUnavailable);
    } finally {
      setSyncing(false);
    }
  }

  async function startCommunityQueue(): Promise<void> {
    if (cloudEligible.length === 0) return;
    setRunning(true);
    notify(null);
    try {
      await sendToXPage({
        type: 'feedsieve:community-block-start',
        items: cloudEligible.map((entry) => ({
          handle: entry.handle,
          ...(entry.x_user_id ? { xUserId: entry.x_user_id } : {}),
          category: entry.category,
        })),
      });
    } catch {
      notify(t.openXNotice);
    } finally {
      setRunning(false);
    }
  }

  async function controlQueue(action: 'resume' | 'pause' | 'cancel'): Promise<void> {
    try {
      await sendToXPage({ type: `feedsieve:block-queue-${action}` });
    } catch {
      notify(t.openXNotice);
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

  const protectedHandles = new Set([
    ...(allowlist ?? []).map((item) => item.handle),
    ...(following ?? []).map((item) => item.handle),
    ...(blocked ?? []).map((item) => item.handle),
  ]);
  const cloudEligibleSet = new Set(
    communityEntries
      .filter((entry) => !protectedHandles.has(entry.handle.toLowerCase()))
      .map((entry) => entry.handle.toLowerCase()),
  );
  const cloudEligible = communityEntries.filter((entry) =>
    cloudEligibleSet.has(entry.handle.toLowerCase()),
  );
  const cloudExcluded = communityEntries.length - cloudEligible.length;
  const queueSummary = blockQueueProgress(queue);
  const queueDone = queueSummary.success + queueSummary.failed;
  const queueActive =
    queue &&
    queueSummary.total > 0 &&
    (queue.status === 'running' || queue.status === 'paused');
  // 社区清理失败项：队列收尾后留在卡片上按来源标签展示原因（如「缺少用户 ID」），
  // 避免用户对「怎么都清不掉」的条目陷在无限重试里。
  const queueFailedTasks =
    queue && queue.source === 'community-batch'
      ? queue.tasks.filter((task) => task.status === 'failed')
      : [];
  const queueStatusLabel = queue
    ? {
        running: t.queueRunning,
        paused: t.queuePaused,
        completed: t.queueCompleted,
        cancelled: t.queueCancelled,
      }[queue.status]
    : '';
  // 暂停原因专属说明：仅额度用尽 / 短窗限流两种需要解释，其余用通用「已暂停」
  const queuePauseNote =
    queue?.status === 'paused' && queue.pauseReason === 'quota_exhausted'
      ? t.queuePausedQuota(safety?.budget ?? SAFETY_PRESETS[DEFAULT_PRESET].dailyLimit)
      : queue?.status === 'paused' && queue.pauseReason === 'rate_limit_storm'
        ? t.queuePausedRateLimit
        : null;
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
      <div className="list-tabs" role="tablist" aria-label={t.lists}>
        <button
          id="community-list-tab"
          type="button"
          role="tab"
          aria-selected={listView === 'community'}
          className={listView === 'community' ? 'is-selected' : ''}
          onClick={() => setListView('community')}
        >
          <span>{t.communityClean}</span>
          <strong>{cloudEligible.length}</strong>
        </button>
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
        className={listView === 'community' ? 'manage-card community-fill-card' : 'manage-card'}
        role="tabpanel"
        aria-labelledby={
          listView === 'community'
            ? 'community-list-tab'
            : listView === 'blocked'
              ? 'blocked-list-tab'
              : listView === 'allowlist'
                ? 'allowlist-tab'
                : 'following-tab'
        }
      >
        {listView === 'community' ? (
          <>
            <div className="section-heading compact">
              <h2 id="community-clean-title">
                {t.communityClean} <HelpIcon text={t.communityCleanHint} />
              </h2>
              <div className="settings-head-actions">
                <span
                  className={`community-meta${communityMeta ? ' is-ready' : ''}`}
                  title={
                    communityMeta
                      ? `v${communityMeta.version} · ${formatAgo(communityMeta.syncedAt, language)}`
                      : t.listLoading
                  }
                >
                  {communityMeta ? `${communityMeta.count} · v${communityMeta.version}` : '…'}
                </span>
                <button
                  type="button"
                  className={`square-action small${syncing ? ' is-spinning' : ''}`}
                  aria-label={t.syncNow}
                  title={t.syncNow}
                  disabled={syncing}
                  onClick={() => void syncCommunityNow()}
                >
                  <AppIcon name="refresh" size={18} />
                </button>
              </div>
            </div>
            {syncMsg ? <p className="inline-notice">{syncMsg}</p> : null}

            <div className="community-clean-metrics">
              <span>
                {t.cloudEligible} <strong>{cloudEligible.length}</strong>
              </span>
              <span>
                {t.cloudProtected} <strong>{cloudExcluded}</strong>
              </span>
            </div>

            {/* 动作区固定在首屏（统计条之下、名单之上）：一键入口和队列进度
                不能落到折叠线以下，否则 600px 弹窗里用户根本找不到发起入口。 */}
            {queueActive ? (
              <QueuePanel
                language={language}
                queue={queue!}
                done={queueDone}
                total={queueSummary.total}
                statusLabel={queueStatusLabel}
                pauseNote={queuePauseNote}
                onControl={(action) => void controlQueue(action)}
              />
            ) : queueFailedTasks.length > 0 ? (
              // 队列已收尾但仍有失败项：如实展示失败原因，而不是让按钮无声地重试
              <div className="queue-panel queue-result" role="status">
                <div className="queue-line">
                  <span>
                    {t.communityClean} · {t.queueProgress(queueDone, queueSummary.total)}
                  </span>
                  <strong>{queueStatusLabel}</strong>
                </div>
                <ul className="queue-failed-list">
                  {queueFailedTasks.map((task) => (
                    <li key={task.handle}>
                      @{task.handle}（
                      {FAILURE_LABELS[language][task.failureCode ?? ''] ??
                        task.failureCode ??
                        t.unknown}
                      ）
                    </li>
                  ))}
                </ul>
                <button
                  className="secondary-action community-clean-action"
                  disabled={running || cloudEligible.length === 0 || pauseDestructive}
                  onClick={() => void startCommunityQueue()}
                >
                  {t.startCommunityClean(cloudEligible.length)}
                </button>
              </div>
            ) : (
              <button
                className="secondary-action community-clean-action"
                disabled={running || cloudEligible.length === 0 || pauseDestructive}
                onClick={() => void startCommunityQueue()}
              >
                {t.startCommunityClean(cloudEligible.length)}
              </button>
            )}

            {communityEntries.length > 0 ? (
              <ul className="manage-list community-list" aria-label={t.communityClean}>
                {communityEntries.map((entry) => {
                  const excluded = !cloudEligibleSet.has(entry.handle.toLowerCase());
                  return (
                    <li key={entry.handle} className={`manage-item community-item${excluded ? ' is-excluded' : ''}`}>
                      <span className={`account-avatar${excluded ? ' is-muted' : ''}`} aria-hidden="true">
                        {entry.handle.slice(0, 1).toUpperCase()}
                      </span>
                      <div className="account-line">
                        <span className="account-handle">@{entry.handle}</span>
                        {entry.sources.includes('maintainer') ? (
                          <span className="maintainer-chip">{t.communitySourceMaintainer}</span>
                        ) : null}
                        {excluded ? <span className="maintainer-chip">{t.cloudProtected}</span> : null}
                      </div>
                      {excluded ? null : (
                        <span className="community-votes">
                          <strong>{entry.net_votes}</strong>
                          <em>{t.votesUnit}</em>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="community-empty">{t.communityEmpty}</p>
            )}
          </>
        ) : listView === 'blocked' ? (
          <>
            <form
              className="manual-block-form"
              onSubmit={(event) => {
                event.preventDefault();
                void runManualBlock();
              }}
            >
              <label htmlFor="manual-spam-handle" className="sr-only">
                {t.missedAccount}
              </label>
              <div className="manual-block-row">
                <input
                  id="manual-spam-handle"
                  type="text"
                  value={manualHandle}
                  placeholder={t.missedAccountHint}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => setManualHandle(event.target.value)}
                />
                <button
                  type="submit"
                  className="secondary-inline"
                  disabled={manualRunning || manualHandle.trim().length === 0 || pauseDestructive}
                >
                  {manualRunning ? t.processing : t.markSpamAndBlock}
                </button>
              </div>
            </form>
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
            <form
              className="manual-block-form allow-add-form"
              onSubmit={(event) => {
                event.preventDefault();
                void addToAllowlist();
              }}
            >
              <label htmlFor="allowlist-handle">{t.allowlistAddLabel}</label>
              <div className="manual-block-row">
                <input
                  id="allowlist-handle"
                  type="text"
                  value={allowHandle}
                  placeholder={t.allowlistPlaceholder}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => setAllowHandle(event.target.value)}
                />
                <button
                  type="submit"
                  className="secondary-inline"
                  disabled={allowAdding || allowHandle.trim().length === 0}
                >
                  {allowAdding ? t.processing : t.allowlistAdd}
                </button>
              </div>
            </form>
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
                      <span className="account-meta">{formatDate(item.addedAt, language)}</span>
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
