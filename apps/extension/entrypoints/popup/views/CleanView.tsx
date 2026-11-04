import { createTrainingSample } from '../../../src/lib/community/training-samples';
import { syncLocalLabels } from '../../../src/lib/community/contribute';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CommunityEntry } from '@feedsieve/community-lists';
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
  usedInWindow,
  type SafetyLedger,
} from '../../../src/lib/queue/block-safety';
import { addAllowlist } from '../../../src/lib/community/allowlist';
import { categoryLabel, UI_COPY, type UiLanguage } from '../../../src/lib/platform/i18n';
import {
  AppIcon,
  EmptyState,
  FAILURE_LABELS,
  HelpIcon,
  OfficialLinkIcon,
  SkeletonList,
  TipText,
  useArmedConfirm,
  type PageMarkedItem,
} from './shared';
import { useListPosition } from './use-list-position';
import QueuePanel from './QueuePanel';

interface PageBlockResult {
  blocked: string[];
  failed: Array<{ handle: string; code: string }>;
}

interface SendMessageShape {
  type: string;
  handle?: string;
  handles?: string[];
  force?: boolean;
  items?: Array<{ handle: string; xUserId?: string; category: string }>;
}

interface CleanViewProps {
  language: UiLanguage;
  notify: (message: string | null) => void;
  sendToXPage: (message: SendMessageShape) => Promise<unknown>;
  pageMarked: PageMarkedItem[] | null;
  refreshPageMarked: () => Promise<void>;
  pauseDestructive: boolean;
  killSwitchActive: boolean;
  killSwitchReason?: string;
  /** 社区黑名单里还没被拉黑、也不在白名单 / 关注里的账号，按净票数排好序 */
  communityEligible: CommunityEntry[];
  communityLoading: boolean;
  onOpenSettings: () => void;
}

function FailedList({
  items,
  language,
}: {
  items: Array<{ handle: string; code?: string }>;
  language: UiLanguage;
}) {
  const t = UI_COPY[language];
  if (items.length === 0) return null;
  // 失败明细进滚动容器，长失败串不把主操作顶出可视区
  return (
    <ul className="failed-list" role="status">
      {items.map((item) => (
        <li key={item.handle}>
          <span>@{item.handle}</span>
          <span>{FAILURE_LABELS[language][item.code ?? ''] ?? item.code ?? t.unknown}</span>
        </li>
      ))}
    </ul>
  );
}

