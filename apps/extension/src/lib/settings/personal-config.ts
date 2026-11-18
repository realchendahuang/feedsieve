import { isMarkStrength, type MarkStrength } from '@feedsieve/community-lists';
import type { CommunitySettings } from '../community/community-settings';
import type { UiLanguage } from '../platform/i18n';
import type { KeywordPackCatalog } from '../detection/keyword-packs';
import {
  isValidPhrase,
  MAX_CUSTOM_KEYWORD_RULES,
  normalizeKeywordPhrase,
  type CustomKeywordRule,
  type KeywordRuleSettings,
} from '../detection/keyword-rules';
import {
  DEFAULT_UI_SETTINGS,
  normalizeUiSettings,
  type UiSettings,
} from './ui-settings';
import {
  DEFAULT_MODULE_SETTINGS,
  normalizeModuleSettings,
  type ModuleSettings,
} from './module-settings';
import {
  DEFAULT_SEARCH_ASSIST_PREFS,
  normalizeSearchAssistPrefs,
  type SearchAssistPrefs,
} from './search-assist';
import {
  DEFAULT_SCHEDULE_SETTINGS,
  normalizeScheduleSettings,
  type ScheduleSettings,
} from '../compose/schedule-slots';
import {
  DEFAULT_AI_SETTINGS,
  normalizeAiSettings,
  type AiCheckSettings,
} from '../ai-check/client';

/**
 * 用户主动下载的本地配置文件。它只含可移植的规则与纯偏好设置，
 * 不含账号资料、安装 ID、黑白名单、排期内容或文章备份。
 */
export const PERSONAL_CONFIG_FORMAT = 'feedsieve-personal-config';
export const PERSONAL_CONFIG_SCHEMA_VERSION = 2 as const;
export const MAX_PERSONAL_CONFIG_BYTES = 256 * 1024;

// 跟关键词包目录使用相同格式。未知 ID 会在预览中忽略，而不是因命名风格不同拒绝整份备份。
const OFFICIAL_ID_RE = /^[a-z][a-z0-9_-]{1,95}$/;

const UI_SETTING_KEYS: ReadonlyArray<keyof UiSettings> = [
  'cleanUi',
  'hideForYou',
  'hideTrends',
  'hideWhoToFollow',
  'hidePromoted',
  'hidePromoteButton',
  'hideGrok',
  'dimPremiumReplies',
  'systemFont',
];

const MODULE_SETTING_KEYS: ReadonlyArray<keyof ModuleSettings> = [
  'hot',
  'profile',
  'write',
  'aiCheck',
  'filter',
  'shareMenu',
];

const SEARCH_PREF_KEYS: ReadonlyArray<keyof SearchAssistPrefs> = [
  'allWords',
  'exactPhrase',
  'anyWords',
  'noneWords',
  'hashtags',
  'language',
  'to',
  'mention',
  'since',
  'until',
  'minReplies',
  'minRetweets',
  'minLikes',
  'content',
  'replies',
  'excludeRetweets',
  'verifiedOnly',
  'near',
  'within',
  'unit',
  'sort',
  'raw',
];

export interface PersonalConfigInsightPreferences {
  badges: boolean;
  profileLine: boolean;
}

export interface PersonalConfigSearchAssist {
  enabled: boolean;
  prefs: SearchAssistPrefs;
}

export type PersonalConfigExtraSection =
  | 'uiSettings'
  | 'composeSchedule'
  | 'modules'
  | 'searchAssist'
  | 'insight'
  | 'aiDisplay';

export interface PersonalConfigSectionChange {
  section: PersonalConfigExtraSection;
  changedCount: number;
}

