import type { PersistentBlockQueueState } from '../../../src/lib/queue/block-queue-store';
import { UI_COPY, type UiLanguage } from '../../../src/lib/platform/i18n';

interface QueuePanelProps {
  language: UiLanguage;
  queue: PersistentBlockQueueState;
  done: number;
  total: number;
  statusLabel: string;
  pauseNote: string | null;
  onControl: (action: 'resume' | 'pause' | 'cancel') => void;
}

/**
 * 批量拉黑进行中/已暂停的进度。页面批与社区批共用同一队列，
 * 各自显示在清理页里触发它的那一块下面。
 */
export default function QueuePanel({
  language,
  queue,
  done,
  total,
  statusLabel,
  pauseNote,
  onControl,
}: QueuePanelProps) {
  const t = UI_COPY[language];
  return (
    <div className="queue-panel">
      <div className="queue-line">
        <span>{t.queueProgress(done, total)}</span>
        <strong>{statusLabel}</strong>
        <span className="toolbar-end">
          {queue.status === 'running' ? (
            <button type="button" className="text-button" onClick={() => onControl('pause')}>
              {t.pause}
            </button>
          ) : (
            <button type="button" className="text-button" onClick={() => onControl('resume')}>
              {queue.pauseReason === 'quota_exhausted' ? t.resumeAnyway : t.resume}
            </button>
          )}
          <button type="button" className="text-button" onClick={() => onControl('cancel')}>
            {t.cancel}
          </button>
        </span>
      </div>
      <div className="queue-track" aria-hidden="true">
        <div
          className="queue-fill"
          style={{ width: `${Math.round((done / Math.max(total, 1)) * 100)}%` }}
        />
      </div>
      {pauseNote ? (
        <p className="queue-note" role="status">
          {pauseNote}
        </p>
      ) : null}
    </div>
  );
}