export default function CleanView({
  language,
  notify,
  sendToXPage,
  pageMarked,
  refreshPageMarked,
  pauseDestructive,
  killSwitchActive,
  killSwitchReason,
  communityEligible,
  communityLoading,
  onOpenSettings,
}: CleanViewProps) {
  const t = UI_COPY[language];
  const [running, setRunning] = useState(false);
  /** 「全部拉黑」是唯一一次点击影响上百个账号的操作，要求二次确认。 */
  const { isArmed, arm, reset } = useArmedConfirm();
  const [blockResult, setBlockResult] = useState<PageBlockResult | null>(null);
  const [operatingHandles, setOperatingHandles] = useState<Set<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [queue, setQueue] = useState<PersistentBlockQueueState | null>(null);
  /**
   * 勾选只决定是否参与这次批量拉黑（行保留）；
   * 「移除」把整行移出本次清单（直到重新扫描出新的命中）。
   */
  const [deselectedHandles, setDeselectedHandles] = useState<Set<string>>(() => new Set());
  const [dismissedHandles, setDismissedHandles] = useState<Set<string>>(() => new Set());
  /** 上一个队列状态：page-batch 收尾时据此刷新页面黄框。 */
  const pageBatchQueueRef = useRef<PersistentBlockQueueState | null>(null);
  // 安全额度：滚动 24h 已用数（账本事件驱动更新，渲染期不调 Date.now）
  const [safety, setSafety] = useState<SafetyLedger | null>(null);
  const [safetyUsed, setSafetyUsed] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);

  /** 瞬时成功反馈 4 秒后自动消失，遵守 AGENTS 约定 */
  useEffect(() => {
    if (!blockResult) return;
    const timeout = window.setTimeout(() => setBlockResult(null), 4000);
    return () => window.clearTimeout(timeout);
  }, [blockResult]);

  /**
   * page-batch 批量拉黑收尾（completed/cancelled）时，页面黄框已被逐个移除，
   * 重新拉一次让主按钮随真实剩余禁用。
   */
  const handleQueueChange = useCallback(
    (next: PersistentBlockQueueState | null): void => {
      const prev = pageBatchQueueRef.current;
      pageBatchQueueRef.current = next;
      setQueue(next);
      if (
        next &&
        next.source === 'page-batch' &&
        (next.status === 'completed' || next.status === 'cancelled') &&
        prev &&
        prev.source === 'page-batch' &&
        (prev.status === 'running' || prev.status === 'paused')
      ) {
        void refreshPageMarked();
      }
    },
    [refreshPageMarked],
  );

  useEffect(() => {
    void getPersistentBlockQueue().then(setQueue);
    void loadSafetyLedger().then((ledger) => {
      setSafety(ledger);
      setSafetyUsed(usedInWindow(ledger, Date.now()));
    });
    const unsubs = [
      subscribePersistentBlockQueue(handleQueueChange),
      subscribeSafetyLedger((ledger) => {
        setSafety(ledger);
        setSafetyUsed(usedInWindow(ledger, Date.now()));
      }),
    ];
    return () => unsubs.forEach((unsub) => unsub());
  }, [handleQueueChange]);

  const pageCount = pageMarked?.length ?? null;

  const displayedItems = useMemo(
    () => (pageMarked ?? []).filter((item) => !dismissedHandles.has(item.handle)),
    [pageMarked, dismissedHandles],
  );
  const pendingItems = useMemo(
    () => displayedItems.filter((item) => !deselectedHandles.has(item.handle)),
    [displayedItems, deselectedHandles],
  );
  const pendingCount = pendingItems.length;

  // 切走再回来：回到上次看的位置
  useListPosition({
    storageKey: 'cleanPositionV1',
    pageKey: 'clean',
    rootRef,
    ready: displayedItems.length > 0,
  });

  function toggleSelect(handle: string): void {
    setDeselectedHandles((prev) => {
      const next = new Set(prev);
      if (next.has(handle)) next.delete(handle);
      else next.add(handle);
      return next;
    });
  }

  function forget(handle: string): void {
    setDismissedHandles((prev) => new Set(prev).add(handle));
    setDeselectedHandles((prev) => {
      const next = new Set(prev);
      next.delete(handle);
      return next;
    });
  }

  function toggleSelectAll(): void {
    if (displayedItems.length === 0) return;
    setDeselectedHandles(
      deselectedHandles.size > 0 ? new Set() : new Set(displayedItems.map((item) => item.handle)),
    );
  }

  async function handleRefresh(): Promise<void> {
    setRefreshing(true);
    try {
      await refreshPageMarked();
    } finally {
      setTimeout(() => setRefreshing(false), 500);
    }
  }

  async function runBatch(): Promise<void> {
    if (pendingCount === 0) return;
    setRunning(true);
    notify(null);
    setBlockResult(null);
    try {
      const result = (await sendToXPage({
        type: 'feedsieve:run-page-block',
        handles: pendingItems.map((item) => item.handle),
      })) as { status?: string; count?: number; error?: string };
      if (result?.status === 'error' && result.error === 'kill_switch') {
        notify(t.killSwitchActive(killSwitchReason));
      } else if (result?.status === 'started') {
        setQueue(await getPersistentBlockQueue());
        // 全部被过滤（已拉黑/白名单/关注）时立即刷新，主按钮即刻回到禁用态
        if ((result.count ?? 0) === 0) await refreshPageMarked();
      } else if (Array.isArray((result as unknown as PageBlockResult)?.blocked)) {
        const done = result as unknown as PageBlockResult;
        setBlockResult(done);
        // 和「误标」「词库」等操作一致：结果走弹窗顶层的瞬时吐司，列表底部不再留一行常驻文字
        notify(
          done.failed.length > 0
            ? `${t.blockedResult(done.blocked.length)} · ${t.failedResult(done.failed.length)}`
            : t.blockedResult(done.blocked.length),
        );
        await refreshPageMarked();
      } else {
        throw new Error('page_queue_not_started');
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

  async function markFalsePositive(item: PageMarkedItem): Promise<void> {
    setOperatingHandles((prev) => new Set(prev).add(item.handle));
    notify(null);
    try {
      const sample = createTrainingSample(
        item.handle,
        'false-positive',
        item.evidence ?? { tweetText: item.snippet, displayName: item.displayName },
      );
      await addAllowlist(
        item.handle,
        undefined,
        {
          detectionSource: item.evidence?.detectionSource ?? 'heuristic',
          ruleId: item.evidence?.ruleId,
          detectionReason: item.reason,
        },
        item.displayName,
        sample,
      );
      void syncLocalLabels();
      notify(t.allowlistAdded(item.handle));
      // 本地立即移除，不等 content script 广播回来的刷新
      forget(item.handle);
      await refreshPageMarked();
    } catch {
      notify(t.openXNotice);
    } finally {
      setOperatingHandles((prev) => {
        const next = new Set(prev);
        next.delete(item.handle);
        return next;
      });
    }
  }

  async function controlQueue(action: 'resume' | 'pause' | 'cancel'): Promise<void> {
    try {
      await sendToXPage({ type: `feedsieve:block-queue-${action}` });
    } catch {
      notify(t.openXNotice);
    }
  }

  const queueSummary = blockQueueProgress(queue);
  const queueDone = queueSummary.success + queueSummary.failed;
  const queueActive = Boolean(
    queue && queueSummary.total > 0 && (queue.status === 'running' || queue.status === 'paused'),
  );
  // 队列收尾后的失败项留在触发它的区块里，原因如实展示，避免无声的死循环
  const failedTasks = (source: PersistentBlockQueueState['source']) =>
    queue && queue.source === source && !queueActive
      ? queue.tasks
          .filter((task) => task.status === 'failed')
          .map((task) => ({ handle: task.handle, code: task.failureCode }))
      : [];
  const queueStatusLabel = queue
    ? {
        running: t.queueRunning,
        paused: t.queuePaused,
        completed: t.queueCompleted,
        cancelled: t.queueCancelled,
      }[queue.status]
    : '';
  // 只有额度用尽 / 短窗限流两种暂停需要解释
  const queuePauseNote =
    queue?.status === 'paused' && queue.pauseReason === 'quota_exhausted'
      ? t.queuePausedQuota(safety?.budget ?? SAFETY_PRESETS[DEFAULT_PRESET].dailyLimit)
      : queue?.status === 'paused' && queue.pauseReason === 'rate_limit_storm'
        ? t.queuePausedRateLimit
        : null;
  const queuePanel = (source: PersistentBlockQueueState['source']) =>
    queueActive && queue!.source === source ? (
      <QueuePanel
        language={language}
        queue={queue!}
        done={queueDone}
        total={queueSummary.total}
        statusLabel={queueStatusLabel}
        pauseNote={queuePauseNote}
        onControl={(action) => void controlQueue(action)}
      />
    ) : null;

  const busy = running || queueActive || pauseDestructive;

  return (
    <div className="view clean-view" ref={rootRef}>
      {pauseDestructive ? (
        <p className="alert" role="status">
          {killSwitchActive ? t.killSwitchActive(killSwitchReason) : t.blockUnavailable}
        </p>
      ) : null}

      <section className="block" aria-label={t.pageMarked}>
        <div className="block-head">
          <h2>{t.pageMarked}</h2>
          {pageCount ? <span className="count">{pageCount}</span> : null}
          <HelpIcon text={t.manualBlockHint} />
          {safety && safetyUsed > 0 ? (
            <span className="quota" role="status">
              {t.safetyQuota(safetyUsed, safety.budget)}
            </span>
          ) : null}
          <button
            type="button"
            className={`icon-button toolbar-end${refreshing ? ' is-spinning' : ''}`}
            aria-label={t.refreshPage}
            title={t.refreshPage}
            disabled={running || refreshing}
            onClick={() => void handleRefresh()}
          >
            <AppIcon name="refresh" size={15} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={t.filterSettings}
            title={t.filterSettings}
            onClick={onOpenSettings}
          >
            <AppIcon name="settings" size={15} />
          </button>
        </div>

        {pageCount === null ? (
          <SkeletonList />
        ) : displayedItems.length === 0 ? (
          <EmptyState icon="clean" className="is-clean" hint={t.pageCleanHint}>
            {pageCount === 0 ? t.pageClean : t.allDismissed}
          </EmptyState>
        ) : (
          <>
            <ul className="marked-list" aria-label={t.pageMarked}>
              {displayedItems.map((item) => {
                const isOperating = operatingHandles.has(item.handle);
                const isDeselected = deselectedHandles.has(item.handle);
                const category = categoryLabel(item.category, language);
                // 理由里常带着和类别标签重复的一段（「6 人标记 · 色情引流」），去掉重复的那段
                const reason = item.reason
                  .split(' · ')
                  .filter((part) => part.trim() !== category)
                  .join(' · ');
                return (
                  <li key={item.handle} className={isDeselected ? 'is-deselected' : ''}>
                    <label className="check" title={t.selectForBlock}>
                      <input
                        type="checkbox"
                        checked={!isDeselected}
                        onChange={() => toggleSelect(item.handle)}
                        aria-label={`${t.selectForBlock}: @${item.handle}`}
                      />
                      <span aria-hidden="true">
                        {!isDeselected ? <AppIcon name="check" size={12} /> : null}
                      </span>
                    </label>
                    <div className="marked-body">
                      <div className="marked-line">
                        <span className="marked-handle">@{item.handle}</span>
                        {item.displayName ? (
                          <span className="marked-name">{item.displayName}</span>
                        ) : null}
                        <div className="row-actions">
                          <button
                            type="button"
                            className="text-button"
                            title={t.falsePositiveHint}
                            aria-label={`${t.falsePositive}: @${item.handle}`}
                            disabled={isOperating || running}
                            onClick={() => void markFalsePositive(item)}
                          >
                            {isOperating ? '…' : t.falsePositive}
                          </button>
                          <button
                            type="button"
                            className="icon-button"
                            title={t.excludeItemHint}
                            aria-label={`${t.excludeItem}: @${item.handle}`}
                            onClick={() => forget(item.handle)}
                          >
                            <AppIcon name="x" size={14} />
                          </button>
                        </div>
                      </div>
                      <div className="marked-reason">
                        <span className="category-tag" data-category={item.category}>
                          {category}
                        </span>
                        {reason ? (
                          <TipText className="reason-text" text={item.reason}>
                            {reason}
                          </TipText>
                        ) : null}
                      </div>
                      <p className="marked-snippet">{item.snippet || t.noPostContent}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="action-bar">
              <button type="button" className="text-button" onClick={toggleSelectAll}>
                {deselectedHandles.size > 0 ? t.selectAll : t.deselectAll}
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={pendingCount === 0 || busy}
                onClick={() => void runBatch()}
              >
                {running ? t.processing : t.blockCount(pendingCount)}
              </button>
            </div>
          </>
        )}

        <FailedList items={blockResult?.failed ?? failedTasks('page-batch')} language={language} />
        {queuePanel('page-batch')}
      </section>

      <section className="block" aria-label={t.communityBlocklist}>
        <div className="row community-row">
          <div className="row-label">
            <strong>{t.communityBlocklist}</strong>
            <span className="row-meta">
              {communityLoading ? '…' : t.communityRemaining(communityEligible.length)}
            </span>
          </div>
          <OfficialLinkIcon target="blacklist" label={t.siteBlacklist} />
          <button
            type="button"
            className="secondary-button"
            disabled={busy || communityLoading || communityEligible.length === 0}
            onClick={() => {
              if (!arm('community')) return;
              reset();
              void startCommunityQueue();
            }}
          >
            {isArmed('community') ? t.confirmBlockAll(communityEligible.length) : t.blockAll}
          </button>
        </div>
        {queuePanel('community-batch')}
        {failedTasks('community-batch').length > 0 ? (
          <>
            <p className="result">
              {t.queueProgress(queueDone, queueSummary.total)} · {queueStatusLabel}
            </p>
            <FailedList items={failedTasks('community-batch')} language={language} />
          </>
        ) : null}
      </section>
    </div>
  );
}