export interface PersonalConfigDocument {
  format: typeof PERSONAL_CONFIG_FORMAT;
  schemaVersion: 1 | typeof PERSONAL_CONFIG_SCHEMA_VERSION;
  exportedAt: string;
  keywordRules: {
    customPhrases: string[];
    /** 导出时可见的分类；导入到新词库时，不会误关后来新增的分类。 */
    knownCategoryIds: string[];
    subscribedCategoryIds: string[];
    disabledOfficialRuleIds: string[];
  };
  preferences: {
    uiLanguage: UiLanguage;
    communityEnabled: boolean;
    markStrength: MarkStrength;
  };
  uiSettings?: UiSettings;
  composeSchedule?: ScheduleSettings;
  modules?: ModuleSettings;
  searchAssist?: PersonalConfigSearchAssist;
  insight?: PersonalConfigInsightPreferences;
  aiDisplay?: AiCheckSettings;
}

export interface PersonalConfigContext {
  keywordRules: KeywordRuleSettings;
  community: Pick<CommunitySettings, 'enabled' | 'strength'>;
  language: UiLanguage;
  catalog: KeywordPackCatalog;
  uiSettings?: UiSettings;
  composeSchedule?: ScheduleSettings;
  modules?: ModuleSettings;
  searchAssist?: PersonalConfigSearchAssist;
  insight?: PersonalConfigInsightPreferences;
  aiDisplay?: AiCheckSettings;
}

export type PersonalConfigParseError =
  | 'file_too_large'
  | 'invalid_json'
  | 'invalid_format'
  | 'unsupported_version'
  | 'invalid_payload';

export type PersonalConfigParseResult =
  | { ok: true; document: PersonalConfigDocument }
  | { ok: false; error: PersonalConfigParseError };

export type PersonalConfigImportMode = 'merge' | 'replace';

export interface PersonalConfigSettingChange {
  id: string;
  from: boolean;
  to: boolean;
}

export interface PersonalConfigImportPreview {
  mode: PersonalConfigImportMode;
  customRules: {
    backupCount: number;
    currentCount: number;
    addedCount: number;
    alreadyPresentCount: number;
    /** 仅替换导入会移除本机独有的词；合并始终为 0。 */
    removedCount: number;
    resultCount: number;
    exceedsLimit: boolean;
  };
  categoryChanges: PersonalConfigSettingChange[];
  ruleChanges: PersonalConfigSettingChange[];
  ignoredCategoryIds: string[];
  ignoredRuleIds: string[];
  languageChange: { from: UiLanguage; to: UiLanguage } | null;
  communityEnabledChange: { from: boolean; to: boolean } | null;
  markStrengthChange: { from: MarkStrength; to: MarkStrength } | null;
  sectionChanges: PersonalConfigSectionChange[];
}

export interface PersonalConfigImportResult {
  preview: PersonalConfigImportPreview;
  /** 超过关键词上限时只保留预览，UI 不允许把它写入本机。 */
  next: {
    keywordRules: KeywordRuleSettings;
    preferences: PersonalConfigDocument['preferences'];
    uiSettings?: UiSettings;
    composeSchedule?: ScheduleSettings;
    modules?: ModuleSettings;
    searchAssist?: PersonalConfigSearchAssist;
    insight?: PersonalConfigInsightPreferences;
    aiDisplay?: AiCheckSettings;
  } | null;
}

export interface PreparePersonalConfigOptions {
  now?: () => number;
  makeRuleId?: () => string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function officialCategoryIds(catalog: KeywordPackCatalog): string[] {
  return catalog.packs.map((pack) => pack.id);
}

function officialRuleIds(catalog: KeywordPackCatalog): string[] {
  return catalog.packs.flatMap((pack) => pack.rules.map((rule) => rule.id));
}

function cleanPhrases(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const phrases: string[] = [];
  for (const value of values) {
    const phrase = value.trim();
    const normalized = normalizeKeywordPhrase(phrase);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    phrases.push(phrase);
  }
  return phrases;
}

function isLanguage(value: unknown): value is UiLanguage {
  return value === 'zh' || value === 'en';
}

function parseStringArray(value: unknown, predicate: (item: string) => boolean): string[] | null {
  if (!Array.isArray(value)) return null;
  const items: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !predicate(item)) return null;
    items.push(item);
  }
  return unique(items);
}

