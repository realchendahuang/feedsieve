import { useEffect, useState } from 'react';
import type { WhitelistEntry } from '@feedsieve/community-lists';
import {
  addAllowlist,
  getAllowlist,
  removeAllowed,
  subscribeAllowlist,
  type AllowlistItem,
} from '../../../../src/lib/community/allowlist';
import { UI_COPY, type UiLanguage } from '../../../../src/lib/platform/i18n';
import {
  allowlistReason,
  AppIcon,
  EmptyState,
  formatDate,
  normalizeManualInput,
  OfficialLinkIcon,
  SkeletonList,
} from '../shared';

interface AllowlistPageProps {
  language: UiLanguage;
  notify: (message: string | null) => void;
  /** 推荐白名单（快照 whitelist 段）：只读，含维护者背书理由 */
  recommendList: WhitelistEntry[];
}

/** 白名单：手动添加、移出；底部折叠展示维护者推荐的白名单。 */
export default function AllowlistPage({ language, notify, recommendList }: AllowlistPageProps) {
  const t = UI_COPY[language];
  const [allowlist, setAllowlist] = useState<AllowlistItem[] | null>(null);
  const [handleInput, setHandleInput] = useState('');
  const [adding, setAdding] = useState(false);
  const [showRecommended, setShowRecommended] = useState(false);

  useEffect(() => {
    void getAllowlist().then(setAllowlist);
    return subscribeAllowlist(setAllowlist);
  }, []);

  async function add(): Promise<void> {
    const handle = normalizeManualInput(handleInput);
    if (!handle) {
      notify(t.invalidHandle);
      return;
    }
    setAdding(true);
    notify(null);
    try {
      await addAllowlist(handle);
      setHandleInput('');
      notify(t.allowlistAdded(handle));
      await browser.runtime.sendMessage({ type: 'feedsieve:labels-sync' }).catch(() => undefined);
    } finally {
      setAdding(false);
    }
  }

  async function remove(handle: string): Promise<void> {
    try {
      await removeAllowed(handle);
      await browser.runtime.sendMessage({ type: 'feedsieve:labels-sync' }).catch(() => undefined);
    } catch {
      notify(t.openXNotice);
    }
  }

  return (
    <>
      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <input
          id="allowlist-handle"
          type="text"
          value={handleInput}
          placeholder={t.allowlistPlaceholder}
          aria-label={t.allowlistAddLabel}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setHandleInput(event.target.value)}
        />
        <button
          type="submit"
          className="secondary-button"
          disabled={adding || handleInput.trim().length === 0}
        >
          {adding ? t.processing : t.allowlistAdd}
        </button>
      </form>

      {allowlist === null ? (
        <SkeletonList />
      ) : allowlist.length === 0 ? (
        <EmptyState>{t.allowlistEmpty}</EmptyState>
      ) : (
        <ul className="account-list">
          {allowlist.map((item) => {
            const reason = allowlistReason(item, language);
            return (
              <li key={item.handle}>
                <div className="account-main">
                  <span className="account-handle">@{item.handle}</span>
                  {item.displayName ? (
                    <span className="account-name">{item.displayName}</span>
                  ) : null}
                  <span className="account-meta">
                    {formatDate(item.addedAt, language)}
                    {reason ? ` · ${reason}` : ''}
                  </span>
                </div>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`${t.removeAllowlist}: @${item.handle}`}
                  title={t.removeAllowlist}
                  onClick={() => void remove(item.handle)}
                >
                  <AppIcon name="x" size={14} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="group">
        <div className="row">
          <button
            type="button"
            className="row-label disclosure"
            aria-expanded={showRecommended}
            onClick={() => setShowRecommended((value) => !value)}
          >
            <span>{t.recommendListTitle}</span>
            <span className="row-meta">{recommendList.length}</span>
            <span className={`chevron${showRecommended ? ' is-open' : ''}`} aria-hidden="true">
              <AppIcon name="chevron" size={14} />
            </span>
          </button>
          <OfficialLinkIcon target="whitelist" label={t.siteWhitelist} />
        </div>
        {showRecommended ? (
          recommendList.length > 0 ? (
            <ul className="account-list">
              {recommendList.map((entry) => (
                <li key={entry.handle}>
                  <div className="account-main">
                    <span className="account-handle">{entry.name || `@${entry.handle}`}</span>
                    {entry.name ? <span className="account-name">@{entry.handle}</span> : null}
                    <span className="account-meta account-note">{entry.note}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState>{t.recommendListEmpty}</EmptyState>
          )
        ) : null}
      </div>
    </>
  );
}
