import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { UiLanguage } from '../../../src/lib/platform/i18n';
import { OFFICIAL_MUTE_PACKS } from '../../../src/lib/mute/block-packs';
import { MUTE_COPY } from '../../../src/lib/mute/copy';
import {
  addMuteRule,
  getMuteSettings,
  grantMuteConsent,
  MAX_MUTE_PHRASE_LENGTH,
  MAX_MUTE_RULES,
  mergeNativeMutes,
  mutePhraseKey,
  normalizeMutePhrase,
  removeMuteRule,
  replaceMuteRule,
  setMuteSettings,
  subscribeMuteSettings,
  type MuteRule,
  type MuteSettings,
  type NativeMute,
} from '../../../src/lib/mute/mute-store';
import {
  AppIcon,
  EmptyState,
  HelpIcon,
  SkeletonList,
  SubpageHeader,
  useArmedConfirm,
} from './shared';

/**
 * 「静音」页 = X 原生静音词的管理界面。
 *
 * 所有读写都通过 x.com 网页端自己的 /1.1/mutes/keywords 接口（见 src/lib/mute/native-mutes.ts）：
 * 添加 = 写进 X 账号的静音字词（手机 App 同步生效），删除 = 从 X 删除，编辑 = 先删旧词再写新词。
 * 本机只存镜像用于秒开列表；第一写入账号前必须在弹窗里确认一次。
 * 不在 x.com 页面时读写都不可用，给出提示和重试，不在本机假装生效。
 */

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

type LoadState = { status: 'loading' } | { status: 'ok' } | { status: 'error'; code: string };

/** 首次写入确认后要执行的写入动作（添加 / 编辑等）。 */
interface PendingWrite {
  run: () => Promise<void>;
}