function parseCustomPhrases(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_CUSTOM_KEYWORD_RULES) return null;
  const phrases: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !isValidPhrase(item) || !normalizeKeywordPhrase(item)) {
      return null;
    }
    phrases.push(item);
  }
  return cleanPhrases(phrases);
}

function parseBooleanGroup<K extends string>(
  raw: unknown,
  keys: readonly K[],
  normalize: (value: unknown) => Record<K, boolean>,
): Record<K, boolean> | null {
  if (!isRecord(raw)) return null;
  for (const key of keys) {
    const entry = raw[key];
    if (entry !== undefined && typeof entry !== 'boolean') return null;
  }
  return normalize(raw);
}

function parseComposeSchedule(raw: unknown): ScheduleSettings | null {
  if (!isRecord(raw) || !Array.isArray(raw.windows) || raw.windows.length > 64) return null;
  for (const item of raw.windows) {
    if (!isRecord(item)) return null;
  }
  for (const key of ['composeHelper', 'articleHelper', 'randomize'] as const) {
    if (raw[key] !== undefined && typeof raw[key] !== 'boolean') return null;
  }
  for (const key of ['minGapMinutes', 'leadMinutes', 'horizonDays'] as const) {
    if (raw[key] !== undefined && (typeof raw[key] !== 'number' || !Number.isFinite(raw[key]))) {
      return null;
    }
  }
  return normalizeScheduleSettings(raw);
}

function parseSearchAssist(raw: unknown): PersonalConfigSearchAssist | null {
  if (!isRecord(raw) || typeof raw.enabled !== 'boolean' || !isRecord(raw.prefs)) return null;
  return {
    enabled: raw.enabled,
    prefs: normalizeSearchAssistPrefs(raw.prefs),
  };
}

function parseInsight(raw: unknown): PersonalConfigInsightPreferences | null {
  if (!isRecord(raw) || typeof raw.badges !== 'boolean' || typeof raw.profileLine !== 'boolean') {
    return null;
  }
  return {
    badges: raw.badges,
    profileLine: raw.profileLine,
  };
}

function parseAiDisplay(raw: unknown): AiCheckSettings | null {
  if (!isRecord(raw)) return null;
  if (raw.mode !== 'off' && raw.mode !== 'mark' && raw.mode !== 'fold') return null;
  if (raw.scope !== 'all' && raw.scope !== 'blue' && raw.scope !== 'skipBlue') return null;
  if (typeof raw.markFollowing !== 'boolean') return null;
  return normalizeAiSettings(raw);
}

function cloneSchedule(settings: ScheduleSettings): ScheduleSettings {
  return {
    ...settings,
    windows: settings.windows.map((window) => ({ ...window, days: [...window.days] })),
  };
}

function countBooleanDiffs<K extends string>(
  keys: readonly K[],
  current: Record<K, boolean>,
  incoming: Record<K, boolean>,
): number {
  let changed = 0;
  for (const key of keys) {
    if (current[key] !== incoming[key]) changed += 1;
  }
  return changed;
}

function countScheduleDiffs(current: ScheduleSettings, incoming: ScheduleSettings): number {
  let changed = 0;
  for (const key of [
    'composeHelper',
    'articleHelper',
    'minGapMinutes',
    'leadMinutes',
    'randomize',
    'horizonDays',
  ] as const) {
    if (current[key] !== incoming[key]) changed += 1;
  }
  if (JSON.stringify(current.windows) !== JSON.stringify(incoming.windows)) {
    changed += 1;
  }
  return changed;
}

function countSearchAssistDiffs(
  current: PersonalConfigSearchAssist,
  incoming: PersonalConfigSearchAssist,
): number {
  let changed = current.enabled === incoming.enabled ? 0 : 1;
  for (const key of SEARCH_PREF_KEYS) {
    if (current.prefs[key] !== incoming.prefs[key]) changed += 1;
  }
  return changed;
}

