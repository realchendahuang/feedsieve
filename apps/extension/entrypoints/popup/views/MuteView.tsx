import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { UiLanguage } from '../../../src/lib/platform/i18n';
import { OFFICIAL_MUTE_PACKS } from '../../../src/lib/mute/block-packs';
import { MUTE_COPY } from '../../../src/lib/mute/copy';
import {
  addMuteRule,
  getMuteSettings,
  MAX_MUTE_RULES,
  mergeNativeMutes,
  mutePhraseKey,
  patchMuteRule,
  removeMuteRule,
  setMuteSettings,
  subscribeMuteSettings,
  type MuteRule,
  type MuteSettings,
  type NativeMute,
} from '../../../src/lib/mute/mute-store';
import { AppIcon, HelpIcon, Toggle } from './shared';
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
  const [packId, setPackId] = useState(OFFICIAL_MUTE_PACKS[0]?.id ?? '');
  const nativeLoadedRef = useRef(false);

  useEffect(() => {
    let active = true;
    void getMuteSettings().then((value) => {
      if (!active) return;
      settingsRef.current = value;
      setSettings(value);
    });
    const unsub = subscribeMuteSettings((value) => {
      settingsRef.current = value;
      setSettings(value);
    });
    return () => {
      active = false;
      unsub();
    };
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
  const pack = OFFICIAL_MUTE_PACKS.find((entry) => entry.id === packId) ?? OFFICIAL_MUTE_PACKS[0];
  const rules = settings?.rules ?? [];

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

  async function updateRule(id: string, patch: Partial<MuteRule>): Promise<void> {
    const current = settingsRef.current;
    if (!current) return;
    await persist(patchMuteRule(current, id, patch));
  }

  async function addPhrase(raw: string, mode: 'form' | 'library'): Promise<boolean> {
    const current = settingsRef.current;
    if (!current || busy) return false;
    const result = addMuteRule(current, raw);
    if (!result.ok) {
      setErrorCode(result.code);
      return false;
    }
    setErrorCode(null);
    await persist(result.settings);
    if (mode === 'form') setPhrase('');
    if (!current.nativeSync) {
      notify(t.added);
      return true;
    }
    setBusy(mode === 'library' ? `lib:${raw}` : 'add');
    await updateRule(result.rule.id, { syncState: 'pending' });
    const reply = await callTab({ type: 'feedsieve:mute-create', keyword: result.rule.phrase });
    const mute = reply.ok && reply.data && !Array.isArray(reply.data) ? reply.data.mute : null;
    if (reply.ok && mute) {
      await updateRule(result.rule.id, {
        nativeId: mute.id,
        syncState: 'synced',
        nativeSurfaces: mute.surfaces,
        nativeOptions: mute.options,
        validUntil: mute.validUntil,
      });
      notify(t.synced);
    } else {
      await updateRule(result.rule.id, { syncState: 'failed' });
      setErrorCode(reply.code ?? 'native_unavailable');
    }
    setBusy(null);
    return true;
  }

  async function retrySync(rule: MuteRule): Promise<void> {
    if (!settingsRef.current?.nativeSync || busy) return;
    setBusy(`sync:${rule.id}`);
    setErrorCode(null);
    await updateRule(rule.id, { syncState: 'pending' });
    const reply = await callTab({ type: 'feedsieve:mute-create', keyword: rule.phrase });
    const mute = reply.ok && reply.data && !Array.isArray(reply.data) ? reply.data.mute : null;
    if (reply.ok && mute) {
      await updateRule(rule.id, {
        nativeId: mute.id,
        syncState: 'synced',
        nativeSurfaces: mute.surfaces,
        nativeOptions: mute.options,
        validUntil: mute.validUntil,
      });
      notify(t.synced);
    } else {
      await updateRule(rule.id, { syncState: 'failed' });
      setErrorCode(reply.code ?? 'native_unavailable');
    }
    setBusy(null);
  }

  async function deleteRule(rule: MuteRule): Promise<void> {
    if (busy) return;
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

  function toggleNative(next: boolean): void {
    const current = settingsRef.current;
    if (!current || busy) return;
    if (!next) {
      nativeLoadedRef.current = false;
      setConsentOpen(false);
      void persist({ ...current, nativeSync: false });
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
    void persist({ ...current, nativeSync: true });
  }

  function stateLabel(rule: MuteRule): string {
    if (rule.syncState === 'synced') return t.syncSynced;
    if (rule.syncState === 'pending') return t.syncPending;
    if (rule.syncState === 'failed') return t.syncFailed;
    return t.syncLocal;
  }

  if (!settings) {
    return <div className="loading-list"><span /><span /><span /></div>;
  }

  return (
    <div className="view mute-view">
      <div className="mute-toolbar">
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
      </div>

      {tab === 'mine' ? (
        <>
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
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setConsentOpen(false)}
                >
                  {t.nativeConsentCancel}
                </button>
              </div>
            </div>
          ) : null}

          {settings.nativeSync &&
          (nativeStatus.status !== 'ok' || nativeStatus.imported > 0) ? (
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

          <form
            className="inline-form mute-add-form"
            onSubmit={(event) => {
              event.preventDefault();
              void addPhrase(phrase, 'form');
            }}
          >
            <input
              value={phrase}
              maxLength={80}
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

          {errorText(errorCode) ? (
            <p className="alert" role="status">
              {errorText(errorCode)}
            </p>
          ) : null}
          {!settings.nativeSync && rules.some((rule) => rule.syncState === 'synced') ? (
            <p className="mute-note">{t.nativeOffNote}</p>
          ) : null}

          {rules.length === 0 ? (
            <div className="empty-state is-clean">
              <AppIcon name="clean" size={18} />
              <p>{t.empty}</p>
              <HelpIcon text={t.emptyHint} />
            </div>
          ) : (
            <>
              <div className="mute-summary">{t.count(rules.length)}</div>
              <ul className="mute-list" aria-label={t.count(rules.length)}>
                {rules.map((rule) => {
                  const deleting = busy === `del:${rule.id}`;
                  const syncing = busy === `sync:${rule.id}`;
                  return (
                    <li key={rule.id} className="mute-item">
                      <span className="mute-phrase" title={rule.phrase}>
                        {rule.phrase}
                      </span>
                      <span className="mute-state" data-state={rule.syncState}>
                        {stateLabel(rule)}
                      </span>
                      <div className="mute-actions">
                        {settings.nativeSync &&
                        (rule.syncState === 'failed' || rule.syncState === 'local') ? (
                          <button
                            type="button"
                            className="text-button"
                            disabled={busy !== null}
                            onClick={() => void retrySync(rule)}
                          >
                            {syncing ? '…' : rule.syncState === 'failed' ? t.retry : t.syncNow}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className={`text-button${confirmId === rule.id ? ' is-danger' : ''}`}
                          disabled={busy !== null}
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
                    </li>
                  );
                })}
              </ul>
              {rules.length >= MAX_MUTE_RULES ? <p className="mute-note">{t.limit}</p> : null}
            </>
          )}
        </>
      ) : (
        <>
          {pack ? (
            <div className="mute-library-meta">
              {t.officialLibrary} · v{pack.version}
            </div>
          ) : null}
          <div className="mute-library-bar">
            <select
              className="sort-select"
              value={pack?.id ?? ''}
              aria-label={t.library}
              onChange={(event) => setPackId(event.target.value)}
            >
              {OFFICIAL_MUTE_PACKS.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name[language]}
                </option>
              ))}
            </select>
            {pack ? <HelpIcon text={pack.description[language]} /> : null}
            <span className="mute-library-count">{pack ? t.packWords(pack.words.length) : ''}</span>
          </div>
          {pack ? (
            <ul className="mute-pack-list">
              {pack.words.map((word) => {
                const added = addedKeys.has(mutePhraseKey(word));
                const adding = busy === `lib:${word}`;
                return (
                  <li key={word} className="mute-pack-item">
                    <span className="mute-phrase" title={word}>
                      {word}
                    </span>
                    <button
                      type="button"
                      className={`text-button${added ? ' is-muted' : ''}`}
                      disabled={added || busy !== null}
                      onClick={() => void addPhrase(word, 'library')}
                    >
                      {adding ? '…' : added ? t.libraryAdded : t.addFromLibrary}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="empty-state">{t.empty}</div>
          )}
        </>
      )}
    </div>
  );
}
