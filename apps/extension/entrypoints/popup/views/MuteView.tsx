import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { UiLanguage } from '../../../src/lib/platform/i18n';
import { OFFICIAL_MUTE_PACKS } from '../../../src/lib/mute/block-packs';
import { MUTE_COPY } from '../../../src/lib/mute/copy';
import {
  addMuteRule,
  getMuteSettings,
  MAX_MUTE_PHRASE_LENGTH,
  MAX_MUTE_RULES,
  mergeNativeMutes,
  mutePhraseKey,
  normalizeMutePhrase,
  patchMuteRule,
  removeMuteRule,
  renameMuteRule,
  setMuteSettings,
  subscribeMuteSettings,
  type MuteRule,
  type MuteSettings,
  type MuteSyncState,
  type NativeMute,
} from '../../../src/lib/mute/mute-store';
import { AppIcon, HelpIcon, SubpageHeader, Toggle } from './shared';
import { Row } from './settings/shared';

interface MuteViewProps {
  language: UiLanguage;
  notify: (message: string | null) => void;
  sendToXPage: (message: {
    type: string;
    keyword?: string;
    ids?: string[];
    force?: boolean;
  }) => Promise<unknown>;
}

interface NativeReply {
  ok?: boolean;
  code?: string;
  data?: NativeMute[] | { mute?: NativeMute | null; list?: NativeMute[] };
}

type NativeStatus =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; imported: number }
  | { status: 'error'; code: string };

