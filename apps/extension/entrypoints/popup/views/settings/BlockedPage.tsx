import { useEffect, useState } from 'react';
import {
  getBlockedAccounts,
  subscribeBlocked,
  type BlockedAccount,
} from '../../../../src/lib/community/blocked-accounts';
import { UI_COPY, type UiLanguage } from '../../../../src/lib/platform/i18n';
import {
  MANUAL_REPORT_REASONS,
  manualReasonLabel,
  type ManualReportReason,
} from '../../../../src/lib/community/manual-reasons';
import type { UnblockBatchResult } from '../../../../src/lib/queue/run-unblock-batch';
import {
  EmptyState,
  FAILURE_LABELS,
  formatDate,
  normalizeManualInput,
  SkeletonList,
} from '../shared';
import type { SubpageSendToXPage } from './types';

interface BlockedPageProps {
  language: UiLanguage;
  notify: (message: string | null) => void;
  sendToXPage: SubpageSendToXPage;
  refreshPageMarked: () => Promise<void>;
  pauseDestructive: boolean;
}

/** 拉黑记录：手动拉黑漏网账号、逐个或全部撤销。 */
export default function BlockedPage({
  language,
  notify,
  sendToXPage,
  refreshPageMarked,
  pauseDestructive,
}: BlockedPageProps) {
  const t = UI_COPY[language];
  const [blocked, setBlocked] = useState<BlockedAccount[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [handleInput, setHandleInput] = useState('');
  // '' = 未选；'personal' = 仅拉黑不参与社区；其余是票面分类
  const [manualReason, setManualReason] = useState<ManualReportReason | 'personal' | ''>('');
  const [manualRunning, setManualRunning] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<UnblockBatchResult | null>(null);

  useEffect(() => {
    void getBlockedAccounts().then(setBlocked);
    return subscribeBlocked(setBlocked);
  }, []);

  // 撤销结果是瞬时提示：4 秒自动消失
  useEffect(() => {
    if (!result) return;
    const timer = window.setTimeout(() => setResult(null), 4_000);
    return () => window.clearTimeout(timer);
  }, [result]);

  async function runManualBlock(): Promise<void> {
    const handle = normalizeManualInput(handleInput);
    if (!handle) {
      notify(t.invalidHandle);
      return;
    }
    if (!manualReason) {
      notify(t.manualReasonPlaceholder);
      return;
    }
    setManualRunning(true);
    notify(null);
    try {
      const response = (await sendToXPage({
        type: 'feedsieve:manual-spam-block',
        handle,
        reason: manualReason === 'personal' ? null : manualReason,
      })) as {
        ok?: boolean;
        code?: string;
      };
      if (response?.ok) {
        setHandleInput('');
        setManualReason('');
        notify(t.manualBlocked(handle));
        setBlocked(await getBlockedAccounts());
        await refreshPageMarked();
      } else {
        notify(`${t.failed}: ${response?.code ?? t.unknown}`);
      }
    } catch {
      notify(t.openXNotice);
    } finally {
      setManualRunning(false);
    }
  }

  async function runUnblock(handle?: string): Promise<void> {
    setRunning(true);
    notify(null);
    try {
      const response = (await sendToXPage({
        type: 'feedsieve:unblock',
        ...(handle ? { handle } : {}),
      })) as UnblockBatchResult;
      setResult(response);
      await refreshPageMarked();
    } catch {
      notify(t.openXNotice);
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <form
        className="inline-form manual-block-form"
        onSubmit={(event) => {
          event.preventDefault();
          void runManualBlock();
        }}
      >
        <input
          id="manual-spam-handle"
          type="text"
          value={handleInput}
          placeholder={t.missedAccountHint}
          aria-label={t.missedAccount}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setHandleInput(event.target.value)}
        />
        <select
          className="manual-reason-select"
          value={manualReason}
          aria-label={t.manualReason}
          onChange={(event) =>
            setManualReason(event.target.value as ManualReportReason | 'personal' | '')
          }
        >
          <option value="" disabled>
            {t.manualReasonPlaceholder}
          </option>
          {MANUAL_REPORT_REASONS.map((reason) => (
            <option key={reason} value={reason}>
              {manualReasonLabel(reason, language)}
            </option>
          ))}
          <option value="personal">{t.manualOnly}</option>
        </select>
        <button
          type="submit"
          className="secondary-button"
          disabled={
            manualRunning ||
            handleInput.trim().length === 0 ||
            manualReason === '' ||
            pauseDestructive
          }
        >
          {manualRunning ? t.processing : t.markSpamAndBlock}
        </button>
      </form>

      {result ? (
        <p className="result" role="status">
          {t.restoredResult(result.unblocked.length)}
          {result.failed.length > 0 ? ` · ${t.failedResult(result.failed.length)}` : null}
        </p>
      ) : null}
      {result && result.failed.length > 0 ? (
        <ul className="failed-list" role="status">
          {result.failed.map((failure) => (
            <li key={failure.handle}>
              <span>@{failure.handle}</span>
              <span>{FAILURE_LABELS[language][failure.code] ?? failure.code}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {blocked === null ? (
        <SkeletonList />
      ) : blocked.length === 0 ? (
        <EmptyState>{t.noBlocked}</EmptyState>
      ) : (
        <>
          <ul className="account-list">
            {blocked.map((account) => (
              <li key={account.handle}>
                <div className="account-main">
                  <span className="account-handle">@{account.handle}</span>
                  <span className="account-meta">{formatDate(account.blockedAt, language)}</span>
                </div>
                {account.tweetSnippet ? (
                  <button
                    type="button"
                    className="text-button"
                    aria-expanded={expanded === account.handle}
                    onClick={() => setExpanded(expanded === account.handle ? null : account.handle)}
                  >
                    {t.blockedTweet}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="text-button"
                  disabled={running}
                  onClick={() => void runUnblock(account.handle)}
                >
                  {t.undo}
                </button>
                {expanded === account.handle && account.tweetSnippet ? (
                  <blockquote className="account-quote">{account.tweetSnippet}</blockquote>
                ) : null}
              </li>
            ))}
          </ul>
          <div className="action-bar">
            <button
              type="button"
              className="secondary-button"
              disabled={running}
              onClick={() => void runUnblock()}
            >
              {t.undoAll}
            </button>
          </div>
        </>
      )}
    </>
  );
}