/** 从当前本地设置建立可读、可移植、且不含任何身份或动作数据的文档。 */
export function createPersonalConfigDocument(
  context: PersonalConfigContext,
  exportedAt = new Date().toISOString(),
): PersonalConfigDocument {
  const categoryIds = officialCategoryIds(context.catalog);
  const categoryIdSet = new Set(categoryIds);
  const ruleIds = officialRuleIds(context.catalog);
  const ruleIdSet = new Set(ruleIds);
  const subscribed = new Set(context.keywordRules.subscribedCategoryIds);
  const disabled = new Set(context.keywordRules.disabledOfficialRuleIds);

  return {
    format: PERSONAL_CONFIG_FORMAT,
    schemaVersion: PERSONAL_CONFIG_SCHEMA_VERSION,
    exportedAt,
    keywordRules: {
      customPhrases: cleanPhrases(context.keywordRules.customRules.map((rule) => rule.phrase)),
      knownCategoryIds: categoryIds,
      subscribedCategoryIds: categoryIds.filter(
        (id) => categoryIdSet.has(id) && subscribed.has(id),
      ),
      disabledOfficialRuleIds: ruleIds.filter((id) => ruleIdSet.has(id) && disabled.has(id)),
    },
    preferences: {
      uiLanguage: context.language,
      communityEnabled: context.community.enabled,
      markStrength: context.community.strength,
    },
    ...(context.uiSettings ? { uiSettings: normalizeUiSettings(context.uiSettings) } : {}),
    ...(context.composeSchedule
      ? { composeSchedule: normalizeScheduleSettings(context.composeSchedule) }
      : {}),
    ...(context.modules ? { modules: normalizeModuleSettings(context.modules) } : {}),
    ...(context.searchAssist
      ? {
          searchAssist: {
            enabled: context.searchAssist.enabled,
            prefs: normalizeSearchAssistPrefs(context.searchAssist.prefs),
          },
        }
      : {}),
    ...(context.insight
      ? {
          insight: {
            badges: context.insight.badges,
            profileLine: context.insight.profileLine,
          },
        }
      : {}),
    ...(context.aiDisplay ? { aiDisplay: normalizeAiSettings(context.aiDisplay) } : {}),
  };
}