export default function MuteView({ language, notify, sendToXPage }: MuteViewProps) {
  const t = MUTE_COPY[language];
  const [settings, setSettings] = useState<MuteSettings | null>(null);
  const settingsRef = useRef<MuteSettings | null>(null);
  const [tab, setTab] = useState<'mine' | 'library'>('mine');
  const [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [nativeStatus, setNativeStatus] = useState<NativeStatus>({ status: 'idle' });
  const [consentOpen, setConsentOpen] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState('');
  const [mineQuery, setMineQuery] = useState('');
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const nativeLoadedRef = useRef(false);
  const processingRef = useRef(false);

  useEffect(() => {
    let active = true;
    void getMuteSettings().then((value) => {
      if (!active) return;
      settingsRef.current = value;
      setSettings(value);
      if (value.nativeSync) void processQueue();
    });
    const unsub = subscribeMuteSettings((value) => {
      settingsRef.current = value;
      setSettings(value);
      if (value.nativeSync) void processQueue();
    });
    return () => {
      active = false;
      unsub();
    };
    // processQueue 只读 settingsRef 和稳定回调，它的引用变化不需要重跑订阅
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!confirmId) return;
    const timer = window.setTimeout(() => setConfirmId(null), 3_000);
    return () => window.clearTimeout(timer);
  }, [confirmId]);

  const callTab = useCallback(
    async (message: { type: string; keyword?: string; ids?: string[]; force?: boolean }): Promise<NativeReply> => {
      try {
        return (await sendToXPage(message)) as NativeReply;
      } catch {
        return { ok: false, code: 'no_tab' };
      }
    },
    [sendToXPage],
  );

  const persist = useCallback(async (next: MuteSettings): Promise<void> => {
    settingsRef.current = next;
    setSettings(next);
    await setMuteSettings(next);
  }, []);

  const patchRule = useCallback(
    async (id: string, patch: Partial<MuteRule>): Promise<void> => {
      const current = settingsRef.current;
      if (!current) return;
      await persist(patchMuteRule(current, id, patch));
    },
    [persist],
  );

  /**
   * 逐条同步队列：每次只取一个 pending 规则，发一条 create；完成后再取下一个。
   * 这不是批量接口：每个词都是用户单独点过的，只是把等待串起来，避免 UI 卡 2 秒。
   */
  async function processQueue(): Promise<void> {
    if (processingRef.current) return;
    processingRef.current = true;
    try {
      for (;;) {
        const current = settingsRef.current;
        if (!current?.nativeSync) break;
        const rule = [...current.rules].reverse().find((entry) => entry.syncState === 'pending');
        if (!rule) break;
        setSyncingId(rule.id);
        const reply = await callTab({ type: 'feedsieve:mute-create', keyword: rule.phrase });
        const mute =
          reply.ok && reply.data && !Array.isArray(reply.data) ? reply.data.mute : null;
        let stop = false;
        if (reply.ok && mute) {
          await patchRule(rule.id, {
            nativeId: mute.id,
            syncState: 'synced',
            nativeSurfaces: mute.surfaces,
            nativeOptions: mute.options,
            validUntil: mute.validUntil,
          });
        } else {
          await patchRule(rule.id, { syncState: 'failed' });
          setErrorCode(reply.code ?? 'native_unavailable');
          stop = ['sync_disabled', 'daily_limit', 'no_tab', 'auth_required', 'rate_limited'].includes(
            reply.code ?? '',
          );
        }
        setSyncingId(null);
        if (stop) {
          const latest = settingsRef.current;
          if (latest) {
            await persist({
              ...latest,
              rules: latest.rules.map((entry) =>
                entry.syncState === 'pending'
                  ? { ...entry, syncState: 'failed' as const }
                  : entry,
              ),
            });
          }
          break;
        }
      }
    } finally {
      processingRef.current = false;
      setSyncingId(null);
    }
  }

  const refreshNative = useCallback(
    async (force = false): Promise<void> => {
      const current = settingsRef.current;
      if (!current?.nativeSync) return;
      if (!force && nativeLoadedRef.current) return;
      nativeLoadedRef.current = true;
      setNativeStatus({ status: 'loading' });
      const reply = await callTab({
        type: 'feedsieve:mute-list',
        ...(force ? { force: true } : {}),
      });
      if (!reply.ok) {
        setNativeStatus({ status: 'error', code: reply.code ?? 'native_unavailable' });
        return;
      }
      const latest = settingsRef.current;
      if (!latest) return;
      const merged = mergeNativeMutes(latest, Array.isArray(reply.data) ? reply.data : []);
      await persist(merged.settings);
      setNativeStatus({ status: 'ok', imported: merged.imported });
    },
    [callTab, persist],
  );

  useEffect(() => {
    if (!settings?.nativeSync || nativeLoadedRef.current) return;
    void refreshNative();
  }, [settings?.nativeSync, refreshNative]);

  const addedKeys = useMemo(
    () => new Set((settings?.rules ?? []).map((rule) => mutePhraseKey(rule.phrase))),
    [settings],
  );
  const rules = useMemo(() => settings?.rules ?? [], [settings]);
  const mineQueryKey = mutePhraseKey(mineQuery);
  const visibleRules = useMemo(
    () =>
      !mineQueryKey
        ? rules
        : rules.filter((rule) => mutePhraseKey(rule.phrase).includes(mineQueryKey)),
    [rules, mineQueryKey],
  );
  const syncedTotal = useMemo(
    () => rules.filter((rule) => rule.syncState === 'synced').length,
    [rules],
  );
  const libraryWords = useMemo(
    () => [...new Set(OFFICIAL_MUTE_PACKS.flatMap((entry) => entry.words))],
    [],
  );
  const addedTotal = useMemo(
    () => libraryWords.filter((word) => addedKeys.has(mutePhraseKey(word))).length,
    [addedKeys, libraryWords],
  );
  const libraryQueryKey = mutePhraseKey(libraryQuery);
  const filteredPacks = useMemo(
    () =>
      OFFICIAL_MUTE_PACKS.map((entry) => ({
        ...entry,
        words: entry.words.filter(
          (word) => !libraryQueryKey || mutePhraseKey(word).includes(libraryQueryKey),
        ),
      })).filter((entry) => entry.words.length > 0),
    [libraryQueryKey],
  );

  function errorText(code: string | null): string | null {
    if (!code) return null;
    switch (code) {
      case 'invalid':
      case 'invalid_keyword':
      case 'invalid_ids':
        return t.invalid;
      case 'duplicate':
        return t.duplicate;
      case 'limit':
        return t.limit;
      case 'daily_limit':
        return t.dailyLimit;
      case 'sync_disabled':
        return t.syncDisabled;
      case 'no_tab':
        return t.noTab;
      case 'auth_required':
        return t.authRequired;
      case 'rate_limited':
        return t.rateLimited;
      default:
        return t.nativeUnavailable;
    }
  }

  async function addPhrase(raw: string, mode: 'form' | 'library'): Promise<boolean> {
    const current = settingsRef.current;
    if (!current) return false;
    const result = addMuteRule(current, raw);
    if (!result.ok) {
      setErrorCode(result.code);
      return false;
    }
    setErrorCode(null);
    await persist(result.settings);
    if (mode === 'form') setPhrase('');
    if (current.nativeSync) {
      // 只标 pending，由队列按顺序逐条写；不阻塞用户继续加词/浏览词库。
      await patchRule(result.rule.id, { syncState: 'pending' });
      void processQueue();
    } else if (mode === 'form') {
      notify(t.added);
    }
    return true;
  }

  function retrySync(rule: MuteRule): void {
    if (!settingsRef.current?.nativeSync) {
      setErrorCode('sync_disabled');
      return;
    }
    setErrorCode(null);
    void patchRule(rule.id, { syncState: 'pending' }).then(() => processQueue());
  }

  async function deleteRule(rule: MuteRule): Promise<void> {
    if (busy || rule.id === syncingId) return;
    if (confirmId !== rule.id) {
      setConfirmId(rule.id);
      return;
    }
    setConfirmId(null);
    setErrorCode(null);
    setBusy(`del:${rule.id}`);
    if (rule.nativeId) {
      const reply = await callTab({ type: 'feedsieve:mute-destroy', ids: [rule.nativeId] });
      if (!reply.ok) {
        setErrorCode(reply.code ?? 'native_unavailable');
        setBusy(null);
        return;
      }
    }
    const current = settingsRef.current;
    if (current) await persist(removeMuteRule(current, rule.id));
    notify(t.cleared);
    setBusy(null);
  }

  function beginEdit(rule: MuteRule): void {
    if (busy || rule.id === syncingId) return;
    setConfirmId(null);
    setErrorCode(null);
    setEditingId(rule.id);
    setEditingValue(rule.phrase);
  }

  function cancelEdit(): void {
    setEditingId(null);
    setEditingValue('');
    setErrorCode(null);
  }

  async function saveEdit(rule: MuteRule): Promise<void> {
    if (busy || rule.id === syncingId) return;
    const normalized = normalizeMutePhrase(editingValue);
    if (!normalized) {
      setErrorCode('invalid');
      return;
    }
    if (mutePhraseKey(normalized) === mutePhraseKey(rule.phrase)) {
      cancelEdit();
      return;
    }
    const current = settingsRef.current;
    if (!current) return;
    const renamed = renameMuteRule(current, rule.id, normalized);
    if (!renamed.ok) {
      setErrorCode(renamed.code);
      return;
    }
    setErrorCode(null);
    setBusy(`edit:${rule.id}`);
    const hadNative = Boolean(rule.nativeId);
    // 已写入 X 的词改名 = 删旧词 + 写新词；删失败就不改本地，避免两边名字不一致。
    if (hadNative && current.nativeSync) {
      const reply = await callTab({ type: 'feedsieve:mute-destroy', ids: [rule.nativeId!] });
      if (!reply.ok) {
        setErrorCode(reply.code ?? 'native_unavailable');
        setBusy(null);
        return;
      }
    }
    // 等 X 返回期间队列可能改过别的规则，改名要落到最新状态上。
    const latest = settingsRef.current ?? current;
    const latestRename = renameMuteRule(latest, rule.id, normalized);
    if (!latestRename.ok) {
      setErrorCode(latestRename.code);
      setBusy(null);
      return;
    }
    const wantsNative =
      latest.nativeSync &&
      (hadNative || rule.syncState === 'pending' || rule.syncState === 'failed');
    await persist(
      patchMuteRule(latestRename.settings, rule.id, {
        ...(hadNative
          ? {
              nativeId: undefined,
              nativeSurfaces: undefined,
              nativeOptions: undefined,
              validUntil: undefined,
            }
          : {}),
        syncState: wantsNative ? 'pending' : 'local',
      }),
    );
    setEditingId(null);
    setEditingValue('');
    setBusy(null);
    notify(t.saved);
    if (wantsNative) void processQueue();
  }

  function toggleNative(next: boolean): void {
    const current = settingsRef.current;
    if (!current || busy) return;
    if (!next) {
      nativeLoadedRef.current = false;
      setConsentOpen(false);
      void persist({
        ...current,
        nativeSync: false,
        rules: current.rules.map((rule) =>
          (rule.syncState === 'pending' || rule.syncState === 'failed') &&
          rule.id !== syncingId
            ? { ...rule, syncState: 'local' as const }
            : rule,
        ),
      });
      return;
    }
    setConsentOpen(true);
  }

  function confirmNative(): void {
    const current = settingsRef.current;
    if (!current) return;
    setConsentOpen(false);
    setErrorCode(null);
    nativeLoadedRef.current = false;
    void persist({ ...current, nativeSync: true }).then(() => processQueue());
  }

  /** 同步关闭时，排队/失败都只是本机状态，不再显示成等待或报错。 */
  function displayState(rule: MuteRule): MuteSyncState {
    return !settings?.nativeSync && rule.syncState !== 'synced' ? 'local' : rule.syncState;
  }

  function stateLabel(rule: MuteRule): string {
    if (!settings?.nativeSync && rule.syncState !== 'synced') return t.syncLocal;
    if (rule.syncState === 'synced') return t.syncSynced;
    if (rule.syncState === 'pending') return syncingId === rule.id ? t.syncPending : t.syncQueued;
    if (rule.syncState === 'failed') return t.syncFailed;
    return t.syncLocal;
  }

  if (!settings) {
    return (
      <div className="view mute-view">
        <div className="loading-list" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </div>
    );
  }

  if (settingsOpen) {
    return (
      <div className="view mute-view">
        <SubpageHeader
          language={language}
          title={t.settings}
          backLabel={t.back}
          onBack={() => {
            setConsentOpen(false);
            setSettingsOpen(false);
          }}
        />

        <section className="group">
          <Row label={t.enabled} hint={t.enabledHint}>
            <Toggle
              checked={settings.enabled}
              label={t.enabled}
              onChange={(next) => void persist({ ...settings, enabled: next })}
            />
          </Row>
          <Row label={t.nativeSync} hint={t.nativeSyncHint}>
            <Toggle
              checked={settings.nativeSync}
              disabled={busy !== null}
              label={t.nativeSync}
              onChange={toggleNative}
            />
          </Row>
        </section>

        {consentOpen ? (
          <div className="mute-consent" role="group" aria-label={t.nativeConsentTitle}>
            <strong>{t.nativeConsentTitle}</strong>
            <p>{t.nativeConsentBody}</p>
            <div className="mute-consent-actions">
              <button type="button" className="secondary-button" onClick={confirmNative}>
                {t.nativeConsentOk}
              </button>
              <button type="button" className="text-button" onClick={() => setConsentOpen(false)}>
                {t.nativeConsentCancel}
              </button>
            </div>
          </div>
        ) : null}

        {settings.nativeSync && (nativeStatus.status !== 'ok' || nativeStatus.imported > 0) ? (
          <div className="mute-status" role="status">
            <span>
              {nativeStatus.status === 'loading'
                ? t.syncPending
                : nativeStatus.status === 'ok'
                  ? nativeStatus.imported > 0
                    ? t.nativeImported(nativeStatus.imported)
                    : null
                  : nativeStatus.status === 'error'
                    ? errorText(nativeStatus.code)
                    : null}
            </span>
            {nativeStatus.status === 'error' ? (
              <button
                type="button"
                className="text-button"
                disabled={busy !== null}
                onClick={() => void refreshNative(true)}
              >
                {t.retry}
              </button>
            ) : null}
          </div>
        ) : null}

        {!settings.nativeSync && rules.some((rule) => rule.syncState === 'synced') ? (
          <p className="mute-note">{t.nativeOffNote}</p>
        ) : null}

        {errorText(errorCode) ? (
          <p className="alert" role="status">
            {errorText(errorCode)}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="view mute-view">
      <div className="view-toolbar">
        <div className="segmented" role="group" aria-label={t.mine}>
          <button
            type="button"
            className={tab === 'mine' ? 'is-selected' : ''}
            aria-pressed={tab === 'mine'}
            onClick={() => setTab('mine')}
          >
            {t.mine}
          </button>
          <button
            type="button"
            className={tab === 'library' ? 'is-selected' : ''}
            aria-pressed={tab === 'library'}
            onClick={() => setTab('library')}
          >
            {t.library}
          </button>
        </div>
        <HelpIcon text={tab === 'library' ? t.helpLibrary : t.helpMine} />
        <span className="toolbar-end">
          {!settings.enabled ? (
            <button
              type="button"
              className="text-button mute-off-chip"
              onClick={() => setSettingsOpen(true)}
            >
              {t.disabled}
            </button>
          ) : null}
          <button
            type="button"
            className="icon-button"
            aria-label={t.settings}
            title={t.settings}
            onClick={() => setSettingsOpen(true)}
          >
            <AppIcon name="settings" size={15} />
          </button>
        </span>
      </div>

      {errorText(errorCode) ? (
        <p className="alert" role="status">
          {errorText(errorCode)}
        </p>
      ) : null}

      {tab === 'mine' ? (
        <>
          <form
            className="inline-form mute-add-form"
            onSubmit={(event) => {
              event.preventDefault();
              void addPhrase(phrase, 'form');
            }}
          >
            <input
              value={phrase}
              maxLength={MAX_MUTE_PHRASE_LENGTH}
              disabled={busy !== null}
              placeholder={t.addPlaceholder}
              aria-label={t.addPlaceholder}
              onChange={(event) => setPhrase(event.target.value)}
            />
            <button
              type="submit"
              className="secondary-button"
              disabled={busy !== null || !phrase.trim()}
            >
              {t.add}
            </button>
          </form>

          {rules.length > 5 || mineQueryKey ? (
            <div className="mute-search-field">
              <AppIcon name="search" size={14} />
              <input
                className="mute-library-search"
                value={mineQuery}
                placeholder={t.searchMine}
                aria-label={t.searchMine}
                onChange={(event) => setMineQuery(event.target.value)}
              />
            </div>
          ) : null}

          {rules.length === 0 ? (
            <div className="empty-state is-clean">
              <AppIcon name="clean" size={18} />
              <p>{t.empty}</p>
              <HelpIcon text={t.emptyHint} />
            </div>
          ) : (
            <>
              <div className="mute-summary">
                {t.count(visibleRules.length)}
                {mineQueryKey ? ` / ${t.count(rules.length)}` : ''}
                {!mineQueryKey && syncedTotal ? ` · ${t.countSynced(syncedTotal)}` : ''}
              </div>
              {visibleRules.length === 0 ? (
                <div className="empty-state">{t.libraryNoMatch}</div>
              ) : (
                <ul className="mute-list" aria-label={t.count(rules.length)}>
                  {visibleRules.map((rule) => {
                    const deleting = busy === `del:${rule.id}`;
                    const editing = editingId === rule.id;
                    return (
                      <li key={rule.id} className={`mute-item${editing ? ' is-editing' : ''}`}>
                        {editing ? (
                          <>
                            <input
                              className="mute-edit-input"
                              value={editingValue}
                              maxLength={MAX_MUTE_PHRASE_LENGTH}
                              disabled={busy !== null}
                              aria-label={`${t.edit}: ${rule.phrase}`}
                              autoFocus
                              onChange={(event) => setEditingValue(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === 'Escape') cancelEdit();
                                if (event.key === 'Enter') {
                                  event.preventDefault();
                                  void saveEdit(rule);
                                }
                              }}
                            />
                            <div className="mute-actions">
                              <button
                                type="button"
                                className="text-button"
                                disabled={busy !== null || !editingValue.trim()}
                                title={
                                  rule.nativeId && settings.nativeSync
                                    ? t.editSyncedHint
                                    : undefined
                                }
                                onClick={() => void saveEdit(rule)}
                              >
                                {t.save}
                              </button>
                              <button
                                type="button"
                                className="text-button"
                                disabled={busy !== null}
                                onClick={cancelEdit}
                              >
                                {t.cancel}
                              </button>
                            </div>
                          </>
                        ) : (
                          <>
                            <span className="mute-phrase" title={rule.phrase}>
                              {rule.phrase}
                            </span>
                            <span className="mute-state" data-state={displayState(rule)}>
                              {stateLabel(rule)}
                            </span>
                            <div className="mute-actions">
                              {settings.nativeSync &&
                              (rule.syncState === 'failed' || rule.syncState === 'local') ? (
                                <button
                                  type="button"
                                  className="text-button"
                                  disabled={busy !== null}
                                  onClick={() => retrySync(rule)}
                                >
                                  {rule.syncState === 'failed' ? t.retry : t.syncNow}
                                </button>
                              ) : null}
                              <button
                                type="button"
                                className="text-button"
                                disabled={busy !== null || syncingId === rule.id}
                                onClick={() => beginEdit(rule)}
                              >
                                {t.edit}
                              </button>
                              <button
                                type="button"
                                className={`text-button${confirmId === rule.id ? ' is-danger' : ''}`}
                                disabled={busy !== null || syncingId === rule.id}
                                onClick={() => void deleteRule(rule)}
                              >
                                {deleting
                                  ? '…'
                                  : confirmId === rule.id
                                    ? rule.nativeId
                                      ? t.confirmRemoveNative
                                      : t.confirmRemove
                                    : t.remove}
                              </button>
                            </div>
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              {rules.length >= MAX_MUTE_RULES ? <p className="mute-note">{t.limit}</p> : null}
            </>
          )}
        </>
      ) : (
        <>
          <div className="mute-library-meta">
            {t.officialLibrary} · v{OFFICIAL_MUTE_PACKS[0]?.version ?? '—'}
          </div>
          <div className="mute-library-bar">
            <input
              className="mute-library-search"
              value={libraryQuery}
              placeholder={t.librarySearch}
              aria-label={t.librarySearch}
              onChange={(event) => setLibraryQuery(event.target.value)}
            />
            <span className="mute-library-count">
              {t.packProgress(addedTotal, libraryWords.length)}
            </span>
          </div>
          {filteredPacks.length === 0 ? (
            <div className="empty-state">{t.libraryNoMatch}</div>
          ) : (
            filteredPacks.map((entry) => (
              <section className="mute-pack" key={entry.id}>
                <div className="mute-pack-head">
                  <strong>{entry.name[language]}</strong>
                  <HelpIcon text={entry.description[language]} />
                  <span className="mute-pack-count">{entry.words.length}</span>
                </div>
                <div className="mute-chips">
                  {entry.words.map((word) => {
                    const key = mutePhraseKey(word);
                    const rule = rules.find((item) => mutePhraseKey(item.phrase) === key);
                    const added = Boolean(rule);
                    return (
                      <button
                        key={word}
                        type="button"
                        className={`mute-chip${added ? ' is-added' : ''}`}
                        data-state={rule ? displayState(rule) : 'none'}
                        disabled={added || busy !== null}
                        title={rule ? stateLabel(rule) : word}
                        aria-label={`${added ? t.libraryAdded : t.addFromLibrary}: ${word}`}
                        onClick={() => void addPhrase(word, 'library')}
                      >
                        <AppIcon name={added ? 'check' : 'plus'} size={12} />
                        <span>{word}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))
          )}
        </>
      )}
    </div>
  );
}
