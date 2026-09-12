import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { AppIcon, FAILURE_LABELS, HelpIcon, type PageMarkedItem } from './shared';
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
}: CleanViewProps) {
  const t = UI_COPY[language];
  const [running, setRunning] = useState(false);
  const [blockResult, setBlockResult] = useState<PageBlockResult | null>(null);
  const [operatingHandles, setOperatingHandles] = useState<Set<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [queue, setQueue] = useState<PersistentBlockQueueState | null>(null);
  const [excludedHandles, setExcludedHandles] = useState<Set<string>>(() => new Set());
  /** 追踪上一个队列状态：page-batch 收尾时据此判断是否该刷新页面黄框。 */
  const pageBatchQueueRef = useRef<PersistentBlockQueueState | null>(null);
  // 安全额度条：滚动 24h 已用数（账本事件驱动更新，渲染期不调 Date.now）
  const [safety, setSafety] = useState<SafetyLedger | null>(null);
  const [safetyUsed, setSafetyUsed] = useState(0);

  /** 瞬时成功反馈 4 秒后自动消失，遵守 AGENTS 约定 */
  useEffect(() => {
    if (!blockResult) return;
    const timeout = window.setTimeout(() => setBlockResult(null), 4000);
    return () => window.clearTimeout(timeout);
  }, [blockResult]);


  /**
   * 队列状态回调：page-batch 批量拉黑收尾（completed/cancelled）时，
   * 页面黄框已被逐个移除，重新拉一次让「一键拉黑」按钮随真实剩余禁用，
   * 而不是停留在这个会话开始时的旧计数。
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

  const pendingItems = useMemo(() => {
    if (!pageMarked) return [];
    return pageMarked.filter((item) => !excludedHandles.has(item.handle));
  }, [pageMarked, excludedHandles]);

  const pendingCount = pendingItems.length;
  const excludedCount = (pageMarked?.length ?? 0) - pendingCount;

  function toggleExclude(handle: string): void {
    setExcludedHandles((prev) => {
      const next = new Set(prev);
      if (next.has(handle)) {
        next.delete(handle);
      } else {
        next.add(handle);
      }
      return next;
    });
  }

  function toggleSelectAll(): void {
    if (!pageMarked || pageMarked.length === 0) return;
    if (excludedHandles.size > 0) {
      setExcludedHandles(new Set());
    } else {
      setExcludedHandles(new Set(pageMarked.map((item) => item.handle)));
    }
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
      const handles = pendingItems.map((item) => item.handle);
      const result = (await sendToXPage({
        type: 'feedsieve:run-page-block',
        handles,
      })) as {
        status?: string;
        id?: string;
        count?: number;
        error?: string;
      };
      if (result?.status === 'error' && result.error === 'kill_switch') {
        notify(t.killSwitchActive(killSwitchReason));
      } else if (result?.status === 'started') {
        setBlockResult(null);
        setQueue(await getPersistentBlockQueue());
        // 队列启动的即时反馈由下方的进度面板承担，不做额外瞬时提示
        // 全部被过滤（已拉黑/白名单/关注，无实际可拉黑对象）时立即刷新，
        // 「一键拉黑」按钮即刻回到禁用态，而不是停留在这个会话的旧计数。
        if ((result.count ?? 0) === 0) {
          await refreshPageMarked();
        }
      } else if (Array.isArray((result as PageBlockResult)?.blocked)) {
        setBlockResult(result as PageBlockResult);
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

  async function markFalsePositive(item: PageMarkedItem): Promise<void> {
    setOperatingHandles((prev) => new Set(prev).add(item.handle));
    notify(null);
    try {
      await addAllowlist(item.handle, undefined, {
        detectionSource: 'page-marked',
        detectionReason: item.reason,
      }, item.displayName);
      notify(t.allowlistAdded(item.handle));
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
  const queueActive =
    queue &&
    queueSummary.total > 0 &&
    (queue.status === 'running' || queue.status === 'paused');
  // 页面批量收尾后的失败项：失败账号仍留在黄框清单里，原因如实展示在
  // 「当前页面」卡片（账号已消失 vs 可重试的解析失败），避免无声的死循环。
  const pageQueueFailedTasks =
    queue && queue.source === 'page-batch' && !queueActive
      ? queue.tasks.filter((task) => task.status === 'failed')
      : [];  const queueStatusLabel = queue
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
    <div className="view-stack clean-view">
      <section className={`review-card${pageCount === 0 ? ' is-clean' : ''}`}>
        <div className="section-heading">
          <div className="heading-title-group">
            <h2>{t.pageMarked}</h2>
            <span className="count-badge" aria-label={`${t.pageMarked}: ${pageCount ?? 0}`}>
              {pageCount === null ? '…' : pageCount}
            </span>
          </div>

          <div className="heading-toolbar">
            {safety && safetyUsed > 0 ? (
              <span
                className="safety-quota-chip"
                role="status"
                title={t.safetyQuota(safetyUsed, safety.budget)}
              >
                <span className="quota-dot" aria-hidden="true" />
                <span>{t.safetyQuota(safetyUsed, safety.budget)}</span>
              </span>
            ) : null}
            <HelpIcon text={t.manualBlockHint} />
          </div>
        </div>

        {pageCount === null ? (
          <div className="loading-list" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        ) : pageCount === 0 ? (
          <div className="clean-state">
            {/* 两态大图标：页面清爽 = 绿盾勾；有黄框后点它重新扫一遍清单 */}
            <button
              type="button"
              className={`clean-state-icon${refreshing ? ' is-spinning' : ''}`}
              aria-label={t.refreshPage}
              title={t.refreshPage}
              disabled={refreshing}
              onClick={() => void handleRefresh()}
            >
              <AppIcon name="clean" size={24} />
            </button>
            <p>{running ? t.processing : t.pageClean}</p>
            {!running ? <HelpIcon text={t.pageCleanHint} /> : null}
          </div>
        ) : (
          <>
            <div className="selection-toolbar">
              <span className="selection-summary">
                {t.selectedCount(pendingCount, pageCount)}
              </span>
              <button
                type="button"
                className="toolbar-text-btn"
                onClick={toggleSelectAll}
              >
                {excludedHandles.size > 0 ? t.selectAll : t.deselectAll}
              </button>
            </div>

            <ul className="review-list" aria-label={t.pageMarked}>
              {pageMarked!.map((item) => {
                const isOperating = operatingHandles.has(item.handle);
                const isExcluded = excludedHandles.has(item.handle);
                return (
                  <li
                    key={item.handle}
                    className={`review-item${isExcluded ? ' is-excluded' : ''}`}
                  >
                    <div className="review-item-header">
                      <div className="review-meta-group">
                        <label
                          className="checkbox-control"
                          title={isExcluded ? t.restoreItem : t.excludeItemHint}
                        >
                          <input
                            type="checkbox"
                            checked={!isExcluded}
                            onChange={() => toggleExclude(item.handle)}
                            aria-label={`${t.excludeItem}: @${item.handle}`}
                          />
                          <span className="checkbox-box" aria-hidden="true">
                            {!isExcluded ? <AppIcon name="check" size={13} /> : null}
                          </span>
                        </label>

                        <span className="category-chip" data-category={item.category}>
                          {categoryLabel(item.category, language)}
                        </span>

                        {item.reason ? (
                          <span className="account-reason" title={item.reason}>
                            {item.reason}
                          </span>
                        ) : null}

                        <span className="account-handle" title={`@${item.handle}`}>
                          @{item.handle}
                        </span>

                        {item.displayName ? (
                          <span className="account-name" title={item.displayName}>
                            {item.displayName}
                          </span>
                        ) : null}

                        {isExcluded ? (
                          <span className="excluded-pill">{t.excludedBadge}</span>
                        ) : null}
                      </div>

                      <div className="review-item-actions">
                        <button
                          type="button"
                          className={`item-btn ${isExcluded ? 'item-btn-restore' : 'item-btn-exclude'}`}
                          title={isExcluded ? t.restoreItem : t.excludeItemHint}
                          onClick={() => toggleExclude(item.handle)}
                        >
                          {isExcluded ? t.restoreItem : t.excludeItem}
                        </button>
                        <button
                          type="button"
                          className="item-btn item-btn-safe"
                          title={t.falsePositiveHint}
                          aria-label={`${t.falsePositive}: @${item.handle}`}
                          disabled={isOperating || running}
                          onClick={() => void markFalsePositive(item)}
                        >
                          {isOperating ? '…' : t.falsePositive}
                        </button>
                      </div>
                    </div>

                    {/* 帖子正文：信息架构的核心第一视觉重心 */}
                    <div className="review-snippet">
                      <p className="snippet-text">
                        {item.snippet || t.noPostContent}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {blockResult ? (
          <>
            <p className="result-message" role="status">
              {t.blockedResult(blockResult.blocked.length)}
              {blockResult.failed.length > 0
                ? ` · ${t.failedResult(blockResult.failed.length)}`
                : null}
            </p>
            {blockResult.failed.length > 0 ? (
              // 失败明细进滚动容器，长失败串不把底部主操作顶出可视区
              <ul className="queue-failed-list" role="status">
                {blockResult.failed.map((failure) => (
                  <li key={failure.handle}>
                    @{failure.handle}（
                    {FAILURE_LABELS[language][failure.code] ?? failure.code}）
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}

        {pageQueueFailedTasks.length > 0 ? (
          <ul className="queue-failed-list" role="status">
            {pageQueueFailedTasks.map((task) => (
              <li key={task.handle}>
                @{task.handle}（
                {FAILURE_LABELS[language][task.failureCode ?? ''] ??
                  task.failureCode ??
                  t.unknown}
                ）
              </li>
            ))}
          </ul>
        ) : null}

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
        ) : null}

        <div className="clean-bottom-bar">
          {pauseDestructive ? (
            <p className="controls-warning" role="status">
              {killSwitchActive ? t.killSwitchActive(killSwitchReason) : t.blockUnavailable}
            </p>
          ) : null}
          <div className="primary-actions">
            <button
              className="primary-action"
              disabled={!pageCount || pendingCount === 0 || running || queueActive || pauseDestructive}
              onClick={() => void runBatch()}
            >
              {running
                ? t.processing
                : !pageCount || pendingCount === 0
                  ? t.blockPage
                  : excludedCount > 0
                    ? t.batchBlockSelected(pendingCount)
                    : `${t.blockPage} · ${pageCount}`}
            </button>
            {/* 右下角刷新：列表在手时重新拉取当前页面黄框清单 */}
            <button
              type="button"
              className={`square-action${refreshing ? ' is-spinning' : ''}`}
              aria-label={t.refreshPage}
              title={t.refreshPage}
              disabled={running || refreshing}
              onClick={() => void handleRefresh()}
            >
              <AppIcon name="refresh" />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