export function serializePersonalConfigDocument(document: PersonalConfigDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

/** 解析只返回内存对象，绝不读写 browser.storage 或访问网络。 */
export function parsePersonalConfigDocument(text: string): PersonalConfigParseResult {
  if (new TextEncoder().encode(text).byteLength > MAX_PERSONAL_CONFIG_BYTES) {
    return { ok: false, error: 'file_too_large' };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'invalid_json' };
  }
  if (!isRecord(raw)) return { ok: false, error: 'invalid_format' };
  if (raw.format !== PERSONAL_CONFIG_FORMAT) return { ok: false, error: 'invalid_format' };
  if (raw.schemaVersion !== 1 && raw.schemaVersion !== PERSONAL_CONFIG_SCHEMA_VERSION) {
    return { ok: false, error: 'unsupported_version' };
  }
  if (
    typeof raw.exportedAt !== 'string' ||
    !isRecord(raw.keywordRules) ||
    !isRecord(raw.preferences)
  ) {
    return { ok: false, error: 'invalid_payload' };
  }

  const customPhrases = parseCustomPhrases(raw.keywordRules.customPhrases);
  const knownCategoryIds = parseStringArray(raw.keywordRules.knownCategoryIds, (id) =>
    OFFICIAL_ID_RE.test(id),
  );
  const subscribedCategoryIds = parseStringArray(raw.keywordRules.subscribedCategoryIds, (id) =>
    OFFICIAL_ID_RE.test(id),
  );
  const disabledOfficialRuleIds = parseStringArray(raw.keywordRules.disabledOfficialRuleIds, (id) =>
    OFFICIAL_ID_RE.test(id),
  );
  const uiLanguage = raw.preferences.uiLanguage;
  const communityEnabled = raw.preferences.communityEnabled;
  const markStrength = raw.preferences.markStrength;

  if (
    customPhrases === null ||
    knownCategoryIds === null ||
    knownCategoryIds.length === 0 ||
    subscribedCategoryIds === null ||
    disabledOfficialRuleIds === null ||
    !subscribedCategoryIds.every((id) => knownCategoryIds.includes(id)) ||
    !isLanguage(uiLanguage) ||
    typeof communityEnabled !== 'boolean' ||
    !isMarkStrength(markStrength)
  ) {
    return { ok: false, error: 'invalid_payload' };
  }

  const uiSettings =
    raw.uiSettings !== undefined
      ? (parseBooleanGroup(raw.uiSettings, UI_SETTING_KEYS, normalizeUiSettings) as
          | UiSettings
          | null)
      : undefined;
  const modules =
    raw.modules !== undefined
      ? (parseBooleanGroup(raw.modules, MODULE_SETTING_KEYS, normalizeModuleSettings) as
          | ModuleSettings
          | null)
      : undefined;
  const composeSchedule =
    raw.composeSchedule !== undefined ? parseComposeSchedule(raw.composeSchedule) : undefined;
  const searchAssist =
    raw.searchAssist !== undefined ? parseSearchAssist(raw.searchAssist) : undefined;
  const insight = raw.insight !== undefined ? parseInsight(raw.insight) : undefined;
  const aiDisplay = raw.aiDisplay !== undefined ? parseAiDisplay(raw.aiDisplay) : undefined;

  if (
    uiSettings === null ||
    modules === null ||
    composeSchedule === null ||
    searchAssist === null ||
    insight === null ||
    aiDisplay === null
  ) {
    return { ok: false, error: 'invalid_payload' };
  }

  return {
    ok: true,
    document: {
      format: PERSONAL_CONFIG_FORMAT,
      schemaVersion: raw.schemaVersion,
      exportedAt: raw.exportedAt,
      keywordRules: {
        customPhrases,
        knownCategoryIds,
        subscribedCategoryIds,
        disabledOfficialRuleIds,
      },
      preferences: {
        uiLanguage,
        communityEnabled,
        markStrength,
      },
      ...(uiSettings ? { uiSettings } : {}),
      ...(composeSchedule ? { composeSchedule } : {}),
      ...(modules ? { modules } : {}),
      ...(searchAssist ? { searchAssist } : {}),
      ...(insight ? { insight } : {}),
      ...(aiDisplay ? { aiDisplay } : {}),
    },
  };
}

function uniqueCurrentRules(rules: readonly CustomKeywordRule[]): CustomKeywordRule[] {
  const seen = new Set<string>();
  const result: CustomKeywordRule[] = [];
  for (const rule of rules) {
    const normalized = normalizeKeywordPhrase(rule.phrase);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(rule);
  }
  return result;
}

/**
 * 计算一次导入的最终结果和展示用 diff。该函数保持纯粹，调用者只有在用户点击确认时
 * 才会把 result.next 写回本地存储。
 */
