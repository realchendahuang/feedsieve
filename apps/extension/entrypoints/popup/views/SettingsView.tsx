import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { MARK_STRENGTHS, type MarkStrength } from '@feedsieve/community-lists';
import { getContributionStats, getInstallationId, type ContributionStats } from '../../../src/lib/community/contribute';
import {
  getKeywordRuleSettings,
  replaceKeywordRuleSettings,
  subscribeKeywordRules,
  type KeywordRuleSettings,
} from '../../../src/lib/detection/keyword-rules';
import {
  BUNDLED_KEYWORD_PACK_CATALOG,
  getKeywordPackCatalog,
  subscribeKeywordPackCatalog,
  type KeywordPackCatalog,
} from '../../../src/lib/detection/keyword-packs';
import type { CommunitySettings } from '../../../src/lib/community/community-store';
import {
  createPersonalConfigDocument,
  MAX_PERSONAL_CONFIG_BYTES,
  parsePersonalConfigDocument,
  preparePersonalConfigImport,
  serializePersonalConfigDocument,
  type PersonalConfigImportMode,
  type PersonalConfigImportResult,
  type PersonalConfigParseError,
} from '../../../src/lib/settings/personal-config';
import { setUiLanguage, UI_COPY, type UiLanguage } from '../../../src/lib/platform/i18n';
import { HelpIcon, STRENGTH_LABELS, STRENGTH_HINTS } from './shared';

interface PersonalConfigPreviewState {
  merge: PersonalConfigImportResult;
  replace: PersonalConfigImportResult;
}

interface SettingsViewProps {
  language: UiLanguage;
  notify: (message: string | null) => void;
  community: CommunitySettings | null;
  onUpdateCommunity: (patch: {
    enabled?: boolean;
    autoContribute?: boolean;
    strength?: MarkStrength;
  }) => Promise<unknown>;
  onLanguageChange: (next: UiLanguage) => void;
  /** 各名单手动同步后的快照回填（同步落盘后立即刷新展示） */
  onSyncCommunity: () => Promise<void>;
}

