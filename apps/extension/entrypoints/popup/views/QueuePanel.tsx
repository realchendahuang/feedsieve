import type { PersistentBlockQueueState } from '../../../src/lib/block-queue-store';
import { UI_COPY, type UiLanguage } from '../../../src/lib/i18n';

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
 * 批量拉黑进行中/已暂停的进度面板。页面批（清理页）与社区批（名单页）
 * 共用同一队列，各自在触发它的页面展示。
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
        <span>
          {queue.source === 'page-batch' ? t.pageMarked : t.communityClean} ·{' '}
          {t.queueProgress(done, total)}
        </span>
        <strong>{statusLabel}</strong>
      </div>
      <div className="queue-track" aria-hidden="true">
        <div
          className="queue-fill"
          style={{ width: `${Math.round((done / Math.max(total, 1)) * 100)}%` }}
        />
      </div>
      {queue.status === 'running' ? (
        <div className="queue-actions">
          <button className="secondary-inline" onClick={() => onControl('pause')}>
            {t.pause}
          </button>
          <button className="text-action" onClick={() => onControl('cancel')}>
            {t.cancel}
          </button>
        </div>
      ) : queue.status === 'paused' ? (
        <div className="queue-actions">
          <button className="secondary-inline" onClick={() => onControl('resume')}>
            {t.resume}
          </button>
          <button className="text-action" onClick={() => onControl('cancel')}>
            {t.cancel}
          </button>
        </div>
      ) : null}
      {pauseNote ? (
        <p className="queue-pause-note" role="status">
          {pauseNote}
        </p>
      ) : null}
    </div>
  );
}