export function preparePersonalConfigImport(
  document: PersonalConfigDocument,
  context: PersonalConfigContext,
  mode: PersonalConfigImportMode,
  options: PreparePersonalConfigOptions = {},
): PersonalConfigImportResult {
  const now = options.now ?? Date.now;
  const makeRuleId = options.makeRuleId ?? (() => crypto.randomUUID());
  const currentRules = uniqueCurrentRules(context.keywordRules.customRules);
  const importedPhrases = cleanPhrases(document.keywordRules.customPhrases);
  const currentByPhrase = new Map(
    currentRules.map((rule) => [normalizeKeywordPhrase(rule.phrase), rule]),
  );
  const importedPhraseKeys = new Set(
    importedPhrases.map((phrase) => normalizeKeywordPhrase(phrase)),
  );
  const alreadyPresentCount = importedPhrases.filter((phrase) =>
    currentByPhrase.has(normalizeKeywordPhrase(phrase)),
  ).length;
  const addedPhrases = importedPhrases.filter(
    (phrase) => !currentByPhrase.has(normalizeKeywordPhrase(phrase)),
  );
  const currentOnlyCount = currentRules.filter(
    (rule) => !importedPhraseKeys.has(normalizeKeywordPhrase(rule.phrase)),
  ).length;
  const nextCustomRules: CustomKeywordRule[] =
    mode === 'merge'
      ? [
          ...currentRules,
          ...addedPhrases.map((phrase) => ({ id: makeRuleId(), phrase, createdAt: now() })),
        ]
      : importedPhrases.map((phrase) => ({ id: makeRuleId(), phrase, createdAt: now() }));
  const exceedsLimit = nextCustomRules.length > MAX_CUSTOM_KEYWORD_RULES;

  const catalogCategoryIds = officialCategoryIds(context.catalog);
  const catalogCategoryIdSet = new Set(catalogCategoryIds);
  const backupKnownCategoryIds = new Set(document.keywordRules.knownCategoryIds);
  const backupSubscribedCategoryIds = new Set(document.keywordRules.subscribedCategoryIds);
  const currentSubscribed = new Set(context.keywordRules.subscribedCategoryIds);
  const nextSubscribed = new Set(currentSubscribed);
  for (const categoryId of catalogCategoryIds) {
    if (!backupKnownCategoryIds.has(categoryId)) continue;
    if (backupSubscribedCategoryIds.has(categoryId)) nextSubscribed.add(categoryId);
    else nextSubscribed.delete(categoryId);
  }
  const categoryChanges = catalogCategoryIds.flatMap((id): PersonalConfigSettingChange[] => {
    const from = currentSubscribed.has(id);
    const to = nextSubscribed.has(id);
    return from === to ? [] : [{ id, from, to }];
  });

  const catalogRuleIds = officialRuleIds(context.catalog);
  const catalogRuleIdSet = new Set(catalogRuleIds);
  const backupDisabledRuleIds = new Set(document.keywordRules.disabledOfficialRuleIds);
  const currentDisabled = new Set(context.keywordRules.disabledOfficialRuleIds);
  // 已不存在的旧规则不写回；当前词库中的规则则以备份的显式关闭列表为准。
  const nextDisabled = new Set(
    context.keywordRules.disabledOfficialRuleIds.filter((id) => !catalogRuleIdSet.has(id)),
  );
  for (const id of catalogRuleIds) {
    if (backupDisabledRuleIds.has(id)) nextDisabled.add(id);
  }
  const ruleChanges = catalogRuleIds.flatMap((id): PersonalConfigSettingChange[] => {
    const from = currentDisabled.has(id);
    const to = nextDisabled.has(id);
    return from === to ? [] : [{ id, from, to }];
  });

  const sectionChanges: PersonalConfigSectionChange[] = [];
  if (document.uiSettings) {
    const currentUi = normalizeUiSettings(context.uiSettings ?? DEFAULT_UI_SETTINGS);
    const changedCount = countBooleanDiffs(UI_SETTING_KEYS, currentUi, document.uiSettings);
    if (changedCount > 0) sectionChanges.push({ section: 'uiSettings', changedCount });
  }
  if (document.modules) {
    const currentModules = normalizeModuleSettings(context.modules ?? DEFAULT_MODULE_SETTINGS);
    const changedCount = countBooleanDiffs(MODULE_SETTING_KEYS, currentModules, document.modules);
    if (changedCount > 0) sectionChanges.push({ section: 'modules', changedCount });
  }
  if (document.composeSchedule) {
    const currentSchedule = context.composeSchedule
      ? normalizeScheduleSettings(context.composeSchedule)
      : normalizeScheduleSettings(DEFAULT_SCHEDULE_SETTINGS);
    const changedCount = countScheduleDiffs(currentSchedule, document.composeSchedule);
    if (changedCount > 0) sectionChanges.push({ section: 'composeSchedule', changedCount });
  }
  if (document.searchAssist) {
    const currentSearch = context.searchAssist ?? {
      enabled: true,
      prefs: DEFAULT_SEARCH_ASSIST_PREFS,
    };
    const changedCount = countSearchAssistDiffs(currentSearch, document.searchAssist);
    if (changedCount > 0) sectionChanges.push({ section: 'searchAssist', changedCount });
  }
  if (document.insight) {
    const currentInsight = context.insight ?? { badges: true, profileLine: false };
    const changedCount =
      (currentInsight.badges !== document.insight.badges ? 1 : 0) +
      (currentInsight.profileLine !== document.insight.profileLine ? 1 : 0);
    if (changedCount > 0) sectionChanges.push({ section: 'insight', changedCount });
  }
  if (document.aiDisplay) {
    const currentAi = normalizeAiSettings(context.aiDisplay ?? DEFAULT_AI_SETTINGS);
    const changedCount =
      (currentAi.mode !== document.aiDisplay.mode ? 1 : 0) +
      (currentAi.scope !== document.aiDisplay.scope ? 1 : 0) +
      (currentAi.markFollowing !== document.aiDisplay.markFollowing ? 1 : 0);
    if (changedCount > 0) sectionChanges.push({ section: 'aiDisplay', changedCount });
  }

  const preview: PersonalConfigImportPreview = {
    mode,
    customRules: {
      backupCount: importedPhrases.length,
      currentCount: currentRules.length,
      addedCount: mode === 'merge' ? addedPhrases.length : importedPhrases.length,
      alreadyPresentCount,
      removedCount: mode === 'replace' ? currentOnlyCount : 0,
      resultCount: nextCustomRules.length,
      exceedsLimit,
    },
    categoryChanges,
    ruleChanges,
    ignoredCategoryIds: document.keywordRules.knownCategoryIds.filter(
      (id) => !catalogCategoryIdSet.has(id),
    ),
    ignoredRuleIds: document.keywordRules.disabledOfficialRuleIds.filter(
      (id) => !catalogRuleIdSet.has(id),
    ),
    languageChange:
      context.language === document.preferences.uiLanguage
        ? null
        : { from: context.language, to: document.preferences.uiLanguage },
    communityEnabledChange:
      context.community.enabled === document.preferences.communityEnabled
        ? null
        : { from: context.community.enabled, to: document.preferences.communityEnabled },
    markStrengthChange:
      context.community.strength === document.preferences.markStrength
        ? null
        : { from: context.community.strength, to: document.preferences.markStrength },
    sectionChanges,
  };

  if (exceedsLimit) return { preview, next: null };

  return {
    preview,
    next: {
      keywordRules: {
        subscriptionDefaultsVersion: context.keywordRules.subscriptionDefaultsVersion,
        subscribedCategoryIds: unique([...nextSubscribed]),
        disabledOfficialRuleIds: unique([...nextDisabled]),
        customRules: nextCustomRules,
      },
      preferences: { ...document.preferences },
      ...(document.uiSettings ? { uiSettings: { ...document.uiSettings } } : {}),
      ...(document.composeSchedule
        ? { composeSchedule: cloneSchedule(document.composeSchedule) }
        : {}),
      ...(document.modules ? { modules: { ...document.modules } } : {}),
      ...(document.searchAssist
        ? {
            searchAssist: {
              enabled: document.searchAssist.enabled,
              prefs: { ...document.searchAssist.prefs },
            },
          }
        : {}),
      ...(document.insight ? { insight: { ...document.insight } } : {}),
      ...(document.aiDisplay ? { aiDisplay: { ...document.aiDisplay } } : {}),
    },
  };
}