export default function SettingsView({
  language,
  notify,
  community,
  onUpdateCommunity,
  onLanguageChange,
  onSyncCommunity,
}: SettingsViewProps) {
  const t = UI_COPY[language];
  const [contribution, setContribution] = useState<ContributionStats | null>(null);
  const [keywordRules, setKeywordRules] = useState<KeywordRuleSettings | null>(null);
  const [keywordCatalog, setKeywordCatalog] = useState<KeywordPackCatalog>(
    BUNDLED_KEYWORD_PACK_CATALOG,
  );
  const personalConfigInputRef = useRef<HTMLInputElement>(null);
  const [personalConfigPreview, setPersonalConfigPreview] =
    useState<PersonalConfigPreviewState | null>(null);
  const [personalConfigMessage, setPersonalConfigMessage] = useState<string | null>(null);
  const [personalConfigError, setPersonalConfigError] = useState<string | null>(null);
  const [personalConfigBusy, setPersonalConfigBusy] = useState(false);

  useEffect(() => {
    void getContributionStats().then(setContribution);
    void getKeywordRuleSettings().then(setKeywordRules);
    void getKeywordPackCatalog().then(setKeywordCatalog);
    const unsubs = [subscribeKeywordRules(setKeywordRules), subscribeKeywordPackCatalog(setKeywordCatalog)];
    return () => unsubs.forEach((unsub) => unsub());
  }, []);

  async function selectLanguage(next: UiLanguage): Promise<void> {
    if (next === language) return;
    notify(null);
    onLanguageChange(next);
    await setUiLanguage(next);
  }

  async function setLocalOnly(localOnly: boolean): Promise<void> {
    await onUpdateCommunity({ autoContribute: !localOnly });
    if (!localOnly) {
      await browser.runtime.sendMessage({ type: 'feedsieve:labels-sync' }).catch(() => undefined);
      setContribution(await getContributionStats());
    }
  }

  async function copyInstallationId(): Promise<void> {
    try {
      const id = await getInstallationId();
      await navigator.clipboard.writeText(id);
      notify(t.copiedId);
    } catch {
      notify(t.copyFailed);
    }
  }

  function personalConfigErrorMessage(error: PersonalConfigParseError): string {
    switch (error) {
      case 'file_too_large':
        return t.personalConfigFileTooLarge;
      case 'unsupported_version':
        return t.personalConfigUnsupportedVersion;
      case 'invalid_json':
      case 'invalid_format':
      case 'invalid_payload':
        return t.personalConfigInvalid;
    }
  }

  function exportPersonalConfig(): void {
    if (!keywordRules || !community) return;
    setPersonalConfigError(null);
    setPersonalConfigMessage(null);
    try {
      const body = serializePersonalConfigDocument(
        createPersonalConfigDocument({
          keywordRules,
          community,
          language,
          catalog: keywordCatalog,
        }),
      );
      const objectUrl = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = `feedsieve-personal-config-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.style.display = 'none';
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
      setPersonalConfigMessage(t.personalConfigExported);
    } catch {
      setPersonalConfigError(t.personalConfigExportFailed);
    }
  }

  function choosePersonalConfigFile(): void {
    if (!keywordRules || !community || personalConfigBusy) return;
    setPersonalConfigError(null);
    setPersonalConfigMessage(null);
    personalConfigInputRef.current?.click();
  }

  async function readPersonalConfigFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.currentTarget.files?.[0];
    // 同一文件再次选择时也要触发 change；读取后立即清空 input。
    event.currentTarget.value = '';
    if (!file || !keywordRules || !community) return;
    setPersonalConfigError(null);
    setPersonalConfigMessage(null);
    setPersonalConfigPreview(null);
    if (file.size > MAX_PERSONAL_CONFIG_BYTES) {
      setPersonalConfigError(t.personalConfigFileTooLarge);
      return;
    }
    try {
      const parsed = parsePersonalConfigDocument(await file.text());
      if (!parsed.ok) {
        setPersonalConfigError(personalConfigErrorMessage(parsed.error));
        return;
      }
      const context = { keywordRules, community, language, catalog: keywordCatalog };
      setPersonalConfigPreview({
        merge: preparePersonalConfigImport(parsed.document, context, 'merge'),
        replace: preparePersonalConfigImport(parsed.document, context, 'replace'),
      });
    } catch {
      setPersonalConfigError(t.personalConfigReadFailed);
    }
  }

  async function applyPersonalConfig(mode: PersonalConfigImportMode): Promise<void> {
    const prepared = personalConfigPreview?.[mode];
    if (!prepared?.next || personalConfigBusy) return;
    setPersonalConfigBusy(true);
    setPersonalConfigError(null);
    try {
      const [nextKeywordRules] = await Promise.all([
        replaceKeywordRuleSettings(prepared.next.keywordRules),
        onUpdateCommunity({
          enabled: prepared.next.preferences.communityEnabled,
          strength: prepared.next.preferences.markStrength,
        }),
      ]);
      await setUiLanguage(prepared.next.preferences.uiLanguage);
      setKeywordRules(nextKeywordRules);
      onLanguageChange(prepared.next.preferences.uiLanguage);
      setPersonalConfigPreview(null);
      setPersonalConfigMessage(
        UI_COPY[prepared.next.preferences.uiLanguage].personalConfigImported,
      );
    } catch {
      setPersonalConfigError(t.personalConfigApplyFailed);
    } finally {
      setPersonalConfigBusy(false);
    }
  }

  const keywordCategoryNames = new Map(
    keywordCatalog.packs.map((pack) => [pack.id, pack.name[language]]),
  );
  // 各名单的手动刷新统一收在设置页；成功提示走 toast（4s 自动消失）
  const [manualSyncing, setManualSyncing] = useState(false);
  async function syncAllNow(): Promise<void> {
    setManualSyncing(true);
    try {
      const res = (await browser.runtime.sendMessage({
        type: 'feedsieve:community-sync',
        force: true,
      })) as { outcome?: { status: string; version?: string; error?: string } };
      const outcome = res?.outcome;
      if (outcome?.status === 'updated' || outcome?.status === 'unchanged') {
        await onSyncCommunity();
        notify(outcome.status === 'updated' ? t.synced(outcome.version) : t.upToDate);
      } else if (outcome?.status === 'error') {
        notify(`${t.syncFailed}: ${outcome.error ?? t.unavailable}`);
      } else {
        notify(t.unavailable);
      }
    } catch {
      notify(t.backgroundUnavailable);
    } finally {
      setManualSyncing(false);
    }
  }  const officialKeywordRuleNames = new Map(
    keywordCatalog.packs
      .flatMap((pack) => pack.rules.map((rule) => ({ ...rule, category: pack.id })))
      .map((rule) => [rule.id, rule.name[language]]),
  );
  const personalConfigMergePreview = personalConfigPreview?.merge.preview ?? null;
  const personalConfigReplacePreview = personalConfigPreview?.replace.preview ?? null;
  const personalConfigPreferenceChanges = personalConfigMergePreview
    ? [
        personalConfigMergePreview.languageChange
          ? `${t.languageSetting} → ${
              personalConfigMergePreview.languageChange.to === 'zh' ? '中文' : 'EN'
            }`
          : null,
        personalConfigMergePreview.communityEnabledChange
          ? `${t.enabled} → ${
              personalConfigMergePreview.communityEnabledChange.to
                ? t.personalConfigOn
                : t.personalConfigOff
            }`
          : null,
        personalConfigMergePreview.markStrengthChange
          ? `${t.strength} → ${
              STRENGTH_LABELS[language][personalConfigMergePreview.markStrengthChange.to]
            }`
          : null,
      ].filter((value): value is string => value !== null)
    : [];

  return (
    <div className="view-stack settings-view">
      <section className="settings-card">
        <div className="settings-card-head">
          <h2>{t.autoMarking}</h2>
        </div>
        {community ? (
          <div className="settings-fields">
            <label className="setting-row">
              <span className="setting-copy">
                <strong>{t.enabled}</strong>
              </span>
              <span className="toggle-switch">
                <input
                  type="checkbox"
                  checked={community.enabled}
                  onChange={(event) => void onUpdateCommunity({ enabled: event.target.checked })}
                />
                <span aria-hidden="true" />
              </span>
            </label>

            <div className="setting-block">
              <div className="setting-copy">
                <strong>{t.strength}</strong>
              </div>
              <div className="strength-control" role="group" aria-label={t.strength}>
                {MARK_STRENGTHS.map((strength: MarkStrength) => (
                  <button
                    key={strength}
                    type="button"
                    className={community.strength === strength ? 'is-selected' : ''}
                    onClick={() => void onUpdateCommunity({ strength })}
                  >
                    <span>{STRENGTH_LABELS[language][strength]}</span>
                    <HelpIcon text={STRENGTH_HINTS[language][strength]} />
                  </button>
                ))}
              </div>
            </div>

            <div className="setting-row manual-sync-row">
              <span className="setting-copy">
                <strong>{t.manualSync}</strong>
                <HelpIcon text={t.manualSyncHint} />
              </span>
              <button
                type="button"
                className={`secondary-inline${manualSyncing ? ' is-spinning' : ''}`}
                disabled={manualSyncing}
                onClick={() => void syncAllNow()}
              >
                {manualSyncing ? t.processing : t.manualSyncAction}
              </button>
            </div>
          </div>
        ) : (
          <div className="loading-list settings-loading" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        )}
      </section>

      <section className="settings-card">
        <div className="settings-card-head">
          <h2>{t.privacy}</h2>
        </div>
        {community ? (
          <div className="settings-fields">
            <label className="setting-row">
              <span className="setting-copy">
                <strong>
                  {t.localOnly} <HelpIcon text={t.localOnlyHint} />
                </strong>
              </span>
              <span className="toggle-switch">
                <input
                  type="checkbox"
                  checked={!community.autoContribute}
                  onChange={(event) => void setLocalOnly(event.target.checked)}
                />
                <span aria-hidden="true" />
              </span>
            </label>

            <div className="settings-meta-row">
              {contribution && (contribution.reports > 0 || contribution.rescues > 0) ? (
                <span className="contribution-chip">
                  {t.contribution(contribution.reports, contribution.rescues)}
                </span>
              ) : (
                <span />
              )}
              <button
                type="button"
                className="text-action"
                onClick={() => void copyInstallationId()}
              >
                {t.copyInstallationId}
              </button>
              <HelpIcon text={t.copyInstallationIdHint} />
            </div>
          </div>
        ) : (
          <div className="loading-list settings-loading" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        )}
      </section>

      <section className="settings-card personal-config-card">
        <div className="settings-card-head">
          <h2>
            {t.personalConfig} <HelpIcon text={t.personalConfigHint} />
          </h2>
        </div>
        <div className="personal-config-actions">
          <button
            type="button"
            className="secondary-inline"
            disabled={!keywordRules || !community || personalConfigBusy}
            onClick={exportPersonalConfig}
          >
            {t.exportPersonalConfig}
          </button>
          <button
            type="button"
            className="secondary-inline"
            disabled={!keywordRules || !community || personalConfigBusy}
            onClick={choosePersonalConfigFile}
          >
            {t.importPersonalConfig}
          </button>
        </div>
        <input
          ref={personalConfigInputRef}
          className="personal-config-file-input"
          type="file"
          accept="application/json,.json"
          aria-label={t.importPersonalConfig}
          onChange={(event) => void readPersonalConfigFile(event)}
        />
        {personalConfigError ? (
          <p className="inline-notice result-failure" role="alert">
            {personalConfigError}
          </p>
        ) : null}
        {personalConfigMessage ? (
          <p className="inline-notice" role="status">
            {personalConfigMessage}
          </p>
        ) : null}
        {personalConfigMergePreview && personalConfigReplacePreview ? (
          <div className="personal-config-preview" role="status">
            <strong>{t.personalConfigPreview}</strong>
            <ul>
              <li>
                <strong>{t.personalConfigMerge}</strong>{' '}
                {t.personalConfigCustomPreview(
                  personalConfigMergePreview.customRules.backupCount,
                  personalConfigMergePreview.customRules.resultCount,
                  personalConfigMergePreview.customRules.addedCount,
                  personalConfigMergePreview.customRules.alreadyPresentCount,
                )}
              </li>
              <li>
                <strong>{t.personalConfigReplace}</strong>{' '}
                {t.personalConfigReplaceCustomPreview(
                  personalConfigReplacePreview.customRules.resultCount,
                  personalConfigReplacePreview.customRules.removedCount,
                )}
              </li>
              {personalConfigMergePreview.categoryChanges.length > 0 ? (
                <li>
                  {t.personalConfigCategories(personalConfigMergePreview.categoryChanges.length)}
                  <ul className="personal-config-change-list">
                    {personalConfigMergePreview.categoryChanges.slice(0, 3).map((change) => (
                      <li key={change.id}>
                        {keywordCategoryNames.get(change.id) ?? change.id} →{' '}
                        {change.to ? t.personalConfigOn : t.personalConfigOff}
                      </li>
                    ))}
                    {personalConfigMergePreview.categoryChanges.length > 3 ? (
                      <li>
                        {t.personalConfigMore(personalConfigMergePreview.categoryChanges.length - 3)}
                      </li>
                    ) : null}
                  </ul>
                </li>
              ) : null}
              {personalConfigMergePreview.ruleChanges.length > 0 ? (
                <li>
                  {t.personalConfigRules(personalConfigMergePreview.ruleChanges.length)}
                  <ul className="personal-config-change-list">
                    {personalConfigMergePreview.ruleChanges.slice(0, 3).map((change) => (
                      <li key={change.id}>
                        {officialKeywordRuleNames.get(change.id) ?? change.id} →{' '}
                        {change.to ? t.personalConfigOff : t.personalConfigOn}
                      </li>
                    ))}
                    {personalConfigMergePreview.ruleChanges.length > 3 ? (
                      <li>
                        {t.personalConfigMore(personalConfigMergePreview.ruleChanges.length - 3)}
                      </li>
                    ) : null}
                  </ul>
                </li>
              ) : null}
              {personalConfigPreferenceChanges.length > 0 ? (
                <li>
                  {t.personalConfigPreferences(personalConfigPreferenceChanges.length)}
                  <ul className="personal-config-change-list">
                    {personalConfigPreferenceChanges.map((label) => (
                      <li key={label}>{label}</li>
                    ))}
                  </ul>
                </li>
              ) : null}
              {personalConfigMergePreview.ignoredCategoryIds.length > 0 ||
              personalConfigMergePreview.ignoredRuleIds.length > 0 ? (
                <li>
                  {t.personalConfigIgnored(
                    personalConfigMergePreview.ignoredCategoryIds.length,
                    personalConfigMergePreview.ignoredRuleIds.length,
                  )}
                </li>
              ) : null}
              {personalConfigMergePreview.categoryChanges.length === 0 &&
              personalConfigMergePreview.ruleChanges.length === 0 &&
              personalConfigPreferenceChanges.length === 0 &&
              personalConfigMergePreview.customRules.addedCount === 0 &&
              personalConfigReplacePreview.customRules.removedCount === 0 ? (
                <li>{t.personalConfigNoChanges}</li>
              ) : null}
            </ul>
            {personalConfigPreview?.merge.preview.customRules.exceedsLimit ? (
              <p className="result-failure">
                {t.personalConfigMergeLimit(
                  personalConfigPreview.merge.preview.customRules.resultCount,
                )}
              </p>
            ) : null}
            <div className="personal-config-actions personal-config-preview-actions">
              <button
                type="button"
                className="secondary-inline"
                disabled={personalConfigBusy || !personalConfigPreview?.merge.next}
                onClick={() => void applyPersonalConfig('merge')}
              >
                {t.personalConfigMerge}
              </button>
              <button
                type="button"
                className="secondary-inline"
                disabled={personalConfigBusy || !personalConfigPreview?.replace.next}
                onClick={() => void applyPersonalConfig('replace')}
              >
                {t.personalConfigReplace}
              </button>
              <button
                type="button"
                className="text-action"
                disabled={personalConfigBusy}
                onClick={() => setPersonalConfigPreview(null)}
              >
                {t.personalConfigCancel}
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <section className="settings-card language-card">
        <div className="setting-row static-row">
          <span className="setting-copy">
            <strong>{t.languageSetting}</strong>
          </span>
          <div className="language-control" role="group" aria-label={t.language}>
            <button
              type="button"
              className={language === 'zh' ? 'is-selected' : ''}
              aria-pressed={language === 'zh'}
              onClick={() => void selectLanguage('zh')}
            >
              中文
            </button>
            <button
              type="button"
              className={language === 'en' ? 'is-selected' : ''}
              aria-pressed={language === 'en'}
              onClick={() => void selectLanguage('en')}
            >
              EN
            </button>
          </div>
        </div>
      </section>

      <section className="settings-card about-card">
        <div className="setting-row static-row">
          <span className="setting-copy">
            <strong>{t.aboutLinks}</strong>
          </span>
          <div className="about-links">
            <a
              href="https://github.com/realchendahuang/feedsieve"
              target="_blank"
              rel="noreferrer noopener"
            >
              {t.githubLink}
            </a>
            <a href="https://feedsieve.win" target="_blank" rel="noreferrer noopener">
              {t.officialSiteLink}
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
