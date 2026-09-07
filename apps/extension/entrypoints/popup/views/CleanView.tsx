import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getDailyStats,
  subscribeDaily,
  todayKey,
  type DailyStats,
} from '../../../src/lib/daily-stats';
import { buildReportText, shareUrl } from '../../../src/lib/share-card';
import { estimateTimeSaved } from '../../../src/lib/time-saved';
import { drawReportCard } from '../../../src/lib/share-card-image';
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
  usedInWindow,
  type SafetyLedger,
} from '../../../src/lib/block-safety';
import { categoryLabel, UI_COPY, type UiLanguage } from '../../../src/lib/i18n';
import { AppIcon, FAILURE_LABELS, normalizeManualInput, type PageMarkedItem } from './shared';
import QueuePanel from './QueuePanel';

interface PageBlockResult {
  blocked: string[];
  failed: Array<{ handle: string; code: string }>;
}

interface ManualBlockResult {
  ok: boolean;
  handle?: string;
  code?: string;
}

interface SendMessageShape {
  type: string;
  handle?: string;
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

const BLOCK_MESSAGE = { type: 'feedsieve:run-page-block' } as const;

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
  const [daily, setDaily] = useState<DailyStats>({ days: {} });
  const [reportExpanded, setReportExpanded] = useState(false);
  const [cardUrl, setCardUrl] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [blockResult, setBlockResult] = useState<PageBlockResult | null>(null);
  const [manualHandle, setManualHandle] = useState('');
  const [manualRunning, setManualRunning] = useState(false);
  const [queue, setQueue] = useState<PersistentBlockQueueState | null>(null);
  /** 追踪上一个队列状态：page-batch 收尾时据此判断是否该刷新页面黄框。 */
  const pageBatchQueueRef = useRef<PersistentBlockQueueState | null>(null);
  // 安全额度条：滚动 24h 已用数（账本事件驱动更新，渲染期不调 Date.now）
  const [safety, setSafety] = useState<SafetyLedger | null>(null);
  const [safetyUsed, setSafetyUsed] = useState(0);

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
    void getDailyStats().then(setDaily);
    void getPersistentBlockQueue().then(setQueue);
    void loadSafetyLedger().then((ledger) => {
      setSafety(ledger);
      setSafetyUsed(usedInWindow(ledger, Date.now()));
    });
    const unsubs = [
      subscribeDaily(setDaily),
      subscribePersistentBlockQueue(handleQueueChange),
      subscribeSafetyLedger((ledger) => {
        setSafety(ledger);
        setSafetyUsed(usedInWindow(ledger, Date.now()));
      }),
    ];
    return () => unsubs.forEach((unsub) => unsub());
  }, [handleQueueChange]);

  async function runBatch(): Promise<void> {
    setRunning(true);
    notify(null);
    setBlockResult(null);
    try {
      const result = (await sendToXPage(BLOCK_MESSAGE)) as {
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
        notify(t.queueStarted(result.count ?? 0));
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
      })) as ManualBlockResult;
      if (result?.ok) {
        setManualHandle('');
        notify(t.manualBlocked(handle));
      } else {
        notify(`${t.failed}: ${result?.code ?? t.unknown}`);
      }
    } catch {
      notify(t.openXNotice);
    } finally {
      setManualRunning(false);
    }
  }

  async function controlQueue(action: 'resume' | 'pause' | 'cancel'): Promise<void> {
    try {
      await sendToXPage({ type: `feedsieve:block-queue-${action}` });
    } catch {
      notify(t.openXNotice);
    }
  }

  const pageCount = pageMarked?.length ?? null;
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

  // 日期键与写入侧（daily-stats.todayKey 的本地日期）同源；用 UTC 的 ISO 日期
  // 会让东八区用户在本地 0-8 点读到前一天的数。
  const today = daily.days[todayKey()] ?? {
    blocked: 0,
    detected: 0,
    unblocked: 0,
    byCategory: {},
  };
  const reportText = buildReportText(today, language);
  const shareHref = shareUrl(reportText);
  const timeSaved = estimateTimeSaved(today.detected, language);
  const categoryBars = Object.entries(today.byCategory)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([key, count]) => ({
      key,
      label: categoryLabel(key, language),
      count,
      pct: today.blocked > 0 ? Math.round((count / today.blocked) * 100) : 0,
    }));

  function makeCard(): void {
    try {
      const canvas = drawReportCard(today, language);
      setCardUrl(canvas.toDataURL('image/png'));
    } catch {
      setCardUrl(null);
    }
  }

  return (
    <div className="view-stack clean-view">
      {safety && safetyUsed > 0 ? (
        <div className="safety-quota-line" role="status">
          {t.safetyQuota(safetyUsed, safety.budget)}
        </div>
      ) : null}
      <section className={`review-card${pageCount === 0 ? ' is-clean' : ''}`}>
        <div className="section-heading">
          <h2>{t.pageMarked}</h2>
          <span className="count-badge" aria-label={`${t.pageMarked}: ${pageCount ?? 0}`}>
            {pageCount === null ? '…' : pageCount}
          </span>
        </div>

        {pageCount === null ? (
          <div className="loading-list" aria-hidden="true">
            <span />
            <span />
          </div>
        ) : pageCount === 0 ? (
          <div className="clean-state">
            <span className="clean-state-icon">
              <AppIcon name="clean" size={24} />
            </span>
            <p>{running ? t.processing : t.pageClean}</p>
          </div>
        ) : (
          <ul className="review-list">
            {pageMarked!.map((item) => (
              <li key={item.handle} className="review-item">
                <span className="account-avatar" aria-hidden="true">
                  {item.handle.slice(0, 1).toUpperCase()}
                </span>
                <div className="account-info">
                  <div className="account-line">
                    <span className="account-handle">@{item.handle}</span>
                    <span className="category-chip">
                      {categoryLabel(item.category, language)}
                    </span>
                  </div>
                  {item.reason ? <span className="account-reason">{item.reason}</span> : null}
                </div>
              </li>
            ))}
          </ul>
        )}

        {blockResult ? (
          <p className="result-message" role="status">
            {t.blockedResult(blockResult.blocked.length)}
            {failedSummary(blockResult) ? (
              <span className="result-failure">
                {' '}
                · {t.failedResult(blockResult.failed.length)} · {failedSummary(blockResult)}
              </span>
            ) : null}
          </p>
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

        <form
          className="manual-block-form"
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

        <div className="primary-actions">
          {pauseDestructive ? (
            <p className="controls-warning" role="status">
              {killSwitchActive ? t.killSwitchActive(killSwitchReason) : t.blockUnavailable}
            </p>
          ) : null}
          <button
            className="primary-action"
            disabled={!pageCount || running || queueActive || pauseDestructive}
            onClick={() => void runBatch()}
          >
            {running
              ? t.processing
              : pageCount
                ? `${t.blockPage} · ${pageCount}`
                : t.blockPage}
          </button>
          <button
            type="button"
            className="square-action"
            aria-label={t.refreshPage}
            title={t.refreshPage}
            disabled={running}
            onClick={() => void refreshPageMarked()}
          >
            <AppIcon name="refresh" />
          </button>
        </div>
      </section>

      <section className="summary-card" aria-labelledby="today-title">
        <div className="section-heading compact">
          <h2 id="today-title">{t.todaySummary}</h2>
          {today.detected > 0 ? (
            <button
              type="button"
              className="text-action"
              aria-expanded={reportExpanded}
              onClick={() => setReportExpanded((expanded) => !expanded)}
            >
              {reportExpanded ? t.hideDetails : t.showDetails}
            </button>
          ) : null}
        </div>
        <div className="metric-grid" aria-label={t.todaySummary}>
          <div>
            <strong>{today.detected}</strong>
            <span>{t.marked}</span>
          </div>
          <div>
            <strong>{today.blocked}</strong>
            <span>{t.blocked}</span>
          </div>
          <div>
            <strong>{today.unblocked}</strong>
            <span>{t.restored}</span>
          </div>
        </div>
        {today.detected > 0 ? (
          <p className="saved-time">
            {t.saved} <strong>{timeSaved.label}</strong>
          </p>
        ) : (
          <p className="summary-empty">{t.todayQuiet}</p>
        )}

        {reportExpanded ? (
          <div className="report-details">
            {categoryBars.length > 0 ? (
              <div className="report-bars">
                {categoryBars.map((bar) => (
                  <div key={bar.key} className="report-bar">
                    <span className="report-bar-label">{bar.label}</span>
                    <div className="report-bar-track" aria-hidden="true">
                      <div
                        className="report-bar-fill"
                        style={{ width: `${Math.max(bar.pct, 4)}%` }}
                      />
                    </div>
                    <span className="report-bar-count">{bar.count}</span>
                  </div>
                ))}
              </div>
            ) : null}
            {today.blocked > 0 ? (
              <div className="report-actions">
                <button type="button" className="secondary-inline" onClick={makeCard}>
                  {t.reportCard}
                </button>
                <a className="secondary-inline" href={shareHref} target="_blank" rel="noreferrer">
                  {t.share} ↗
                </a>
              </div>
            ) : null}
            {cardUrl ? (
              <div className="report-card-preview">
                <img src={cardUrl} alt={t.reportImageAlt} />
                <a className="text-action" href={cardUrl} download="feedsieve-report.png">
                  {t.downloadImage}
                </a>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
