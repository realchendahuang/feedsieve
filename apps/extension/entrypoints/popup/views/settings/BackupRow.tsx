import type { MarkStrength } from '@feedsieve/community-lists';
import { useRef, useState, type ChangeEvent } from 'react';
import { getAiSettings, setAiSettings } from '../../../../src/lib/ai-check/client';
import type { CommunitySettings } from '../../../../src/lib/community/community-settings';
import {
  getScheduleSettings,
  setScheduleSettings,
} from '../../../../src/lib/compose/schedule-store';
import type { KeywordPackCatalog } from '../../../../src/lib/detection/keyword-packs';
import type { KeywordRuleSettings } from '../../../../src/lib/detection/keyword-rules';
import { replaceKeywordRuleSettings } from '../../../../src/lib/detection/keyword-rules';
import {
  getInsightBadgesEnabled,
  getProfileLineEnabled,
  setInsightBadgesEnabled,
  setProfileLineEnabled,
} from '../../../../src/lib/insight/insight-settings';
import { setUiLanguage, UI_COPY, type UiLanguage } from '../../../../src/lib/platform/i18n';
import {
  getModuleSettings,
  setModuleSettings,
  type ModuleSettings,
} from '../../../../src/lib/settings/module-settings';
import {
  createPersonalConfigDocument,
  MAX_PERSONAL_CONFIG_BYTES,
  parsePersonalConfigDocument,
  preparePersonalConfigImport,
  serializePersonalConfigDocument,
  type PersonalConfigContext,
  type PersonalConfigImportMode,
  type PersonalConfigImportResult,
  type PersonalConfigParseError,
} from '../../../../src/lib/settings/personal-config';
import {
  getSearchAssistEnabled,
  getSearchAssistPrefs,
  setSearchAssistEnabled,
  setSearchAssistPrefs,
} from '../../../../src/lib/settings/search-assist';
import { getUiSettings, setUiSettings } from '../../../../src/lib/settings/ui-settings';
import { HelpIcon, STRENGTH_LABELS } from '../shared';

interface PreviewState {
  merge: PersonalConfigImportResult;
  replace: PersonalConfigImportResult;
}

interface BackupRowProps {
  language: UiLanguage;
  keywordRules: KeywordRuleSettings | null;
  setKeywordRules: (next: KeywordRuleSettings) => void;
  catalog: KeywordPackCatalog;
  community: CommunitySettings;
  onUpdateCommunity: (patch: { enabled?: boolean; strength?: MarkStrength }) => Promise<unknown>;
  onLanguageChange: (next: UiLanguage) => void;
  modules?: ModuleSettings | null;
  onUpdateModule?: (patch: Partial<ModuleSettings>) => Promise<unknown> | void;
}

