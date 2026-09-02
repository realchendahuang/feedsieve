import type { HeuristicRule } from '@feedsieve/detector';
import {
  BUNDLED_KEYWORD_PACK_CATALOG,
  type KeywordPackCatalog,
  type KeywordPackRule,
} from './keyword-packs';

/** 用户可控制的本地关键词规则。命中只显示黄框，不自动拉黑，也不回灌社区。 */
export type KeywordCategory = string;
export interface OfficialKeywordRule extends KeywordPackRule {
  category: KeywordCategory;
}
export interface KeywordCategoryDefinition {
  id: KeywordCategory;
  name: { zh: string; en: string };
  description: { zh: string; en: string };
}
export interface CustomKeywordRule {
  id: string;
  phrase: string;
  createdAt: number;
}
export interface KeywordRuleSettings {
  subscriptionDefaultsVersion: 1;
  subscribedCategoryIds: KeywordCategory[];
  disabledOfficialRuleIds: string[];
  customRules: CustomKeywordRule[];
}
export interface ActiveKeywordRule {
  id: string;
  source: 'official' | 'custom';
  phrase: string;
  category: KeywordCategory | 'other';
}

const STORAGE_KEY = 'keywordRulesV1';
const MAX_CUSTOM_RULES = 80;
const MAX_PHRASE_LENGTH = 80;
const CATEGORY_ID_RE = /^[a-z][a-z0-9_]{1,63}$/;
const SUBSCRIPTION_DEFAULTS_VERSION = 1 as const;

function flattenOfficialRules(catalog: KeywordPackCatalog): OfficialKeywordRule[] {
  return catalog.packs.flatMap((pack) =>
    pack.rules.map((rule) => ({ ...rule, category: pack.id })),
  );
}
export const OFFICIAL_KEYWORD_CATEGORIES: readonly KeywordCategoryDefinition[] =
  BUNDLED_KEYWORD_PACK_CATALOG.packs.map(({ id, name, description }) => ({
    id,
    name,
    description,
  }));
export const OFFICIAL_KEYWORD_RULES: readonly OfficialKeywordRule[] = flattenOfficialRules(
  BUNDLED_KEYWORD_PACK_CATALOG,
);

