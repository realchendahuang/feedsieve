import { useEffect, useMemo, useState } from 'react';
import type { CommunityEntry, WhitelistEntry } from '@feedsieve/community-lists';
import { getBlockedAccounts, subscribeBlocked, type BlockedAccount } from '../../../src/lib/community/blocked-accounts';
import {
  addAllowlist,
  getAllowlist,
  removeAllowed,
  subscribeAllowlist,
  type AllowlistItem,
} from '../../../src/lib/community/allowlist';
import {
  getFollowingAllowlist,
  getFollowingSyncState,
  subscribeFollowingAllowlist,
  subscribeFollowingSyncState,
  type FollowingAllowlistItem,
  type FollowingSyncState,
} from '../../../src/lib/community/following-allowlist';
import {
  blockQueueProgress,
  getPersistentBlockQueue,
  subscribePersistentBlockQueue,
  type PersistentBlockQueueState,
} from '../../../src/lib/queue/block-queue-store';
import {
  DEFAULT_PRESET,
  loadSafetyLedger,
  SAFETY_PRESETS,
  subscribeSafetyLedger,
  type SafetyLedger,
} from '../../../src/lib/queue/block-safety';
import { UI_COPY, type UiLanguage } from '../../../src/lib/platform/i18n';
import type { UnblockBatchResult } from '../../../src/lib/queue/run-unblock-batch';
import {
  allowlistReason,
  AppIcon,
  FAILURE_LABELS,
  OfficialLinkIcon,
  formatDate,
  HelpIcon,
  normalizeManualInput,
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
  /** 社区快照仍在拉取：还没落定前不给空态（避免闪现「没有需要处理的账号」） */
  communityEntriesLoading?: boolean;
  /** 推荐白名单（快照 whitelist 段下调）：只读展示，含维护者背书理由 note */
  recommendList: WhitelistEntry[];
}

