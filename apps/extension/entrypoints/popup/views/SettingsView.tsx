import { useEffect, useState, type ReactNode } from 'react';
import { MARK_STRENGTHS, type MarkStrength, type WhitelistEntry } from '@feedsieve/community-lists';
import {
  getKeywordRuleSettings,
  isOfficialKeywordCategorySubscribed,
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
  DEFAULT_PRESET,
  getSafetyBudgetOverride,
  SAFETY_PRESETS,
  setSafetyBudgetOverride,
} from '../../../src/lib/queue/block-safety';
import { setUiLanguage, UI_COPY, type UiLanguage } from '../../../src/lib/platform/i18n';
import {
  getInsightBadgesEnabled,
  getProfileLineEnabled,
  setInsightBadgesEnabled,
  setProfileLineEnabled,
  subscribeInsightBadges,
  subscribeProfileLineEnabled,
} from '../../../src/lib/insight/insight-settings';
import {
  getScheduleSettings,
  setScheduleSettings,
  subscribeScheduleSettings,
} from '../../../src/lib/compose/schedule-store';
import type { ScheduleSettings } from '../../../src/lib/compose/schedule-slots';
import {
  getModuleSettings,
  setModuleSettings,
  subscribeModuleSettings,
  type ModuleSettings,
} from '../../../src/lib/settings/module-settings';
import {
  getUiSettings,
  setUiSettings,
  subscribeUiSettings,
  type UiSettings,
} from '../../../src/lib/settings/ui-settings';
import { AppIcon, HelpIcon, STRENGTH_HINTS, STRENGTH_LABELS, Toggle } from './shared';
import KeywordsView from './KeywordsView';
import CadencePage from './settings/CadencePage';
import BackupRow from './settings/BackupRow';
import BlockedPage from './settings/BlockedPage';
import AllowlistPage from './settings/AllowlistPage';
import FollowingPage from './settings/FollowingPage';
import type { SubpageSendToXPage } from './settings/types';

export type SettingsPage =
  | 'home'
  | 'highlight'
  | 'stats'
  | 'ai'
  | 'clean'
  | 'compose'
  | 'share'
  | 'filter'
  | 'data'
  | 'about'
  | 'keywords'
  | 'blocked'
  | 'allowlist'
  | 'following';

/** 二级页的返回目标：功能模块回设置首页，名单页回「过滤」。 */
const PARENT_PAGE: Record<Exclude<SettingsPage, 'home'>, SettingsPage> = {
  highlight: 'home',
  stats: 'home',
  ai: 'home',
  clean: 'home',
  compose: 'home',
  share: 'home',
  filter: 'home',
  data: 'home',
  about: 'home',
  keywords: 'filter',
  blocked: 'filter',
  allowlist: 'filter',
  following: 'filter',
};

interface SettingsViewProps {
  language: UiLanguage;
  notify: (message: string | null) => void;
  page: SettingsPage;
  onNavigate: (page: SettingsPage) => void;
  community: CommunitySettings | null;
  onUpdateCommunity: (patch: {
    enabled?: boolean;
    autoContribute?: boolean;
    hotContribute?: boolean;
    hitContribute?: boolean;
    strength?: MarkStrength;
  }) => Promise<unknown>;
  onLanguageChange: (next: UiLanguage) => void;
  /** 手动同步后回填快照 */
  onSyncCommunity: () => Promise<void>;
  sendToXPage: SubpageSendToXPage;
  refreshPageMarked: () => Promise<void>;
  pauseDestructive: boolean;
  counts: { blocked: number | null; allowlist: number | null; following: number | null };
  recommendList: WhitelistEntry[];
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="row">
      <div className="row-label">
        <span>{label}</span>
        {hint ? <HelpIcon text={hint} /> : null}
      </div>
      <div className="row-control">{children}</div>
    </div>
  );
}

/** 清空主页洞察的本地帖子库：点一下变成「确认」，3 秒内再点才清空。 */
function ClearProfilesButton({
  language,
  notify,
}: {
  language: UiLanguage;
  notify: (message: string | null) => void;
}) {
  const t = UI_COPY[language];
  const [armed, setArmed] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    void browser.runtime
      .sendMessage({ type: 'feedsieve:profile-count' })
      .then((value: unknown) => setCount(typeof value === 'number' ? value : null))
      .catch(() => setCount(null));
  }, []);
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), 3_000);
    return () => window.clearTimeout(timer);
  }, [armed]);
  async function clear(): Promise<void> {
    if (!armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    try {
      await browser.runtime.sendMessage({ type: 'feedsieve:profile-clear' });
      setCount(0);
      notify(t.profileCleared);
    } catch {
      notify(t.profileActionFailed);
    }
  }
  return (
    <button
      type="button"
      className={`text-button${armed ? ' is-danger' : ''}`}
      disabled={count === 0}
      onClick={() => void clear()}
    >
      {armed
        ? t.profileClearConfirm
        : count
          ? t.profileClearAction(count)
          : t.profileClearAction(0)}
    </button>
  );
}