function normalizePhrase(value: string): string {
  return value
    .trim()
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .toLocaleLowerCase();
}
function textForMatch(value: string): string {
  return normalizePhrase(value).replace(/\s+/g, '');
}
export function isValidPhrase(value: string): boolean {
  const phrase = value.trim();
  return phrase.length >= 1 && phrase.length <= MAX_PHRASE_LENGTH;
}
function normalizeSettings(value: unknown): KeywordRuleSettings {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const disabledOfficialRuleIds = Array.isArray(raw.disabledOfficialRuleIds)
    ? raw.disabledOfficialRuleIds.filter(
        (id): id is string => typeof id === 'string' && /^[a-z][a-z0-9-]{2,95}$/.test(id),
      )
    : [];
  // v0.7.3 首次安装和旧版升级都统一启用全部官方词库。迁移标记写入后，才把
  // 订阅数组视为用户在新版里做出的明确选择，之后关闭全部也不会被重新打开。
  const hasCurrentSubscriptionDefaults =
    raw.subscriptionDefaultsVersion === SUBSCRIPTION_DEFAULTS_VERSION;
  const subscribedCategoryIds = hasCurrentSubscriptionDefaults
    ? Array.isArray(raw.subscribedCategoryIds)
      ? raw.subscribedCategoryIds.filter(
          (category): category is string =>
            typeof category === 'string' && CATEGORY_ID_RE.test(category),
        )
      : []
    : BUNDLED_KEYWORD_PACK_CATALOG.packs.map((pack) => pack.id);
  const customRules = Array.isArray(raw.customRules)
    ? raw.customRules
        .flatMap((item): CustomKeywordRule[] => {
          if (!item || typeof item !== 'object') return [];
          const candidate = item as Record<string, unknown>;
          const phrase = typeof candidate.phrase === 'string' ? candidate.phrase.trim() : '';
          const id = typeof candidate.id === 'string' ? candidate.id : '';
          return id && isValidPhrase(phrase)
            ? [{ id, phrase, createdAt: Number(candidate.createdAt) || 0 }]
            : [];
        })
        .slice(0, MAX_CUSTOM_RULES)
    : [];
  return {
    subscriptionDefaultsVersion: SUBSCRIPTION_DEFAULTS_VERSION,
    subscribedCategoryIds: [...new Set(subscribedCategoryIds)],
    disabledOfficialRuleIds: [...new Set(disabledOfficialRuleIds)],
    customRules,
  };
}
export async function getKeywordRuleSettings(): Promise<KeywordRuleSettings> {
  return normalizeSettings((await browser.storage.local.get(STORAGE_KEY))[STORAGE_KEY]);
}
async function saveKeywordRuleSettings(settings: KeywordRuleSettings): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEY]: settings });
}
export async function addCustomKeywordRule(value: string): Promise<KeywordRuleSettings> {
  const phrase = value.trim();
  if (!isValidPhrase(phrase)) throw new Error('invalid_keyword_phrase');
  const settings = await getKeywordRuleSettings();
  const normalized = normalizePhrase(phrase);
  if (settings.customRules.some((rule) => normalizePhrase(rule.phrase) === normalized))
    return settings;
  if (settings.customRules.length >= MAX_CUSTOM_RULES) throw new Error('keyword_rule_limit');
  const next = {
    ...settings,
    customRules: [
      ...settings.customRules,
      { id: crypto.randomUUID(), phrase, createdAt: Date.now() },
    ],
  };
  await saveKeywordRuleSettings(next);
  return next;
}
export async function removeCustomKeywordRule(id: string): Promise<KeywordRuleSettings> {
  const settings = await getKeywordRuleSettings();
  const next = { ...settings, customRules: settings.customRules.filter((rule) => rule.id !== id) };
  await saveKeywordRuleSettings(next);
  return next;
}
export async function setOfficialKeywordRuleEnabled(
  id: string,
  enabled: boolean,
): Promise<KeywordRuleSettings> {
  const settings = await getKeywordRuleSettings();
  const disabled = new Set(settings.disabledOfficialRuleIds);
  if (enabled) disabled.delete(id);
  else disabled.add(id);
  const next = { ...settings, disabledOfficialRuleIds: [...disabled] };
  await saveKeywordRuleSettings(next);
  return next;
}
export function isOfficialKeywordCategorySubscribed(
  settings: KeywordRuleSettings,
  category: KeywordCategory,
): boolean {
  return settings.subscribedCategoryIds.includes(category);
}
export async function setOfficialKeywordCategorySubscribed(
  category: KeywordCategory,
  subscribed: boolean,
): Promise<KeywordRuleSettings> {
  const settings = await getKeywordRuleSettings();
  const categories = new Set(settings.subscribedCategoryIds);
  if (subscribed) categories.add(category);
  else categories.delete(category);
  const next = { ...settings, subscribedCategoryIds: [...categories] };
  await saveKeywordRuleSettings(next);
  return next;
}
export function activeKeywordRules(
  settings: KeywordRuleSettings,
  catalog: KeywordPackCatalog = BUNDLED_KEYWORD_PACK_CATALOG,
): ActiveKeywordRule[] {
  const disabled = new Set(settings.disabledOfficialRuleIds);
  const subscribed = new Set(settings.subscribedCategoryIds);
  return [
    ...settings.customRules.map((rule) => ({
      id: `custom:${rule.id}`,
      source: 'custom' as const,
      phrase: rule.phrase,
      category: 'other' as const,
    })),
    ...flattenOfficialRules(catalog)
      .filter((rule) => subscribed.has(rule.category) && !disabled.has(rule.id))
      .map((rule) => ({
        id: `official:${rule.id}`,
        source: 'official' as const,
        phrase: rule.phrase,
        category: rule.category,
      })),
  ];
}
export function createKeywordHeuristics(
  settings: KeywordRuleSettings,
  catalog: KeywordPackCatalog = BUNDLED_KEYWORD_PACK_CATALOG,
): readonly HeuristicRule[] {
  return activeKeywordRules(settings, catalog).map((rule) => ({
    id: `keyword:${rule.id}`,
    check(input) {
      // 垃圾账号常把引流词直接放在昵称里，而正文只发图片或表情。
      // handle 也参与匹配，方便用户自定义拦截固定账号前缀。
      const haystack = [input.displayName, input.handle, input.text, input.bio]
        .filter(Boolean)
        .join('\n');
      if (!haystack || !textForMatch(haystack).includes(textForMatch(rule.phrase))) return null;
      return rule.source === 'custom'
        ? `你设置的关键词：“${rule.phrase}”`
        : `官方关键词：“${rule.phrase}”`;
    },
  }));
}
export function categoryForKeywordRuleId(
  ruleId: string | null | undefined,
  catalog: KeywordPackCatalog = BUNDLED_KEYWORD_PACK_CATALOG,
): string | undefined {
  if (!ruleId?.startsWith('keyword:official:')) return undefined;
  const officialId = ruleId.slice('keyword:official:'.length);
  return flattenOfficialRules(catalog).find((rule) => rule.id === officialId)?.category;
}
export function subscribeKeywordRules(
  onChange: (settings: KeywordRuleSettings) => void,
): () => void {
  const listener = (changes: Record<string, unknown>, areaName: string) => {
    if (areaName !== 'local' || !changes[STORAGE_KEY]) return;
    onChange(normalizeSettings((changes[STORAGE_KEY] as { newValue?: unknown }).newValue));
  };
  browser.storage.onChanged.addListener(
    listener as Parameters<typeof browser.storage.onChanged.addListener>[0],
  );
  return () =>
    browser.storage.onChanged.removeListener(
      listener as Parameters<typeof browser.storage.onChanged.removeListener>[0],
    );
}