export default function ListsView({
  language,
  notify,
  sendToXPage,
  refreshPageMarked,
  pauseDestructive,
  communityEntries,
  communityEntriesLoading = false,
  recommendList,
}: ListsViewProps) {
  const t = UI_COPY[language];
  const [listView, setListView] = useState<ListView>(initialListView);
  const [blocked, setBlocked] = useState<BlockedAccount[] | null>(null);
  /** 当前展开推文原文的拉黑记录（单选互斥，handle 为键） */
  const [expandedTweet, setExpandedTweet] = useState<string | null>(null);
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
  const [queue, setQueue] = useState<PersistentBlockQueueState | null>(null);
  // 安全额度条：滚动 24h 已用数（暂停原因文案用到预算上限）
  const [safety, setSafety] = useState<SafetyLedger | null>(null);
  // 社区名单排序：默认票数多→少，可切字母序
  const [sortMode, setSortMode] = useState<'votes' | 'alpha'>('votes');
  // 推荐白名单默认收起：只有一行标题，点开才铺账号列表
  const [showRecommended, setShowRecommended] = useState(false);

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

  // 撤销结果与清理页同款：瞬时提示 4s 自动消失，不常驻遮挡
  useEffect(() => {
    if (!unblockResult) return;
    const timer = window.setTimeout(() => setUnblockResult(null), 4_000);
    return () => window.clearTimeout(timer);
  }, [unblockResult]);

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
    try {
      await removeAllowed(handle);
      await browser.runtime.sendMessage({ type: 'feedsieve:labels-sync' }).catch(() => undefined);
    } catch {
      notify(t.openXNotice);
    }
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

  async function startCommunityQueue(): Promise<void> {
    if (communityEligible.length === 0) return;
    setRunning(true);
    notify(null);
    try {
      await sendToXPage({
        type: 'feedsieve:community-block-start',
        items: communityEligible.map((entry) => ({
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

  const { communityEligible, communityEligibleSet } = useMemo(() => {
    const protectedSet = new Set([
      ...(allowlist ?? []).map((item) => item.handle),
      ...(following ?? []).map((item) => item.handle),
      ...(blocked ?? []).map((item) => item.handle),
    ]);
    const eligible = communityEntries.filter(
      (entry) => !protectedSet.has(entry.handle.toLowerCase()),
    );
    return {
      communityEligible: eligible,
      communityEligibleSet: new Set(eligible.map((entry) => entry.handle.toLowerCase())),
    };
  }, [communityEntries, allowlist, following, blocked]);
  const sortedEntries = useMemo(() => {
    if (sortMode === 'alpha') {
      return [...communityEntries].sort((a, b) => a.handle.localeCompare(b.handle));
    }
    return [...communityEntries].sort(
      (a, b) => b.net_votes - a.net_votes || a.handle.localeCompare(b.handle),
    );
  }, [communityEntries, sortMode]);
  // 名单可达数千条；一次性 mount 全部节点在弹窗/侧栏里既卡渲染又占内存。
  // 先挂前 100 条，「加载剩余」逐段放出（与官网公示页分页同口径）。
  // 排序或名单变更后在 render 期直接重置回第一页（派生状态模式，不借 effect）。
  const [entryLimit, setEntryLimit] = useState(100);
  const visibleEntries = useMemo(
    () => sortedEntries.slice(0, entryLimit),
    [sortedEntries, entryLimit],
  );
  const [pageKey, setPageKey] = useState('');
  const pageKeyNow = `${sortMode}|${sortedEntries.length}`;
  if (pageKey !== pageKeyNow) {
    setPageKey(pageKeyNow);
    setEntryLimit(100);
  }
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
          <strong>{communityEligible.length}</strong>
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
            {/* 头部一行：一键清理在左，筛选在右；刷新收进设置页 */}
            <div className="list-head-actions">
              <button
                className="secondary-action community-clean-action"
                disabled={running || queueActive || communityEligible.length === 0 || pauseDestructive}
                onClick={() => void startCommunityQueue()}
              >
                {t.startCommunityClean(communityEligible.length)}
              </button>
              <div className="sort-toggle" role="group" aria-label={`${t.sortVotes}/${t.sortAlpha}`}>
                <button
                  type="button"
                  className={sortMode === 'votes' ? 'is-selected' : ''}
                  aria-pressed={sortMode === 'votes'}
                  onClick={() => setSortMode('votes')}
                >
                  {t.sortVotes}
                </button>
                <button
                  type="button"
                  className={sortMode === 'alpha' ? 'is-selected' : ''}
                  aria-pressed={sortMode === 'alpha'}
                  onClick={() => setSortMode('alpha')}
                >
                  {t.sortAlpha}
                </button>
              </div>
              <OfficialLinkIcon target="blacklist" label={t.siteBlacklist} />
            </div>

            {/* 动作区固定在首屏：这里是队列进度与失败转述 */}
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
              </div>
            ) : null}

            {communityEntries.length > 0 ? (
              <>
                <ul className="manage-list community-list" aria-label={t.communityClean}>
                  {visibleEntries.map((entry) => {
                  const excluded = !communityEligibleSet.has(entry.handle.toLowerCase());
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
              {sortedEntries.length > visibleEntries.length ? (
                <button
                  type="button"
                  className="show-more-entries"
                  onClick={() => setEntryLimit((limit) => limit + 100)}
                >
                  {t.showMoreEntries(sortedEntries.length - visibleEntries.length)}
                </button>
              ) : null}
            </>
          ) : communityEntriesLoading ? (
              <ul className="manage-list community-list" aria-hidden="true">
                <li className="manage-item community-item">
                  <span className="account-avatar is-muted" aria-hidden="true">…</span>
                </li>
                <li className="manage-item community-item">
                  <span className="account-avatar is-muted" aria-hidden="true">…</span>
                </li>
              </ul>
            ) : (
              <div className="empty-panel community-empty-state">
                <p className="community-empty">{t.communityEmpty}</p>
                <HelpIcon text={t.communityEmptyDetail} />
              </div>
            )}
          </>
        ) : listView === 'blocked' ? (
          <>
            {/* 头部结构与白名单统一：标题 → 输入行 → 分隔线 → 列表 */}
            <form
              className="manual-block-form allow-add-form"
              onSubmit={(event) => {
                event.preventDefault();
                void runManualBlock();
              }}
            >
              <label htmlFor="manual-spam-handle">{t.missedAccount}</label>
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
                    {account.tweetSnippet ? (
                      <button
                        type="button"
                        className="secondary-inline"
                        aria-expanded={expandedTweet === account.handle}
                        onClick={() => {
                          setExpandedTweet(expandedTweet === account.handle ? null : account.handle);
                        }}
                      >
                        {t.blockedTweet}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="secondary-inline"
                      disabled={running}
                      onClick={() => void runUnblock(account.handle)}
                    >
                      {t.undo}
                    </button>
                    {expandedTweet === account.handle && account.tweetSnippet ? (
                      <blockquote className="blocked-tweet-text">{account.tweetSnippet}</blockquote>
                    ) : null}
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
              <>
                <p className="result-message" role="status">
                  {t.restoredResult(unblockResult.unblocked.length)}
                  {unblockResult.failed.length > 0
                    ? ` · ${t.failedResult(unblockResult.failed.length)}`
                    : null}
                </p>
                {unblockResult.failed.length > 0 ? (
                  // 失败明细进滚动容器（与清理页同款），不无限换行
                  <ul className="queue-failed-list" role="status">
                    {unblockResult.failed.map((failure) => (
                      <li key={failure.handle}>
                        @{failure.handle}（
                        {FAILURE_LABELS[language][failure.code] ?? failure.code}）
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
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
                      <div className="account-line">
                        <span className="account-handle">@{item.handle}</span>
                        {item.displayName ? (
                          <span className="account-name" title={item.displayName}>
                            {item.displayName}
                          </span>
                        ) : null}
                      </div>
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

            {/* 推荐白名单：维护者在 GitHub 公开背书、随快照下发的一票豁免；只读，无本地操作 */}
            <div className="recommend-list-head">
              <button
                type="button"
                className="recommend-list-toggle"
                aria-expanded={showRecommended}
                onClick={() => setShowRecommended((value) => !value)}
              >
                <span className="account-meta">{t.recommendListTitle}</span>
                <em className="account-meta">{recommendList.length}</em>
              </button>
              <OfficialLinkIcon target="whitelist" label={t.siteWhitelist} />
            </div>
            {showRecommended ? (
              recommendList.length > 0 ? (
                <ul className="recommend-card-list">
                  {recommendList.map((entry, index) => (
                    <li
                      key={entry.handle}
                      className="recommend-card"
                      style={{ animationDelay: `${Math.min(index, 20) * 40}ms` }}
                    >
                      {entry.avatar_url ? (
                        <img
                          className="recommend-avatar"
                          src={entry.avatar_url}
                          alt=""
                          loading="lazy"
                          draggable={false}
                          onError={(event) => {
                            event.currentTarget.style.display = 'none';
                            const letter =
                              event.currentTarget.nextElementSibling as HTMLElement | null;
                            if (letter) letter.style.display = '';
                          }}
                        />
                      ) : null}
                      <span
                        className="recommend-avatar-fallback is-safe"
                        aria-hidden="true"
                        style={entry.avatar_url ? { display: 'none' } : undefined}
                      >
                        {(entry.name || entry.handle).slice(0, 1).toUpperCase()}
                      </span>
                      <div className="recommend-info">
                        <span className="recommend-name" title={entry.name ? `@${entry.handle}` : undefined}>
                          {entry.name || `@${entry.handle}`}
                        </span>
                        {entry.name ? <span className="recommend-handle">@{entry.handle}</span> : null}
                        <span className="recommend-note" title={entry.note}>
                          {entry.note}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="account-meta">{t.recommendListEmpty}</p>
              )
            ) : null}
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