/** 版本号：测试和预览环境里拿不到 manifest 时不显示。 */
function extensionVersion(): string {
  try {
    const version = browser.runtime.getManifest?.().version;
    return version ? `v${version}` : '';
  } catch {
    return '';
  }
}

function NavRow({
  label,
  meta,
  onOpen,
}: {
  label: string;
  meta?: string | number | null;
  onOpen: () => void;
}) {
  return (
    <button type="button" className="row nav-row" onClick={onOpen}>
      <span className="row-label">
        <span>{label}</span>
      </span>
      {meta === null || meta === undefined ? null : <span className="row-meta">{meta}</span>}
      <span className="chevron" aria-hidden="true">
        <AppIcon name="chevron" size={14} />
      </span>
    </button>
  );
}

export default function SettingsView({
  language,
  notify,
  page,
  onNavigate,
  community,
  onUpdateCommunity,
  onLanguageChange,
  onSyncCommunity,
  sendToXPage,
  refreshPageMarked,
  pauseDestructive,
  counts,
  recommendList,
}: SettingsViewProps) {
  const t = UI_COPY[language];
  const [keywordRules, setKeywordRules] = useState<KeywordRuleSettings | null>(null);
  const [catalog, setCatalog] = useState<KeywordPackCatalog>(BUNDLED_KEYWORD_PACK_CATALOG);
  // 用户自定日上限：null = 还没读到；'' 允许临时输入态，失焦校验
  const [budgetDraft, setBudgetDraft] = useState<string | null>(null);
  const [insightBadges, setInsightBadges] = useState<boolean | null>(null);
  const [profileLine, setProfileLine] = useState<boolean | null>(null);
  const [modules, setModules] = useState<ModuleSettings | null>(null);
  const [ui, setUi] = useState<UiSettings | null>(null);
  const [schedule, setSchedule] = useState<ScheduleSettings | null>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    void getInsightBadgesEnabled().then(setInsightBadges);
    void getProfileLineEnabled().then(setProfileLine);
    void getModuleSettings().then(setModules);
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
      subscribeModuleSettings(setModules),
      subscribeUiSettings(setUi),
      subscribeScheduleSettings(setSchedule),
      subscribeKeywordRules(setKeywordRules),
      subscribeKeywordPackCatalog(setCatalog),
    ];
    return () => unsubs.forEach((unsub) => unsub());
  }, []);

  async function selectLanguage(next: UiLanguage): Promise<void> {
    if (next === language) return;
    notify(null);
    onLanguageChange(next);
    await setUiLanguage(next);
  }

  async function updateModule(key: 'aiCheck' | 'shareMenu', enabled: boolean): Promise<void> {
    setModules((prev) => (prev ? { ...prev, [key]: enabled } : prev));
    await setModuleSettings(key === 'aiCheck' ? { aiCheck: enabled } : { shareMenu: enabled });
  }

  /** 界面净化：细项在总开关打开后才生效，这里只负责存，页面上的效果由内容脚本监听。 */
  async function updateUi(key: keyof UiSettings, enabled: boolean): Promise<void> {
    setUi((prev) => (prev ? { ...prev, [key]: enabled } : prev));
    await setUiSettings({ [key]: enabled });
  }

  /** 发帖辅助是一个总开关，两个细项一起开 / 一起关；细项仍可在「发帖」页单独调。 */
  async function updateComposeAssist(enabled: boolean): Promise<void> {
    setSchedule((prev) =>
      prev ? { ...prev, composeHelper: enabled, articleHelper: enabled } : prev,
    );
    await setScheduleSettings({ composeHelper: enabled, articleHelper: enabled });
  }

  async function setLocalOnly(localOnly: boolean): Promise<void> {
    await onUpdateCommunity({ autoContribute: !localOnly });
    if (!localOnly) {
      await browser.runtime.sendMessage({ type: 'feedsieve:labels-sync' }).catch(() => undefined);
    }
  }

  /**
   * 日上限 = 用户的保险丝：数字生效，清空恢复默认自适应（不封顶爬升）。
   * 超出最激进档的数字额外给一句直白的后果提示，说一次，不拦着。
   */
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
        String((await getSafetyBudgetOverride()) ?? SAFETY_PRESETS[DEFAULT_PRESET].dailyLimit),
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
        notify(t.unavailable);
      }
    } catch {
      notify(t.backgroundUnavailable);
    } finally {
      setSyncing(false);
    }
  }

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

  const onOff = (on: boolean): string => (on ? t.personalConfigOn : t.personalConfigOff);

  if (page !== 'home') {
    const titles: Record<Exclude<SettingsPage, 'home'>, string> = {
      highlight: t.enabled,
      stats: t.insightBadges,
      ai: t.moduleAi,
      clean: t.moduleClean,
      compose: t.moduleCompose,
      share: t.moduleShare,
      filter: t.groupFilter,
      data: t.groupData,
      about: t.aboutLinks,
      keywords: t.keywords,
      blocked: t.manageBlocked,
      allowlist: t.falsePositiveList,
      following: t.followingTab,
    };
    const parent = PARENT_PAGE[page];
    const backLabel = parent === 'home' ? t.settings : titles[parent];
    return (
      <div className="view subpage">
        <header className="subpage-head">
          <button
            type="button"
            className="back-button"
            aria-label={`${t.goBack} · ${backLabel}`}
            onClick={() => onNavigate(parent)}
          >
            <AppIcon name="chevron" size={14} className="is-back" />
            {backLabel}
          </button>
          <h2>{titles[page]}</h2>
        </header>

        {page === 'highlight' ? (
          <section className="group">
            <Row label={t.enabled} hint={t.enabledHint}>
              <Toggle
                checked={community.enabled}
                label={t.enabled}
                onChange={(enabled) => void onUpdateCommunity({ enabled })}
              />
            </Row>
          </section>
        ) : null}

        {page === 'stats' ? (
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
          </section>
        ) : null}

        {page === 'ai' ? (
          <section className="group">
            <Row label={t.moduleAi} hint={t.moduleAiHint}>
              <Toggle
                checked={modules?.aiCheck ?? true}
                disabled={modules === null}
                label={t.moduleAi}
                onChange={(enabled) => void updateModule('aiCheck', enabled)}
              />
            </Row>
          </section>
        ) : null}

        {page === 'share' ? (
          <section className="group">
            <Row label={t.moduleShare} hint={t.moduleShareHint}>
              <Toggle
                checked={modules?.shareMenu ?? true}
                disabled={modules === null}
                label={t.moduleShare}
                onChange={(enabled) => void updateModule('shareMenu', enabled)}
              />
            </Row>
          </section>
        ) : null}

        {page === 'clean' ? (
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

        {page === 'compose' ? (
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

        {page === 'filter' ? (
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
                // 「仅本地运行」打开时所有上报都停，这个开关跟着锁住
                disabled={!community.autoContribute}
                label={t.hotContribute}
                onChange={(hotContribute) => void onUpdateCommunity({ hotContribute })}
              />
            </Row>
            <Row label={t.hitContribute} hint={t.hitContributeHint}>
              <Toggle
                checked={community.autoContribute && community.hitContribute}
                // 「仅本地运行」打开时所有上报都停，这个开关跟着锁住
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
        ) : null}

        {page === 'about' ? (
          <section className="group">
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
            <Row label={`${t.brand} ${extensionVersion()}`.trim()} hint={t.brandHint}>
              <a
                className="text-button"
                href="https://github.com/realchendahuang/feedsieve"
                target="_blank"
                rel="noreferrer noopener"
              >
                {t.githubLink}
              </a>
              <a
                className="text-button"
                href="https://feedsieve.win"
                target="_blank"
                rel="noreferrer noopener"
              >
                {t.officialSiteLink}
              </a>
            </Row>
          </section>
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

  const composeOn = schedule ? schedule.composeHelper || schedule.articleHelper : true;
  const moduleMeta = (on: boolean | null): string => (on === null ? '…' : onOff(on));

  return (
    <div className="view settings-view">
      <section className="group">
        <NavRow
          label={t.enabled}
          meta={onOff(community.enabled)}
          onOpen={() => onNavigate('highlight')}
        />
        <NavRow
          label={t.insightBadges}
          meta={moduleMeta(insightBadges)}
          onOpen={() => onNavigate('stats')}
        />
        <NavRow
          label={t.moduleAi}
          meta={moduleMeta(modules ? modules.aiCheck : null)}
          onOpen={() => onNavigate('ai')}
        />
        <NavRow
          label={t.moduleClean}
          meta={moduleMeta(ui ? ui.cleanUi : null)}
          onOpen={() => onNavigate('clean')}
        />
        <NavRow
          label={t.moduleCompose}
          meta={
            !composeOn
              ? t.personalConfigOff
              : schedule
                ? t.cadenceMeta(schedule.windows.length)
                : undefined
          }
          onOpen={() => onNavigate('compose')}
        />
        <NavRow
          label={t.moduleShare}
          meta={moduleMeta(modules ? modules.shareMenu : null)}
          onOpen={() => onNavigate('share')}
        />
      </section>
      <section className="group">
        <NavRow
          label={t.groupFilter}
          meta={STRENGTH_LABELS[language][community.strength]}
          onOpen={() => onNavigate('filter')}
        />
        <NavRow
          label={t.groupData}
          meta={community.autoContribute ? undefined : t.localOnly}
          onOpen={() => onNavigate('data')}
        />
        <NavRow
          label={t.aboutLinks}
          meta={extensionVersion() || undefined}
          onOpen={() => onNavigate('about')}
        />
      </section>
    </div>
  );
}