export default function MuteView({ language, notify, sendToXPage }: MuteViewProps) {
  const t = MUTE_COPY[language];
  const [settings, setSettings] = useState<MuteSettings | null>(null);
  const settingsRef = useRef<MuteSettings | null>(null);
  const [tab, setTab] = useState<'mine' | 'library'>('mine');
  const [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' });
  const [pendingWrite, setPendingWrite] = useState<PendingWrite | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [libraryQuery, setLibraryQuery] = useState('');
  const [mineQuery, setMineQuery] = useState('');
  const { isArmed, arm, reset } = useArmedConfirm();
  const loadedRef = useRef(false);

  const callTab = useCallback(
    async (message: { type: string; keyword?: string; ids?: string[]; force?: boolean }): Promise<NativeReply> => {
      try {
        const reply = (await sendToXPage(message)) as NativeReply | undefined | null;
        // 弹窗没开在 x.com 页面、内容脚本没就绪、或别的扩展抢答时可能拿回空值：
        // 统一当成「原生接口不可用」，不要卡住界面
        if (!reply || typeof reply.ok !== 'boolean') return { ok: false, code: 'no_tab' };
        return reply;
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

  /** 用 X 返回的列表对齐镜像：X 是唯一事实来源。 */
  const refresh = useCallback(
    async (force = false): Promise<void> => {
      setLoadState({ status: 'loading' });
      const reply = await callTab({ type: 'feedsieve:mute-list', ...(force ? { force: true } : {}) });
      const list = Array.isArray(reply.data) ? (reply.data as NativeMute[]) : null;
      if (!reply.ok || !list) {
        setLoadState({ status: 'error', code: reply.code ?? 'native_unavailable' });
        return;
      }
      const current: MuteSettings = settingsRef.current ?? { consented: false, rules: [] };
      const merged = mergeNativeMutes(current, list);
      await persist(merged.settings);
      setLoadState({ status: 'ok' });
      if (merged.imported > 0) notify(t.nativeImported(merged.imported));
    },
    [callTab, notify, persist, t],
  );

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
    if (!settings || loadedRef.current) return;
    loadedRef.current = true;
    void refresh();
    // 只在第一次拿到本地镜像后刷新一次；之后由用户点刷新或操作后更新
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  function errorText(code: string | null): string | null {
    if (!code) return null;
    if (code === 'invalid' || code === 'invalid_keyword' || code === 'invalid_ids') return t.invalid;
    if (code === 'daily_limit') return t.dailyLimit;
    if (code === 'no_tab') return t.noTab;
    if (code === 'auth_required' || code === 'missing_csrf') return t.authRequired;
    if (code === 'rate_limited') return t.rateLimited;
    if (code === 'consent_required') return t.noTab;
    return t.nativeUnavailable;
  }

  /** 真正写入 X：调用官方静音词 create 接口，成功后更新镜像。 */
  async function createWord(value: string): Promise<boolean> {
    const normalized = normalizeMutePhrase(value);
    if (!normalized) return false;
    const current = settingsRef.current;
    if (!current) return false;
    const key = mutePhraseKey(normalized);
    if (current.rules.some((rule) => mutePhraseKey(rule.phrase) === key)) {
      notify(t.duplicate);
      return false;
    }
    if (current.rules.length >= MAX_MUTE_RULES) {
      notify(t.limit);
      return false;
    }
    setBusy('add');
    const reply = await callTab({ type: 'feedsieve:mute-create', keyword: normalized });
    setBusy(null);
    if (!reply.ok || !reply.data || Array.isArray(reply.data)) {
      // 本机确认状态和内容脚本不一致时（例如同时开了另一个窗口），回到确认流程
      if (reply.code === 'consent_required') {
        setPendingWrite({ run: async () => void (await createWord(normalized)) });
        return false;
      }
      notify(errorText(reply.code ?? 'native_unavailable'));
      return false;
    }
    const mute = reply.data.mute ?? null;
    if (!mute) {
      notify(t.writeFailed);
      // 写入返回里没带词：拉一次列表对齐，避免和服务端不一致
      void refresh(true);
      return false;
    }
    const next = addMuteRule(current, mute);
    if (!next.ok) {
      notify(next.code === 'duplicate' ? t.duplicate : t.limit);
      return false;
    }
    await persist(next.settings);
    notify(t.added);
    return true;
  }

  /** 用户第一次写入账号前确认。 */
  async function confirmConsent(): Promise<void> {
    const current = settingsRef.current;
    if (!current) return;
    await persist(grantMuteConsent(current));
    const pending = pendingWrite;
    setPendingWrite(null);
    if (pending) await pending.run();
  }

  async function addPhrase(value: string, mode: 'form' | 'library'): Promise<boolean> {
    if (busy) return false;
    const normalized = normalizeMutePhrase(value);
    if (!normalized) {
      notify(t.invalid);
      return false;
    }
    const current = settingsRef.current;
    if (!current) return false;
    // 读不到 X（弹窗不在 x.com 页面 / 接口不可用）时先给提示，别让用户以为词加上了
    if (loadState.status === 'error') {
      notify(loadState.code === 'no_tab' ? t.noTab : t.loadFailed);
      return false;
    }
    if (!current.consented) {
      setPendingWrite({
        run: async () => {
          const created = await createWord(normalized);
          if (created && mode === 'form') setPhrase('');
        },
      });
      return false;
    }
    const ok = await createWord(normalized);
    if (ok && mode === 'form') setPhrase('');
    return ok;
  }

  function beginEdit(rule: MuteRule): void {
    if (busy) return;
    setEditingId(rule.id);
    setEditingValue(rule.phrase);
  }

  function cancelEdit(): void {
    setEditingId(null);
    setEditingValue('');
  }

  /** 编辑 = 从 X 删掉旧词，再写入新词；失败时尽力把旧词补回去。 */
  async function saveEdit(rule: MuteRule): Promise<void> {
    if (busy) return;
    const normalized = normalizeMutePhrase(editingValue);
    if (!normalized) {
      notify(t.invalid);
      return;
    }
    if (mutePhraseKey(normalized) === mutePhraseKey(rule.phrase)) {
      cancelEdit();
      return;
    }
    const current = settingsRef.current;
    if (current && !current.consented) {
      setPendingWrite({ run: async () => void (await performEdit(rule, normalized)) });
      return;
    }
    await performEdit(rule, normalized);
  }

  async function performEdit(rule: MuteRule, normalized: string): Promise<void> {
    setBusy(`save:${rule.id}`);
    const removed = await callTab({ type: 'feedsieve:mute-destroy', ids: [rule.nativeId] });
    if (!removed.ok) {
      setBusy(null);
      notify(errorText(removed.code ?? 'native_unavailable'));
      return;
    }
    const created = await callTab({ type: 'feedsieve:mute-create', keyword: normalized });
    const mute =
      created.ok && created.data && !Array.isArray(created.data) ? created.data.mute ?? null : null;
    if (!mute) {
      setBusy(null);
      notify(created.code ? errorText(created.code) : t.writeFailed);
      // 旧词已被删除：把旧词写回去，尽量不让用户丢词
      await callTab({ type: 'feedsieve:mute-create', keyword: rule.phrase });
      void refresh(true);
      return;
    }
    const current = settingsRef.current;
    if (current) await persist(replaceMuteRule(current, rule.id, mute));
    setBusy(null);
    cancelEdit();
    notify(t.saved);
  }

  async function deleteRule(rule: MuteRule): Promise<void> {
    if (busy || rule.id === editingId) return;
    if (!arm(rule.id)) return;
    reset();
    setBusy(`del:${rule.id}`);
    const reply = await callTab({ type: 'feedsieve:mute-destroy', ids: [rule.nativeId] });
    if (!reply.ok) {
      setBusy(null);
      notify(errorText(reply.code ?? 'native_unavailable'));
      return;
    }
    const current = settingsRef.current;
    if (current) await persist(removeMuteRule(current, rule.id));
    setBusy(null);
    notify(t.cleared);
  }

  const rules = useMemo(() => settings?.rules ?? [], [settings]);
  const mineQueryKey = mutePhraseKey(mineQuery);
  const visibleRules = useMemo(
    () =>
      !mineQueryKey
        ? rules
        : rules.filter((rule) => mutePhraseKey(rule.phrase).includes(mineQueryKey)),
    [rules, mineQueryKey],
  );

  const libraryWords = useMemo(
    () => OFFICIAL_MUTE_PACKS.flatMap((entry) => entry.words),
    [],
  );
  const addedKeys = useMemo(() => new Set(rules.map((rule) => mutePhraseKey(rule.phrase))), [rules]);
  const addedTotal = libraryWords.filter((word) => addedKeys.has(mutePhraseKey(word))).length;

  const filteredPacks = useMemo(() => {
    const query = mutePhraseKey(libraryQuery);
    if (!query) return OFFICIAL_MUTE_PACKS;
    return OFFICIAL_MUTE_PACKS.map((entry) => ({
      ...entry,
      words: entry.words.filter((word) => mutePhraseKey(word).includes(query)),
    })).filter((entry) => entry.words.length > 0);
  }, [libraryQuery]);

  if (!settings) {
    return (
      <div className="view mute-view">
        <SkeletonList />
      </div>
    );
  }

  // 词库是二级页：和「过滤」里的二级页一样，点进去、顶部一条返回，不再多占一行 tab
  if (tab === 'library') {
    return (
      <div className="view mute-view">
        <SubpageHeader
          language={language}
          title={t.library}
          backLabel={t.backTo}
          onBack={() => setTab('mine')}
        />
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
          <EmptyState>{t.libraryNoMatch}</EmptyState>
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
                  const added = addedKeys.has(mutePhraseKey(word));
                  return (
                    <button
                      key={word}
                      type="button"
                      className={`mute-chip${added ? ' is-added' : ''}`}
                      disabled={added || busy !== null}
                      title={word}
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
      </div>
    );
  }

  return (
    <div className="view mute-view">
      <section className="block" aria-label={t.title}>
        <div className="block-head">
          <h2>{t.title}</h2>
          {rules.length ? <span className="count">{rules.length}</span> : null}
          <HelpIcon text={t.mineHint} />
          <button
            type="button"
            className="text-button toolbar-end"
            title={t.libraryHint}
            onClick={() => setTab('library')}
          >
            {t.library}
          </button>
          <button
            type="button"
            className={`icon-button${loadState.status === 'loading' ? ' is-spinning' : ''}`}
            aria-label={t.refresh}
            title={t.refresh}
            disabled={busy !== null || loadState.status === 'loading'}
            onClick={() => void refresh(true)}
          >
            <AppIcon name="refresh" size={15} />
          </button>
        </div>

        {loadState.status === 'error' ? (
          <p className="alert" role="status">
            {loadState.code === 'no_tab' ? t.noTab : t.loadFailed}
            <button type="button" className="text-button" onClick={() => void refresh(true)}>
              {t.retry}
            </button>
          </p>
        ) : null}

        {pendingWrite ? (
          <div className="mute-consent" role="group" aria-label={t.consentTitle}>
            <strong>{t.consentTitle}</strong>
            <p>{t.consentBody}</p>
            <div className="mute-consent-actions">
              <button type="button" className="secondary-button" onClick={() => void confirmConsent()}>
                {t.consentOk}
              </button>
              <button type="button" className="text-button" onClick={() => setPendingWrite(null)}>
                {t.consentCancel}
              </button>
            </div>
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

        {loadState.status === 'loading' && rules.length === 0 ? (
          <SkeletonList />
        ) : rules.length === 0 ? (
          <EmptyState icon="clean" className="is-clean" hint={t.emptyHint}>
            {t.empty}
          </EmptyState>
        ) : visibleRules.length === 0 ? (
          <EmptyState>{t.libraryNoMatch}</EmptyState>
        ) : (
          <ul className="mute-list" aria-label={t.count(rules.length)}>
            {visibleRules.map((rule) => {
              const deleting = busy === `del:${rule.id}`;
              const saving = busy === `save:${rule.id}`;
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
                          title={t.editHint}
                          onClick={() => void saveEdit(rule)}
                        >
                          {saving ? '…' : t.save}
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
                      <div className="mute-actions">
                        <button
                          type="button"
                          className="text-button"
                          disabled={busy !== null}
                          onClick={() => beginEdit(rule)}
                        >
                          {t.edit}
                        </button>
                        <button
                          type="button"
                          className={`text-button${isArmed(rule.id) ? ' is-danger' : ''}`}
                          disabled={busy !== null}
                          onClick={() => void deleteRule(rule)}
                        >
                          {deleting ? '…' : isArmed(rule.id) ? t.confirmRemove : t.remove}
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
      </section>
    </div>
  );
}
