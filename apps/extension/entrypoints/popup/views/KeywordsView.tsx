import { useEffect, useState } from 'react';
import {
  addCustomKeywordRule,
  getKeywordRuleSettings,
  isOfficialKeywordCategorySubscribed,
  removeCustomKeywordRule,
  setOfficialKeywordCategorySubscribed,
  setOfficialKeywordRuleEnabled,
  subscribeKeywordRules,
  type KeywordRuleSettings,
} from '../../../src/lib/detection/keyword-rules';
import {
  BUNDLED_KEYWORD_PACK_CATALOG,
  getKeywordPackCatalog,
  subscribeKeywordPackCatalog,
  type KeywordPackCatalog,
} from '../../../src/lib/detection/keyword-packs';
import { getCommunitySettings } from '../../../src/lib/community/community-store';
import { contributeKeywordPhrases } from '../../../src/lib/community/contribute';
import { UI_COPY, type UiLanguage } from '../../../src/lib/platform/i18n';
import { AppIcon, HelpIcon, OfficialLinkIcon } from './shared';

interface KeywordsViewProps {
  language: UiLanguage;
  notify: (message: string | null) => void;
}

/** 设置 › 关键词：自己的词 + 官方词库订阅。 */
export default function KeywordsView({ language, notify }: KeywordsViewProps) {
  const t = UI_COPY[language];
  const [rules, setRules] = useState<KeywordRuleSettings | null>(null);
  const [catalog, setCatalog] = useState<KeywordPackCatalog>(BUNDLED_KEYWORD_PACK_CATALOG);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [phrase, setPhrase] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [contributedIds, setContributedIds] = useState<Set<string>>(new Set());
  const [contributionsOn, setContributionsOn] = useState(false);

  useEffect(() => {
    void getKeywordRuleSettings().then(setRules);
    void getKeywordPackCatalog().then(setCatalog);
    void getCommunitySettings().then((settings) => {
      setContributionsOn(settings.enabled && settings.autoContribute);
    });
    void browser.runtime
      .sendMessage({ type: 'feedsieve:keyword-packs-sync' })
      .catch(() => undefined);
    const unsubs = [subscribeKeywordRules(setRules), subscribeKeywordPackCatalog(setCatalog)];
    return () => unsubs.forEach((unsub) => unsub());
  }, []);

  async function addKeyword(): Promise<void> {
    const value = phrase.trim();
    if (!value) return;
    try {
      setRules(await addCustomKeywordRule(value));
      setPhrase('');
      notify(t.keywordAdded);
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      notify(code === 'keyword_rule_limit' ? t.keywordLimit : t.keywordInvalid);
    }
  }

  async function contribute(id: string, value: string): Promise<void> {
    const outcome = await contributeKeywordPhrases([value]);
    if (outcome.status === 'recorded' || outcome.status === 'duplicate') {
      setContributedIds((prev) => new Set(prev).add(id));
      notify(t.keywordContributed);
    } else if (outcome.status === 'community_disabled') {
      notify(t.localOnlyHint);
    } else {
      notify(t.syncFailed);
    }
  }

  async function syncPacks(): Promise<void> {
    setSyncing(true);
    try {
      const result = (await browser.runtime.sendMessage({
        type: 'feedsieve:keyword-packs-sync',
        force: true,
      })) as { outcome?: { status?: string; version?: string } };
      await getKeywordPackCatalog().then(setCatalog);
      notify(
        result?.outcome?.status === 'error'
          ? t.syncFailed
          : t.keywordPacksSynced(result?.outcome?.version),
      );
    } catch {
      notify(t.backgroundUnavailable);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <>
      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          void addKeyword();
        }}
      >
        <input
          value={phrase}
          maxLength={80}
          placeholder={t.keywordPlaceholder}
          aria-label={t.keywordPlaceholder}
          onChange={(event) => setPhrase(event.target.value)}
        />
        <button type="submit" className="secondary-button" disabled={!phrase.trim()}>
          {t.addKeyword}
        </button>
      </form>

      {rules === null ? (
        <div className="loading-list" aria-hidden="true">
          <span />
        </div>
      ) : rules.customRules.length > 0 ? (
        <ul className="keyword-chips" aria-label={t.myKeywords}>
          {rules.customRules.map((rule) => (
            <li key={rule.id}>
              <span title={rule.phrase}>{rule.phrase}</span>
              {contributionsOn && !contributedIds.has(rule.id) ? (
                <button
                  type="button"
                  aria-label={`${t.contributeKeyword}: ${rule.phrase}`}
                  title={t.contributeKeyword}
                  onClick={() => void contribute(rule.id, rule.phrase)}
                >
                  <AppIcon name="contribute" size={12} />
                </button>
              ) : contributedIds.has(rule.id) ? (
                <span className="chip-done" aria-hidden="true">
                  <AppIcon name="check" size={12} />
                </span>
              ) : null}
              <button
                type="button"
                aria-label={`${t.removeKeyword}: ${rule.phrase}`}
                title={t.removeKeyword}
                onClick={() => void removeCustomKeywordRule(rule.id).then(setRules)}
              >
                <AppIcon name="x" size={12} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="account-meta">{t.noCustomKeywords}</p>
      )}

      <section className="group">
        <div className="group-head">
          <h3 className="group-title">{t.officialKeywords}</h3>
          <HelpIcon text={t.keywordRulesHint} />
          <span className="toolbar-end">
            <OfficialLinkIcon target="keywords" label={t.siteKeywords} />
            <button
              type="button"
              className={`icon-button${syncing ? ' is-spinning' : ''}`}
              aria-label={t.syncKeywordPacks}
              title={t.syncKeywordPacks}
              onClick={() => void syncPacks()}
            >
              <AppIcon name="refresh" size={14} />
            </button>
          </span>
        </div>
        {rules ? (
          catalog.packs.map((pack) => {
            const subscribed = isOfficialKeywordCategorySubscribed(rules, pack.id);
            const enabledCount = subscribed
              ? pack.rules.filter((rule) => !rules.disabledOfficialRuleIds.includes(rule.id)).length
              : 0;
            const open = expanded === pack.id;
            return (
              <div key={pack.id} className="pack">
                <div className="row">
                  <button
                    type="button"
                    className="row-label disclosure"
                    aria-expanded={open}
                    onClick={() => setExpanded(open ? null : pack.id)}
                  >
                    <span>{pack.name[language]}</span>
                    <span className="row-meta">
                      {enabledCount}/{pack.rules.length}
                    </span>
                    <span className={`chevron${open ? ' is-open' : ''}`} aria-hidden="true">
                      <AppIcon name="chevron" size={14} />
                    </span>
                  </button>
                  <HelpIcon text={pack.description[language]} />
                  <label className="switch">
                    <input
                      type="checkbox"
                      role="switch"
                      checked={subscribed}
                      aria-label={`${pack.name[language]} · ${
                        subscribed ? t.unsubscribeKeywordPack : t.subscribeKeywordPack
                      }`}
                      onChange={() =>
                        void setOfficialKeywordCategorySubscribed(pack.id, !subscribed).then(
                          setRules,
                        )
                      }
                    />
                    <span aria-hidden="true" />
                  </label>
                </div>
                {open ? (
                  <ul className="rule-list">
                    {pack.rules.map((rule) => {
                      const enabled =
                        subscribed && !rules.disabledOfficialRuleIds.includes(rule.id);
                      return (
                        <li key={rule.id} className={enabled ? '' : 'is-disabled'}>
                          <label>
                            <input
                              type="checkbox"
                              checked={enabled}
                              disabled={!subscribed}
                              onChange={(event) =>
                                void setOfficialKeywordRuleEnabled(
                                  rule.id,
                                  event.target.checked,
                                ).then(setRules)
                              }
                            />
                            <span>{rule.name[language]}</span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>
            );
          })
        ) : (
          <div className="loading-list" aria-hidden="true">
            <span />
            <span />
          </div>
        )}
      </section>
    </>
  );
}
