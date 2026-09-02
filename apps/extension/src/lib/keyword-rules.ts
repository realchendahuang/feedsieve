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
  subscriptionDefaultsVersion: 2;
  subscribedCategoryIds: KeywordCategory[];
  disabledOfficialRuleIds: string[];
  customRules: CustomKeywordRule[];
}
export interface ActiveKeywordRule {
  id: string;
  source: 'official' | 'custom';
  phrase: string;
  category: KeywordCategory | 'other';
  terms?: string[];
  maxGap?: number;
}

const STORAGE_KEY = 'keywordRulesV1';
export const MAX_CUSTOM_KEYWORD_RULES = 80;
const MAX_PHRASE_LENGTH = 80;
// 与远程关键词包的 ID 格式一致，避免后续新增带连字符或下划线的官方分类/规则
// 在本地设置和备份迁移中被错误丢弃。
const OFFICIAL_ID_RE = /^[a-z][a-z0-9_-]{1,95}$/;
const SUBSCRIPTION_DEFAULTS_VERSION = 2 as const;

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

/**
 * 自定义词的稳定比较键：导入/合并也必须和实际匹配使用同一套归一化，
 * 否则“ＡＢＣ”和“abc”会在备份恢复时重复出现。
 */
export function normalizeKeywordPhrase(value: string): string {
  return value
    .trim()
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .toLocaleLowerCase();
}
function textForMatch(value: string): string {
  // 去掉空白、标点、emoji/符号，处理“同·城 上-门”“福 利”等规避写法。
  return normalizeKeywordPhrase(value).replace(/[\p{P}\p{S}\s]+/gu, '');
}
function orderedTermsMatch(value: string, terms: readonly string[], maxGap: number): boolean {
  const haystack = textForMatch(value);
  let cursor = 0;
  for (const term of terms) {
    const needle = textForMatch(term);
    const index = haystack.indexOf(needle, cursor);
    if (index < 0) return false;
    if (cursor > 0 && index - cursor > maxGap) return false;
    cursor = index + needle.length;
  }
  return true;
}
function ruleMatchesText(value: string, rule: ActiveKeywordRule): boolean {
  if (rule.terms?.length) return orderedTermsMatch(value, rule.terms, rule.maxGap ?? 12);
  return textForMatch(value).includes(textForMatch(rule.phrase));
}
export function isValidPhrase(value: string): boolean {
  const phrase = value.trim();
  return phrase.length >= 1 && phrase.length <= MAX_PHRASE_LENGTH;
}
function normalizeSettings(value: unknown): KeywordRuleSettings {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const disabledOfficialRuleIds = Array.isArray(raw.disabledOfficialRuleIds)
    ? raw.disabledOfficialRuleIds.filter(
        (id): id is string => typeof id === 'string' && OFFICIAL_ID_RE.test(id),
      )
    : [];
  // v0.7.4 首次安装和旧版升级都统一启用全部官方词库。迁移标记写入后，才把
  // 订阅数组视为用户在新版里做出的明确选择，之后关闭全部也不会被重新打开。
  const hasCurrentSubscriptionDefaults =
    raw.subscriptionDefaultsVersion === SUBSCRIPTION_DEFAULTS_VERSION;
  const subscribedCategoryIds = hasCurrentSubscriptionDefaults
    ? Array.isArray(raw.subscribedCategoryIds)
      ? raw.subscribedCategoryIds.filter(
          (category): category is string =>
            typeof category === 'string' && OFFICIAL_ID_RE.test(category),
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
        .slice(0, MAX_CUSTOM_KEYWORD_RULES)
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
  const normalized = normalizeKeywordPhrase(phrase);
  if (settings.customRules.some((rule) => normalizeKeywordPhrase(rule.phrase) === normalized))
    return settings;
  if (settings.customRules.length >= MAX_CUSTOM_KEYWORD_RULES) throw new Error('keyword_rule_limit');
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

/**
 * 备份恢复等需要整体替换“个人关键词设置”的路径使用这个入口。
 * 它仍然只写 keywordRulesV1，绝不会碰社区、队列或任何 X 动作状态。
 */
export async function replaceKeywordRuleSettings(
  settings: KeywordRuleSettings,
): Promise<KeywordRuleSettings> {
  const normalized = normalizeSettings(settings);
  await saveKeywordRuleSettings(normalized);
  return normalized;
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
        ...(rule.terms ? { terms: rule.terms, maxGap: rule.max_gap } : {}),
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
      const fields = [input.displayName, input.handle, input.text, input.bio].filter(
        (value): value is string => typeof value === 'string' && value.length > 0,
      );
      // 每个字段独立匹配，避免昵称末尾和正文开头偶然拼成一个规则。
      if (!fields.some((field) => ruleMatchesText(field, rule))) return null;
      return rule.source === 'custom'
        ? `命中你的关键词：${rule.phrase}`
        : `命中官方规则：${rule.phrase}`;
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