/** 备份与迁移：导出个人配置；导入前先给预览，再选合并或替换。 */
export default function BackupRow({
  language,
  keywordRules,
  setKeywordRules,
  catalog,
  community,
  onUpdateCommunity,
  onLanguageChange,
  modules,
  onUpdateModule,
}: BackupRowProps) {
  const t = UI_COPY[language];
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function errorMessage(code: PersonalConfigParseError): string {
    switch (code) {
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

  /** 成功提示 4 秒后自动消失；错误提示保留。 */
  function flash(text: string): void {
    setMessage(text);
    window.setTimeout(() => setMessage((current) => (current === text ? null : current)), 4_000);
  }

  async function loadLocalExtras(): Promise<
    Pick<
      PersonalConfigContext,
      'uiSettings' | 'composeSchedule' | 'modules' | 'searchAssist' | 'insight' | 'aiDisplay'
    >
  > {
    const [
      uiSettings,
      composeSchedule,
      loadedModules,
      saEnabled,
      saPrefs,
      badges,
      profileLine,
      aiDisplay,
    ] = await Promise.all([
      getUiSettings(),
      getScheduleSettings(),
      modules ? Promise.resolve(modules) : getModuleSettings(),
      getSearchAssistEnabled(),
      getSearchAssistPrefs(),
      getInsightBadgesEnabled(),
      getProfileLineEnabled(),
      getAiSettings(),
    ]);
    return {
      uiSettings,
      composeSchedule,
      modules: loadedModules,
      searchAssist: { enabled: saEnabled, prefs: saPrefs },
      insight: { badges, profileLine },
      aiDisplay,
    };
  }

  async function exportConfig(): Promise<void> {
    if (!keywordRules || busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const extras = await loadLocalExtras();
      const body = serializePersonalConfigDocument(
        createPersonalConfigDocument({ keywordRules, community, language, catalog, ...extras }),
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
      flash(t.personalConfigExported);
    } catch {
      setError(t.personalConfigExportFailed);
    } finally {
      setBusy(false);
    }
  }

  function chooseFile(): void {
    if (!keywordRules || busy) return;
    setError(null);
    setMessage(null);
    inputRef.current?.click();
  }

  async function readFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.currentTarget.files?.[0];
    // 同一文件再次选择时也要触发 change；读取后立即清空 input
    event.currentTarget.value = '';
    if (!file || !keywordRules) return;
    setError(null);
    setMessage(null);
    setPreview(null);
    if (file.size > MAX_PERSONAL_CONFIG_BYTES) {
      setError(t.personalConfigFileTooLarge);
      return;
    }
    try {
      const parsed = parsePersonalConfigDocument(await file.text());
      if (!parsed.ok) {
        setError(errorMessage(parsed.error));
        return;
      }
      const doc = parsed.document;
      const hasExtras = Boolean(
        doc.uiSettings ||
        doc.composeSchedule ||
        doc.modules ||
        doc.searchAssist ||
        doc.insight ||
        doc.aiDisplay,
      );
      const extras = hasExtras ? await loadLocalExtras() : {};
      const context: PersonalConfigContext = {
        keywordRules,
        community,
        language,
        catalog,
        ...extras,
      };
      setPreview({
        merge: preparePersonalConfigImport(doc, context, 'merge'),
        replace: preparePersonalConfigImport(doc, context, 'replace'),
      });
    } catch {
      setError(t.personalConfigReadFailed);
    }
  }

  async function apply(mode: PersonalConfigImportMode): Promise<void> {
    const prepared = preview?.[mode];
    if (!prepared?.next || busy) return;
    const next = prepared.next;
    setBusy(true);
    setError(null);
    try {
      const [nextKeywordRules] = await Promise.all([
        replaceKeywordRuleSettings(next.keywordRules),
        onUpdateCommunity({
          enabled: next.preferences.communityEnabled,
          strength: next.preferences.markStrength,
        }),
        next.uiSettings ? setUiSettings(next.uiSettings) : Promise.resolve(),
        next.composeSchedule ? setScheduleSettings(next.composeSchedule) : Promise.resolve(),
        next.modules
          ? onUpdateModule
            ? Promise.resolve(onUpdateModule(next.modules))
            : setModuleSettings(next.modules)
          : Promise.resolve(),
        next.searchAssist
          ? Promise.all([
              setSearchAssistEnabled(next.searchAssist.enabled),
              setSearchAssistPrefs(next.searchAssist.prefs),
            ])
          : Promise.resolve(),
        next.insight
          ? Promise.all([
              setInsightBadgesEnabled(next.insight.badges),
              setProfileLineEnabled(next.insight.profileLine),
            ])
          : Promise.resolve(),
        next.aiDisplay ? setAiSettings(next.aiDisplay) : Promise.resolve(),
      ]);
      await setUiLanguage(next.preferences.uiLanguage);
      setKeywordRules(nextKeywordRules);
      onLanguageChange(next.preferences.uiLanguage);
      setPreview(null);
      flash(UI_COPY[next.preferences.uiLanguage].personalConfigImported);
    } catch {
      setError(t.personalConfigApplyFailed);
    } finally {
      setBusy(false);
    }
  }

  const categoryNames = new Map(catalog.packs.map((pack) => [pack.id, pack.name[language]]));
  const ruleNames = new Map(
    catalog.packs.flatMap((pack) => pack.rules).map((rule) => [rule.id, rule.name[language]]),
  );
  const merge = preview?.merge.preview ?? null;
  const replace = preview?.replace.preview ?? null;
  const preferenceChanges = merge
    ? [
        merge.languageChange
          ? `${t.languageSetting} → ${merge.languageChange.to === 'zh' ? '中文' : 'EN'}`
          : null,
        merge.communityEnabledChange
          ? `${t.manualSync} → ${
              merge.communityEnabledChange.to ? t.personalConfigOn : t.personalConfigOff
            }`
          : null,
        merge.markStrengthChange
          ? `${t.strength} → ${STRENGTH_LABELS[language][merge.markStrengthChange.to]}`
          : null,
        ...merge.sectionChanges.map((change) =>
          t.personalConfigSection(change.section, change.changedCount),
        ),
      ].filter((value): value is string => value !== null)
    : [];

  return (
    <>
      <div className="row">
        <div className="row-label">
          <span>{t.personalConfig}</span>
          <HelpIcon text={t.personalConfigHint} />
        </div>
        <div className="row-control">
          <button
            type="button"
            className="text-button"
            disabled={!keywordRules || busy}
            onClick={() => void exportConfig()}
          >
            {t.exportPersonalConfig}
          </button>
          <button
            type="button"
            className="text-button"
            disabled={!keywordRules || busy}
            onClick={chooseFile}
          >
            {t.importPersonalConfig}
          </button>
        </div>
        <input
          ref={inputRef}
          className="visually-hidden-input"
          type="file"
          accept="application/json,.json"
          aria-label={t.importPersonalConfig}
          onChange={(event) => void readFile(event)}
        />
      </div>
      {error ? (
        <p className="alert" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="result" role="status">
          {message}
        </p>
      ) : null}
      {merge && replace ? (
        <div className="import-preview" role="status">
          <strong>{t.personalConfigPreview}</strong>
          <ul>
            <li>
              <b>{t.personalConfigMerge}</b>{' '}
              {t.personalConfigCustomPreview(
                merge.customRules.backupCount,
                merge.customRules.resultCount,
                merge.customRules.addedCount,
                merge.customRules.alreadyPresentCount,
              )}
            </li>
            <li>
              <b>{t.personalConfigReplace}</b>{' '}
              {t.personalConfigReplaceCustomPreview(
                replace.customRules.resultCount,
                replace.customRules.removedCount,
              )}
            </li>
            {merge.categoryChanges.length > 0 ? (
              <li>
                {t.personalConfigCategories(merge.categoryChanges.length)}
                <ul>
                  {merge.categoryChanges.slice(0, 3).map((change) => (
                    <li key={change.id}>
                      {categoryNames.get(change.id) ?? change.id} →{' '}
                      {change.to ? t.personalConfigOn : t.personalConfigOff}
                    </li>
                  ))}
                  {merge.categoryChanges.length > 3 ? (
                    <li>{t.personalConfigMore(merge.categoryChanges.length - 3)}</li>
                  ) : null}
                </ul>
              </li>
            ) : null}
            {merge.ruleChanges.length > 0 ? (
              <li>
                {t.personalConfigRules(merge.ruleChanges.length)}
                <ul>
                  {merge.ruleChanges.slice(0, 3).map((change) => (
                    <li key={change.id}>
                      {ruleNames.get(change.id) ?? change.id} →{' '}
                      {change.to ? t.personalConfigOff : t.personalConfigOn}
                    </li>
                  ))}
                  {merge.ruleChanges.length > 3 ? (
                    <li>{t.personalConfigMore(merge.ruleChanges.length - 3)}</li>
                  ) : null}
                </ul>
              </li>
            ) : null}
            {preferenceChanges.length > 0 ? (
              <li>
                {t.personalConfigPreferences(preferenceChanges.length)}
                <ul>
                  {preferenceChanges.map((label) => (
                    <li key={label}>{label}</li>
                  ))}
                </ul>
              </li>
            ) : null}
            {merge.ignoredCategoryIds.length > 0 || merge.ignoredRuleIds.length > 0 ? (
              <li>
                {t.personalConfigIgnored(
                  merge.ignoredCategoryIds.length,
                  merge.ignoredRuleIds.length,
                )}
              </li>
            ) : null}
            {merge.categoryChanges.length === 0 &&
            merge.ruleChanges.length === 0 &&
            preferenceChanges.length === 0 &&
            merge.customRules.addedCount === 0 &&
            replace.customRules.removedCount === 0 ? (
              <li>{t.personalConfigNoChanges}</li>
            ) : null}
          </ul>
          {merge.customRules.exceedsLimit ? (
            <p className="alert">{t.personalConfigMergeLimit(merge.customRules.resultCount)}</p>
          ) : null}
          <div className="button-row">
            <button
              type="button"
              className="secondary-button"
              disabled={busy || !preview?.merge.next}
              onClick={() => void apply('merge')}
            >
              {t.personalConfigMerge}
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={busy || !preview?.replace.next}
              onClick={() => void apply('replace')}
            >
              {t.personalConfigReplace}
            </button>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => setPreview(null)}
            >
              {t.personalConfigCancel}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
