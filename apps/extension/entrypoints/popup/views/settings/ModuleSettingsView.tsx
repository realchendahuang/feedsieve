import { useEffect, useState } from 'react';
import { MARK_STRENGTHS, type MarkStrength, type WhitelistEntry } from '@feedsieve/community-lists';
import {
  getKeywordRuleSettings,
  isOfficialKeywordCategorySubscribed,
  subscribeKeywordRules,
  type KeywordRuleSettings,
} from '../../../../src/lib/detection/keyword-rules';
import {
  BUNDLED_KEYWORD_PACK_CATALOG,
  getKeywordPackCatalog,
  subscribeKeywordPackCatalog,
  type KeywordPackCatalog,
} from '../../../../src/lib/detection/keyword-packs';
import type { CommunitySettings } from '../../../../src/lib/community/community-store';
import {
  DEFAULT_PRESET,
  getSafetyBudgetOverride,
  SAFETY_PRESETS,
  setSafetyBudgetOverride,
} from '../../../../src/lib/queue/block-safety';
import { UI_COPY, type UiLanguage } from '../../../../src/lib/platform/i18n';
import {
  getInsightBadgesEnabled,
  getProfileLineEnabled,
  setInsightBadgesEnabled,
  setProfileLineEnabled,
  subscribeInsightBadges,
  subscribeProfileLineEnabled,
} from '../../../../src/lib/insight/insight-settings';
import {
  getSearchAssistEnabled,
  setSearchAssistEnabled,
  subscribeSearchAssistEnabled,
} from '../../../../src/lib/settings/search-assist';
import {
  getScheduleSettings,
  setScheduleSettings,
  subscribeScheduleSettings,
} from '../../../../src/lib/compose/schedule-store';
import type { ScheduleSettings } from '../../../../src/lib/compose/schedule-slots';
import type { ModuleSettings } from '../../../../src/lib/settings/module-settings';
import type { ModuleDef } from '../../../../src/lib/settings/modules';
import {
  getUiSettings,
  setUiSettings,
  subscribeUiSettings,
  type UiSettings,
} from '../../../../src/lib/settings/ui-settings';
import {
  SkeletonList,
  STRENGTH_HINTS,
  STRENGTH_LABELS,
  SubpageHeader,
  Toggle,
} from '../shared';
import KeywordsView from '../KeywordsView';
import { AiDisplaySettings } from './AiDisplaySettings';
import CadencePage from './CadencePage';
import BlockedPage from './BlockedPage';
import AllowlistPage from './AllowlistPage';
import FollowingPage from './FollowingPage';
import type { SubpageSendToXPage } from './types';
import type { SettingsPage } from './pages';
import { NavRow, Row } from './shared';

interface ModuleSettingsViewProps {
  module: ModuleDef;
  page: SettingsPage;
  language: UiLanguage;
  notify: (message: string | null) => void;
  community: CommunitySettings | null;
  onUpdateCommunity: (patch: {
    enabled?: boolean;
    strength?: MarkStrength;
  }) => Promise<unknown>;
  modules: ModuleSettings | null;
  onUpdateModule: (patch: Partial<ModuleSettings>) => void;
  onNavigate: (page: SettingsPage) => void;
  /** 返回模块原页面（关闭齿轮页） */
  onClose: () => void;
  sendToXPage: SubpageSendToXPage;
  refreshPageMarked: () => Promise<void>;
  pauseDestructive: boolean;
  counts: { blocked: number | null; allowlist: number | null; following: number | null };
  recommendList: WhitelistEntry[];
}

const FILTER_SUBPAGES: ReadonlySet<SettingsPage> = new Set([
  'keywords',
  'blocked',
  'allowlist',
  'following',
]);

