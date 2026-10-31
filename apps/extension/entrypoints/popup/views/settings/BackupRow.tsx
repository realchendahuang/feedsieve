import { useRef, useState, type ChangeEvent } from 'react';
import type { KeywordRuleSettings } from '../../../../src/lib/detection/keyword-rules';
import { replaceKeywordRuleSettings } from '../../../../src/lib/detection/keyword-rules';
import type { KeywordPackCatalog } from '../../../../src/lib/detection/keyword-packs';
import type { CommunitySettings } from '../../../../src/lib/community/community-store';
import {
  createPersonalConfigDocument,
  MAX_PERSONAL_CONFIG_BYTES,
  parsePersonalConfigDocument,
  preparePersonalConfigImport,
  serializePersonalConfigDocument,
  type PersonalConfigImportMode,
  type PersonalConfigImportResult,
  type PersonalConfigParseError,
} from '../../../../src/lib/settings/personal-config';
import { setUiLanguage, UI_COPY, type UiLanguage } from '../../../../src/lib/platform/i18n';
import type { MarkStrength } from '@feedsieve/community-lists';
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

  function exportConfig(): void {
    if (!keywordRules) return;
    setError(null);
    setMessage(null);
    try {
      const body = serializePersonalConfigDocument(
        createPersonalConfigDocument({ keywordRules, community, language, catalog }),
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
      const context = { keywordRules, community, language, catalog };
      setPreview({
        merge: preparePersonalConfigImport(parsed.document, context, 'merge'),
        replace: preparePersonalConfigImport(parsed.document, context, 'replace'),
      });
    } catch {
      setError(t.personalConfigReadFailed);
    }
  }

  async function apply(mode: PersonalConfigImportMode): Promise<void> {
    const prepared = preview?.[mode];
    if (!prepared?.next || busy) return;
    setBusy(true);
    setError(null);
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
      setPreview(null);
      flash(UI_COPY[prepared.next.preferences.uiLanguage].personalConfigImported);
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
          ? `${t.enabled} → ${
              merge.communityEnabledChange.to ? t.personalConfigOn : t.personalConfigOff
            }`
          : null,
        merge.markStrengthChange
          ? `${t.strength} → ${STRENGTH_LABELS[language][merge.markStrengthChange.to]}`
          : null,
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
            onClick={exportConfig}
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
