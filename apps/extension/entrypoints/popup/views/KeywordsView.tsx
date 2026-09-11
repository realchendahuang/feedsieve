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
import { AppIcon, HelpIcon } from './shared';

interface KeywordsViewProps {
  language: UiLanguage;
  notify: (message: string | null) => void;
}

export default function KeywordsView({ language, notify }: KeywordsViewProps) {
  const t = UI_COPY[language];
  const [keywordRules, setKeywordRules] = useState<KeywordRuleSettings | null>(null);
  const [keywordCatalog, setKeywordCatalog] = useState<KeywordPackCatalog>(
    BUNDLED_KEYWORD_PACK_CATALOG,
  );
  const [expandedKeywordCategory, setExpandedKeywordCategory] = useState<string | null>(null);
  const [customKeyword, setCustomKeyword] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [contributedIds, setContributedIds] = useState<Set<string>>(new Set());
  const [contributionsOn, setContributionsOn] = useState(false);

  useEffect(() => {
    void getKeywordRuleSettings().then(setKeywordRules);
    void getKeywordPackCatalog().then(setKeywordCatalog);
    void getCommunitySettings().then((settings) => {
      setContributionsOn(settings.enabled && settings.autoContribute);
    });
    void browser.runtime
      .sendMessage({ type: 'feedsieve:keyword-packs-sync' })
      .catch(() => undefined);
    const unsubs = [
      subscribeKeywordRules(setKeywordRules),
      subscribeKeywordPackCatalog(setKeywordCatalog),
    ];
    return () => unsubs.forEach((unsub) => unsub());
  }, []);

  async function addKeyword(): Promise<void> {
    const phrase = customKeyword.trim();
    if (!phrase) return;
    try {
      const next = await addCustomKeywordRule(phrase);
      setKeywordRules(next);
      setCustomKeyword('');
      notify(t.keywordAdded);
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      notify(code === 'keyword_rule_limit' ? t.keywordLimit : t.keywordInvalid);
    }
  }

  async function removeCustomKeyword(id: string): Promise<void> {
    setKeywordRules(await removeCustomKeywordRule(id));
  }

  async function contributeKeyword(id: string, phrase: string): Promise<void> {
    const outcome = await contributeKeywordPhrases([phrase]);
    if (outcome.status === 'recorded' || outcome.status === 'duplicate') {
      setContributedIds((prev) => new Set(prev).add(id));
      notify(t.keywordContributed);
    } else if (outcome.status === 'community_disabled') {
      notify(t.localOnlyHint);
    } else {
      notify(t.syncFailed);
    }
  }

  async function toggleOfficialKeyword(id: string, enabled: boolean): Promise<void> {
    setKeywordRules(await setOfficialKeywordRuleEnabled(id, enabled));
  }

  async function toggleOfficialKeywordCategory(
    category: Parameters<typeof setOfficialKeywordCategorySubscribed>[0],
    subscribed: boolean,
  ): Promise<void> {
    setKeywordRules(await setOfficialKeywordCategorySubscribed(category, subscribed));
  }

  async function syncKeywordPacks(): Promise<void> {
    setSyncing(true);
    try {
      const result = (await browser.runtime.sendMessage({
        type: 'feedsieve:keyword-packs-sync',
        force: true,
      })) as {
        outcome?: { status?: string; version?: string };
      };
      await getKeywordPackCatalog().then(setKeywordCatalog);
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

  const officialKeywordRules = keywordCatalog.packs.flatMap((pack) =>
    pack.rules.map((rule) => ({ ...rule, category: pack.id })),
  );

  return (
    <div className="view-stack keywords-view">
      <section className="settings-card">
        <div className="settings-card-head">
          <h2>{t.myKeywords}</h2>
        </div>
        <form
          className="keyword-add-form"
          onSubmit={(event) => {
            event.preventDefault();
            void addKeyword();
          }}
        >
          <input
            value={customKeyword}
            maxLength={80}
            placeholder={t.keywordPlaceholder}
            aria-label={t.keywordPlaceholder}
            onChange={(event) => setCustomKeyword(event.target.value)}
          />
          <button type="submit" className="secondary-inline" disabled={!customKeyword.trim()}>
            {t.addKeyword}
          </button>
        </form>

        {keywordRules ? (
          keywordRules.customRules.length > 0 ? (
            <ul className="keyword-list custom-keyword-list">
              {keywordRules.customRules.map((rule) => (
                <li key={rule.id}>
                  <span title={rule.phrase}>{rule.phrase}</span>
                  {contributionsOn && !contributedIds.has(rule.id) ? (
                    <button
                      type="button"
                      className="square-action small"
                      aria-label={`${t.contributeKeyword}: ${rule.phrase}`}
                      title={t.contributeKeyword}
                      onClick={() => void contributeKeyword(rule.id, rule.phrase)}
                    >
                      <AppIcon name="contribute" size={16} />
                    </button>
                  ) : contributedIds.has(rule.id) ? (
                    <span className="contributed-mark" aria-hidden="true">
                      <AppIcon name="check" size={14} />
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className="remove-action"
                    aria-label={`${t.removeKeyword}: ${rule.phrase}`}
                    title={t.removeKeyword}
                    onClick={() => void removeCustomKeyword(rule.id)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="community-empty">{t.noCustomKeywords}</p>
          )
        ) : (
          <div className="loading-list settings-loading" aria-hidden="true">
            <span />
            <span />
          </div>
        )}
      </section>

      <section className="settings-card">
        <div className="settings-card-head">
          <h2>
            {t.officialKeywords} <HelpIcon text={t.keywordRulesHint} />
          </h2>
          <div className="settings-head-actions">
            <button
              type="button"
              className={`square-action small${syncing ? ' is-spinning' : ''}`}
              aria-label={t.syncKeywordPacks}
              title={t.syncKeywordPacks}
              onClick={() => void syncKeywordPacks()}
            >
              <AppIcon name="refresh" size={18} />
            </button>
          </div>
        </div>

        {keywordRules ? (
          <div className="official-keyword-groups">
            {keywordCatalog.packs.map((category) => {
              const rules = officialKeywordRules.filter((rule) => rule.category === category.id);
              const subscribed = isOfficialKeywordCategorySubscribed(keywordRules, category.id);
              const enabledCount = subscribed
                ? rules.filter(
                    (rule) => !keywordRules.disabledOfficialRuleIds.includes(rule.id),
                  ).length
                : 0;
              const expanded = expandedKeywordCategory === category.id;
              return (
                <div className="keyword-pack" key={category.id}>
                  <div className="keyword-pack-row">
                    <button
                      type="button"
                      className="keyword-pack-title"
                      aria-expanded={expanded}
                      onClick={() => setExpandedKeywordCategory(expanded ? null : category.id)}
                    >
                      <span aria-hidden="true">{expanded ? '−' : '+'}</span>
                      <strong>{category.name[language]}</strong>
                      <HelpIcon text={category.description[language]} />
                    </button>
                    <button
                      type="button"
                      role="switch"
                      className={`keyword-pack-toggle${subscribed ? ' is-on' : ''}`}
                      aria-checked={subscribed}
                      aria-label={`${category.name[language]} · ${
                        subscribed ? t.unsubscribeKeywordPack : t.subscribeKeywordPack
                      }`}
                      title={`${enabledCount}/${rules.length}`}
                      onClick={() => void toggleOfficialKeywordCategory(category.id, !subscribed)}
                    >
                      <span />
                    </button>
                  </div>
                  {expanded ? (
                    <ul className="keyword-list official-keyword-list">
                      {rules.map((rule) => {
                        const enabled =
                          subscribed &&
                          !keywordRules.disabledOfficialRuleIds.includes(rule.id);
                        return (
                          <li key={rule.id} className={enabled ? '' : 'is-disabled'}>
                            <label>
                              <input
                                type="checkbox"
                                checked={enabled}
                                disabled={!subscribed}
                                onChange={(event) =>
                                  void toggleOfficialKeyword(rule.id, event.target.checked)
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
            })}
          </div>
        ) : (
          <div className="loading-list settings-loading" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        )}
      </section>
    </div>
  );
}