export default function ModuleSettingsView({
  module,
  page,
  language,
  notify,
  community,
  onUpdateCommunity,
  modules,
  onUpdateModule,
  onNavigate,
  onClose,
  sendToXPage,
  refreshPageMarked,
  pauseDestructive,
  counts,
  recommendList,
}: ModuleSettingsViewProps) {
  const t = UI_COPY[language];
  const [keywordRules, setKeywordRules] = useState<KeywordRuleSettings | null>(null);
  const [catalog, setCatalog] = useState<KeywordPackCatalog>(BUNDLED_KEYWORD_PACK_CATALOG);
  const [budgetDraft, setBudgetDraft] = useState<string | null>(null);
  const [insightBadges, setInsightBadges] = useState<boolean | null>(null);
  const [profileLine, setProfileLine] = useState<boolean | null>(null);
  const [searchAssist, setSearchAssist] = useState<boolean | null>(null);
  const [ui, setUi] = useState<UiSettings | null>(null);
  const [schedule, setSchedule] = useState<ScheduleSettings | null>(null);

  useEffect(() => {
    void getInsightBadgesEnabled().then(setInsightBadges);
    void getProfileLineEnabled().then(setProfileLine);
    void getSearchAssistEnabled().then(setSearchAssist);
    void getUiSettings().then(setUi);
    void getScheduleSettings().then(setSchedule);
    void getSafetyBudgetOverride().then((value) =>
      setBudgetDraft(String(value ?? SAFETY_PRESETS[DEFAULT_PRESET].dailyLimit)),
    );
    void getKeywordRuleSettings().then(setKeywordRules);
    void getKeywordPackCatalog().then(setCatalog);
    const unsubs = [
      subscribeInsightBadges(setInsightBadges),
      subscribeProfileLineEnabled(setProfileLine),
      subscribeSearchAssistEnabled(setSearchAssist),
      subscribeUiSettings(setUi),
      subscribeScheduleSettings(setSchedule),
      subscribeKeywordRules(setKeywordRules),
      subscribeKeywordPackCatalog(setCatalog),
    ];
    return () => {
      for (const unsubscribe of unsubs) unsubscribe();
    };
  }, []);

  async function updateUi(key: keyof UiSettings, enabled: boolean): Promise<void> {
    setUi((prev) => (prev ? { ...prev, [key]: enabled } : prev));
    await setUiSettings({ [key]: enabled });
  }

  async function updateComposeAssist(enabled: boolean): Promise<void> {
    setSchedule((prev) =>
      prev ? { ...prev, composeHelper: enabled, articleHelper: enabled } : prev,
    );
    await setScheduleSettings({ composeHelper: enabled, articleHelper: enabled });
  }

  async function commitBudget(): Promise<void> {
    if (budgetDraft == null) return;
    const trimmed = budgetDraft.trim();
    if (trimmed.length === 0) {
      await setSafetyBudgetOverride(null);
      setBudgetDraft(String(SAFETY_PRESETS[DEFAULT_PRESET].dailyLimit));
      notify(t.budgetAdaptive);
      return;
    }
    const value = Math.round(Number(trimmed));
    if (!Number.isFinite(value) || value < 1) {
      notify(t.budgetInvalid);
      setBudgetDraft(
        String(
          (await getSafetyBudgetOverride()) ?? SAFETY_PRESETS[DEFAULT_PRESET].dailyLimit,
        ),
      );
      return;
    }
    await setSafetyBudgetOverride(value);
    setBudgetDraft(String(value));
    notify(
      value > SAFETY_PRESETS.aggressive.dailyLimit
        ? t.budgetHighRisk(value)
        : t.budgetUpdated(value),
    );
  }

  if (!community) {
    return (
      <div className="view settings-view">
        <SkeletonList />
      </div>
    );
  }

  const title = (() => {
    switch (page) {
      case 'hotSettings':
        return t.hotSettings;
      case 'profileSettings':
        return t.profileSettings;
      case 'writeSettings':
        return t.writeSettings;
      case 'aiSettings':
        return t.aiSettings;
      case 'filterSettings':
        return t.filterSettings;
      case 'filterRules':
        return t.filterRules;
      case 'cleanUi':
        return t.moduleClean;
      case 'keywords':
        return t.keywords;
      case 'blocked':
        return t.manageBlocked;
      case 'allowlist':
        return t.falsePositiveList;
      case 'following':
        return t.followingTab;
      default:
        return t.settings;
    }
  })();

  const backLabel = (() => {
    if (page === module.settingsPage) return t[module.labelKey];
    if (FILTER_SUBPAGES.has(page)) return t.filterRules;
    return t.filterSettings;
  })();

  const onBack = (): void => {
    if (page === module.settingsPage) {
      onClose();
      return;
    }
    onNavigate(FILTER_SUBPAGES.has(page) ? 'filterRules' : 'filterSettings');
  };

  const keywordMeta = keywordRules
    ? t.keywordSummary(
        keywordRules.customRules.length,
        catalog.packs.filter((pack) => isOfficialKeywordCategorySubscribed(keywordRules, pack.id))
          .length,
      )
    : null;
  const strengthHint = MARK_STRENGTHS.map(
    (strength) => `${STRENGTH_LABELS[language][strength]}：${STRENGTH_HINTS[language][strength]}`,
  ).join('\n');

  return (
    <div className="view settings-view">
      <SubpageHeader
        language={language}
        title={title}
        backLabel={backLabel}
        onBack={onBack}
      />

      {page === 'hotSettings' ? (
        <section className="group">
          <Row label={t.insightBadges} hint={t.insightBadgesHint}>
            <Toggle
              checked={insightBadges ?? true}
              disabled={insightBadges === null}
              label={t.insightBadges}
              onChange={(enabled) => {
                setInsightBadges(enabled);
                void setInsightBadgesEnabled(enabled);
              }}
            />
          </Row>
        </section>
      ) : null}

      {page === 'profileSettings' ? (
        <section className="group">
          <Row label={t.profileLine} hint={t.profileLineHint}>
            <Toggle
              checked={profileLine ?? false}
              disabled={profileLine === null}
              label={t.profileLine}
              onChange={(enabled) => {
                setProfileLine(enabled);
                void setProfileLineEnabled(enabled);
              }}
            />
          </Row>
          <Row label={t.searchAssist} hint={t.searchAssistHint}>
            <Toggle
              checked={searchAssist ?? false}
              disabled={searchAssist === null}
              label={t.searchAssist}
              onChange={(enabled) => {
                setSearchAssist(enabled);
                void setSearchAssistEnabled(enabled);
              }}
            />
          </Row>
        </section>
      ) : null}

      {page === 'writeSettings' ? (
        <>
          <section className="group">
            <Row label={t.moduleCompose} hint={t.moduleComposeHint}>
              <Toggle
                checked={schedule ? schedule.composeHelper || schedule.articleHelper : true}
                disabled={schedule === null}
                label={t.moduleCompose}
                onChange={(enabled) => void updateComposeAssist(enabled)}
              />
            </Row>
            <Row label={t.composeHelper} hint={t.composeHelperHint}>
              <Toggle
                checked={schedule?.composeHelper ?? true}
                disabled={schedule === null}
                label={t.composeHelper}
                onChange={(composeHelper) =>
                  void setScheduleSettings({ composeHelper }).then(setSchedule)
                }
              />
            </Row>
            <Row label={t.articleHelper} hint={t.articleHelperHint}>
              <Toggle
                checked={schedule?.articleHelper ?? true}
                disabled={schedule === null}
                label={t.articleHelper}
                onChange={(articleHelper) =>
                  void setScheduleSettings({ articleHelper }).then(setSchedule)
                }
              />
            </Row>
          </section>
          {schedule ? (
            <CadencePage language={language} schedule={schedule} notify={notify} />
          ) : null}
        </>
      ) : null}

      {page === 'aiSettings' ? (
        <>
          <section className="group">
            <Row label={t.moduleAi} hint={t.moduleAiHint}>
              <Toggle
                checked={modules?.aiCheck ?? true}
                disabled={modules === null}
                label={t.moduleAi}
                onChange={(enabled) => onUpdateModule({ aiCheck: enabled })}
              />
            </Row>
          </section>
          <AiDisplaySettings language={language} />
        </>
      ) : null}

      {page === 'filterSettings' ? (
        <section className="group">
          <Row label={t.autoMark} hint={t.autoMarkHint}>
            <Toggle
              checked={community.enabled}
              label={t.autoMark}
              onChange={(enabled) => void onUpdateCommunity({ enabled })}
            />
          </Row>
          <NavRow label={t.moduleClean} onOpen={() => onNavigate('cleanUi')} />
          <NavRow label={t.filterRules} onOpen={() => onNavigate('filterRules')} />
        </section>
      ) : null}

      {page === 'filterRules' ? (
        <section className="group">
          <Row label={t.strength} hint={strengthHint}>
            <div className="segmented" role="group" aria-label={t.strength}>
              {MARK_STRENGTHS.map((strength: MarkStrength) => (
                <button
                  key={strength}
                  type="button"
                  className={community.strength === strength ? 'is-selected' : ''}
                  aria-pressed={community.strength === strength}
                  onClick={() => void onUpdateCommunity({ strength })}
                >
                  {STRENGTH_LABELS[language][strength]}
                </button>
              ))}
            </div>
          </Row>
          <NavRow label={t.keywords} meta={keywordMeta} onOpen={() => onNavigate('keywords')} />
          <NavRow
            label={t.manageBlocked}
            meta={counts.blocked ?? '…'}
            onOpen={() => onNavigate('blocked')}
          />
          <NavRow
            label={t.falsePositiveList}
            meta={counts.allowlist ?? '…'}
            onOpen={() => onNavigate('allowlist')}
          />
          <NavRow
            label={t.followingTab}
            meta={counts.following ?? '…'}
            onOpen={() => onNavigate('following')}
          />
          <Row label={t.dailyBudget} hint={t.dailyBudgetHint}>
            <input
              type="number"
              min={1}
              inputMode="numeric"
              aria-label={t.dailyBudget}
              value={budgetDraft ?? ''}
              placeholder={budgetDraft == null ? '…' : undefined}
              onChange={(event) => setBudgetDraft(event.target.value)}
              onBlur={() => void commitBudget()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
              }}
              className="number-input"
            />
          </Row>
        </section>
      ) : null}

      {page === 'cleanUi' ? (
        <>
          <section className="group">
            <Row label={t.moduleClean} hint={t.moduleCleanHint}>
              <Toggle
                checked={ui?.cleanUi ?? false}
                disabled={ui === null}
                label={t.moduleClean}
                onChange={(enabled) => void updateUi('cleanUi', enabled)}
              />
            </Row>
          </section>
          <section className="group">
            <Row label={t.cleanForYou} hint={t.cleanForYouHint}>
              <Toggle
                checked={ui?.hideForYou ?? true}
                disabled={!ui?.cleanUi}
                label={t.cleanForYou}
                onChange={(enabled) => void updateUi('hideForYou', enabled)}
              />
            </Row>
            <Row label={t.cleanTrends} hint={t.cleanTrendsHint}>
              <Toggle
                checked={ui?.hideTrends ?? true}
                disabled={!ui?.cleanUi}
                label={t.cleanTrends}
                onChange={(enabled) => void updateUi('hideTrends', enabled)}
              />
            </Row>
            <Row label={t.cleanWhoToFollow} hint={t.cleanWhoToFollowHint}>
              <Toggle
                checked={ui?.hideWhoToFollow ?? true}
                disabled={!ui?.cleanUi}
                label={t.cleanWhoToFollow}
                onChange={(enabled) => void updateUi('hideWhoToFollow', enabled)}
              />
            </Row>
            <Row label={t.cleanPromoted} hint={t.cleanPromotedHint}>
              <Toggle
                checked={ui?.hidePromoted ?? true}
                disabled={!ui?.cleanUi}
                label={t.cleanPromoted}
                onChange={(enabled) => void updateUi('hidePromoted', enabled)}
              />
            </Row>
            <Row label={t.cleanGrok} hint={t.cleanGrokHint}>
              <Toggle
                checked={ui?.hideGrok ?? true}
                disabled={!ui?.cleanUi}
                label={t.cleanGrok}
                onChange={(enabled) => void updateUi('hideGrok', enabled)}
              />
            </Row>
            <Row label={t.cleanPremiumReplies} hint={t.cleanPremiumRepliesHint}>
              <Toggle
                checked={ui?.dimPremiumReplies ?? true}
                disabled={!ui?.cleanUi}
                label={t.cleanPremiumReplies}
                onChange={(enabled) => void updateUi('dimPremiumReplies', enabled)}
              />
            </Row>
            <Row label={t.cleanFont} hint={t.cleanFontHint}>
              <Toggle
                checked={ui?.systemFont ?? true}
                disabled={!ui?.cleanUi}
                label={t.cleanFont}
                onChange={(enabled) => void updateUi('systemFont', enabled)}
              />
            </Row>
          </section>
        </>
      ) : null}

      {page === 'keywords' ? <KeywordsView language={language} notify={notify} /> : null}
      {page === 'blocked' ? (
        <BlockedPage
          language={language}
          notify={notify}
          sendToXPage={sendToXPage}
          refreshPageMarked={refreshPageMarked}
          pauseDestructive={pauseDestructive}
        />
      ) : null}
      {page === 'allowlist' ? (
        <AllowlistPage language={language} notify={notify} recommendList={recommendList} />
      ) : null}
      {page === 'following' ? (
        <FollowingPage
          language={language}
          notify={notify}
          sendToXPage={sendToXPage}
          count={counts.following}
        />
      ) : null}
    </div>
  );
}
