import { useEffect, useState } from 'react';
import type { MarkStrength } from '@feedsieve/community-lists';
import type { CommunitySettings } from '../../../../src/lib/community/community-store';
import type { KeywordRuleSettings } from '../../../../src/lib/detection/keyword-rules';
import { getKeywordRuleSettings } from '../../../../src/lib/detection/keyword-rules';
import {
  BUNDLED_KEYWORD_PACK_CATALOG,
  getKeywordPackCatalog,
  type KeywordPackCatalog,
} from '../../../../src/lib/detection/keyword-packs';
import { MODULES, type ModuleDef } from '../../../../src/lib/settings/modules';
import type { ModuleSettings } from '../../../../src/lib/settings/module-settings';
import { setUiLanguage, UI_COPY, type UiLanguage } from '../../../../src/lib/platform/i18n';
import { AppIcon, Toggle } from '../shared';
import BackupRow from './BackupRow';
import type { GlobalPage } from './pages';
import { ClearProfilesButton, extensionVersion, NavRow, Row } from './shared';

interface GlobalViewProps {
  language: UiLanguage;
  notify: (message: string | null) => void;
  page: GlobalPage;
  onNavigate: (page: GlobalPage) => void;
  community: CommunitySettings | null;
  onUpdateCommunity: (patch: {
    enabled?: boolean;
    autoContribute?: boolean;
    hotContribute?: boolean;
    hitContribute?: boolean;
    strength?: MarkStrength;
  }) => Promise<unknown>;
  onLanguageChange: (next: UiLanguage) => void;
  onSyncCommunity: () => Promise<void>;
  modules: ModuleSettings | null;
  onUpdateModule: (patch: Partial<ModuleSettings>) => void;
}

/** 模块开关的说明：不跟着 tab 名走，单独给每个模块一句「关了会怎样」。 */
function moduleHint(t: (typeof UI_COPY)[UiLanguage], module: ModuleDef): string {
  switch (module.id) {
    case 'hot':
      return t.moduleHotHint;
    case 'profile':
      return t.moduleProfileHint;
    case 'write':
      return t.moduleWriteHint;
    case 'ai':
      return t.moduleAiModuleHint;
    case 'filter':
      return t.moduleFilterHint;
  }
}

export default function GlobalView({
  language,
  notify,
  page,
  onNavigate,
  community,
  onUpdateCommunity,
  onLanguageChange,
  onSyncCommunity,
  modules,
  onUpdateModule,
}: GlobalViewProps) {
  const t = UI_COPY[language];
  const [keywordRules, setKeywordRules] = useState<KeywordRuleSettings | null>(null);
  const [catalog, setCatalog] = useState<KeywordPackCatalog>(BUNDLED_KEYWORD_PACK_CATALOG);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    void getKeywordRuleSettings().then(setKeywordRules);
    void getKeywordPackCatalog().then(setCatalog);
  }, []);

  if (!community) {
    return (
      <div className="view settings-view">
        <div className="loading-list" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </div>
    );
  }

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
    }
  }

  async function syncNow(): Promise<void> {
    setSyncing(true);
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
        notify(t.backgroundUnavailable);
      }
    } catch {
      notify(t.backgroundUnavailable);
    } finally {
      setSyncing(false);
    }
  }

  if (page === 'data' || page === 'about') {
    return (
      <div className="view settings-view">
        <header className="subpage-head">
          <button
            type="button"
            className="back-button"
            aria-label={`${t.goBack} · ${t.globalNav}`}
            onClick={() => onNavigate('global')}
          >
            <AppIcon name="chevron" size={14} className="is-back" />
            {t.globalNav}
          </button>
          <h2>{page === 'data' ? t.groupData : t.about}</h2>
        </header>

        {page === 'data' ? (
          <section className="group">
            <Row label={t.localOnly} hint={t.localOnlyHint}>
              <Toggle
                checked={!community.autoContribute}
                label={t.localOnly}
                onChange={(localOnly) => void setLocalOnly(localOnly)}
              />
            </Row>
            <Row label={t.hotContribute} hint={t.hotContributeHint}>
              <Toggle
                checked={community.autoContribute && community.hotContribute}
                disabled={!community.autoContribute}
                label={t.hotContribute}
                onChange={(hotContribute) => void onUpdateCommunity({ hotContribute })}
              />
            </Row>
            <Row label={t.hitContribute} hint={t.hitContributeHint}>
              <Toggle
                checked={community.autoContribute && community.hitContribute}
                disabled={!community.autoContribute}
                label={t.hitContribute}
                onChange={(hitContribute) => void onUpdateCommunity({ hitContribute })}
              />
            </Row>
            <Row label={t.manualSync} hint={t.manualSyncHint}>
              <button
                type="button"
                className="text-button"
                disabled={syncing}
                onClick={() => void syncNow()}
              >
                {syncing ? t.processing : t.manualSyncAction}
              </button>
            </Row>
            <Row label={t.profileClear} hint={t.profileClearHint}>
              <ClearProfilesButton language={language} notify={notify} />
            </Row>
            <BackupRow
              language={language}
              keywordRules={keywordRules}
              setKeywordRules={setKeywordRules}
              catalog={catalog}
              community={community}
              onUpdateCommunity={onUpdateCommunity}
              onLanguageChange={onLanguageChange}
            />
          </section>
        ) : (
          <section className="group">
            <Row label={t.officialSiteLink}>
              <a
                className="text-button"
                href="https://feedsieve.win"
                target="_blank"
                rel="noreferrer noopener"
              >
                feedsieve.win
              </a>
            </Row>
            <Row label={t.githubLink}>
              <a
                className="text-button"
                href="https://github.com/realchendahuang/feedsieve"
                target="_blank"
                rel="noreferrer noopener"
              >
                realchendahuang/feedsieve
              </a>
            </Row>
            <Row label={t.weekly}>
              <a
                className="text-button"
                href="https://feedsieve.win/weekly"
                target="_blank"
                rel="noreferrer noopener"
              >
                feedsieve.win/weekly
              </a>
            </Row>
            <Row label={t.versionLabel}>
              <span className="row-meta">{extensionVersion() || '—'}</span>
            </Row>
          </section>
        )}
      </div>
    );
  }

  return (
    <div className="view settings-view">
      <section className="group">
        <h3 className="group-title">{t.moduleSwitches}</h3>
        {MODULES.map((module) => {
          const label = t[module.labelKey];
          return (
            <Row key={module.id} label={label} hint={moduleHint(t, module)}>
              <Toggle
                checked={modules ? module.enabled(modules) : true}
                disabled={modules === null}
                label={label}
                onChange={(enabled) => onUpdateModule({ [module.settingKey]: enabled })}
              />
            </Row>
          );
        })}
      </section>

      <section className="group">
        <h3 className="group-title">{t.general}</h3>
        <Row label={t.moduleShare} hint={t.moduleShareHint}>
          <Toggle
            checked={modules?.shareMenu ?? true}
            disabled={modules === null}
            label={t.moduleShare}
            onChange={(enabled) => onUpdateModule({ shareMenu: enabled })}
          />
        </Row>
        <Row label={t.languageSetting}>
          <div className="segmented" role="group" aria-label={t.language}>
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
        </Row>
      </section>

      <section className="group">
        <NavRow label={t.groupData} onOpen={() => onNavigate('data')} />
        <NavRow label={t.about} onOpen={() => onNavigate('about')} />
      </section>
    </div>
  );
}
