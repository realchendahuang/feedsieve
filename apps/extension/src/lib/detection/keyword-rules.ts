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
  /** v3=v0.7.6 只订阅成人引流；v4=v0.7.8 追加 crypto 假抽奖默认订阅 */
  subscriptionDefaultsVersion: 3 | 4;
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
// v4（v0.7.8）：新增 crypto_giveaway_scams 默认订阅；v3 存量的明确选择保留并合并新包
const SUBSCRIPTION_DEFAULTS_VERSION = 4 as const;
/** 产品只把黄推 / 成人引流设为默认清理对象；其余行业包一律由用户显式订阅。 */
const DEFAULT_SUBSCRIBED_CATEGORY_IDS = ['adult_gray_traffic', 'crypto_giveaway_scams'] as const;
/** v0.7.8 起新增 crypto_giveaway_scams 默认订阅（crypto 词类从 2026-09-12.2 词包回归）。 */

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
    // 零宽规避不止 200B-200D：U+2060 词连接符、U+00AD 软连字符、双向控制符等
    // 全部是 Cf（格式字符），实战样本已被用来拆「我福不黑不信你看」。
    // 按 Unicode 类别整类剥掉，再剥变体选择符（FE0E/FE0F，跟在 emoji 后残留）。
    .replace(/[\p{Cf}\u{FE00}-\u{FE0F}]/gu, '')
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
/**
 * 纯 ASCII 短语（英文单词/缩写，可含单引号、&、连字符与空格）必须整词命中：
 * 剥标点后的子串匹配会让 bio 里的 "Adulthood" 误命中词库里的 "adult"
 * （issue #4 实锤）。切词后按 \W+ 拼接，"adult content" 这类多词短语照样命中。
 * 代价是放弃 "a d u l t" 式拆字规避的覆盖——英文词没有拆字_entropy 可依赖。
 */
function asciiWordRegExp(phrase: string): RegExp | null {
  const normalized = normalizeKeywordPhrase(phrase);
  if (!/^[a-z0-9][a-z0-9'&\-\s]*$/.test(normalized)) return null;
  const body = normalized
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\W+');
  return new RegExp(`(?<![a-z0-9])${body}(?![a-z0-9])`, 'i');
}
/** 规则的纯 ASCII 整词正则按规则缓存：630+ 规则 × 每推每字段重建 RegExp 是纯浪费。 */
const ASCII_WORD_REGEX_CACHE = new WeakMap<ActiveKeywordRule, RegExp | null>();

function asciiWordRegExpForRule(rule: ActiveKeywordRule): RegExp | null {
  const cached = ASCII_WORD_REGEX_CACHE.get(rule);
  if (cached !== undefined) return cached;
  const built = asciiWordRegExp(rule.phrase);
  ASCII_WORD_REGEX_CACHE.set(rule, built);
  return built;
}
function ruleMatchesText(value: string, rule: ActiveKeywordRule): boolean {
  if (rule.terms?.length) return orderedTermsMatch(value, rule.terms, rule.maxGap ?? 12);
  const ascii = asciiWordRegExpForRule(rule);
  if (ascii) return ascii.test(normalizeKeywordPhrase(value));
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
  // v0.7.4 曾把全部行业包设为默认订阅；v0.7.6 起默认只订阅黄推 / 成人引流。
  // 迁移标记写入后，才把订阅数组视为用户在新版里做出的明确选择，之后关闭全部
  // 也不会被重新打开。
  const storedVersion = typeof raw.subscriptionDefaultsVersion === 'number'
    ? raw.subscriptionDefaultsVersion
    : null;
  const hasCurrentSubscriptionDefaults = storedVersion === SUBSCRIPTION_DEFAULTS_VERSION;
  // v4 新增 crypto_giveaway_scams 默认订阅：v3 存量用户的明确选择要保留，
  // 只把新默认包合并进去（不开启 hasCurrent 数组直通的路径）。
  // 仅当存量用户至少订阅过一个分类时合并（全部关闭= 明确不要任何词库，
  // 新默认包不再打扰）；v3 用户的空订阅因此保持为空。
  const storedSubscribedRaw =
    Array.isArray(raw.subscribedCategoryIds) && storedVersion !== null
      ? [
          ...new Set(
            raw.subscribedCategoryIds.filter(
              (category): category is string =>
                typeof category === 'string' && OFFICIAL_ID_RE.test(category),
            ),
          ),
        ]
      : null;
  const defaultPresent = DEFAULT_SUBSCRIBED_CATEGORY_IDS.filter((id) =>
    BUNDLED_KEYWORD_PACK_CATALOG.packs.some((pack) => pack.id === id),
  );
  const subscribedCategoryIds = hasCurrentSubscriptionDefaults
    ? (storedSubscribedRaw ?? [])
    : storedSubscribedRaw
      ? (storedSubscribedRaw.length > 0
          ? [...storedSubscribedRaw, ...defaultPresent.filter((id) => !storedSubscribedRaw.includes(id))]
          : /* 明确关闭全部：保留用户的空订阅 */
            [])
      : defaultPresent;
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

/** 全新安装的默认词库配置（v4 起默认订阅成人引流 + crypto 假抽奖），供测试/预览复用。 */
export const DEFAULT_KEYWORD_RULE_SETTINGS: KeywordRuleSettings = {
  subscriptionDefaultsVersion: 4,
  subscribedCategoryIds: [...DEFAULT_SUBSCRIBED_CATEGORY_IDS],
  disabledOfficialRuleIds: [],
  customRules: [],
};
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
  /** 命中字段的标签语言（简介/正文…）：徽章上透出命中位置，方便核对是否误标 */
  fieldLabels: readonly [string, string, string, string] = ['昵称', '账号', '正文', '简介'],
): readonly HeuristicRule[] {
  return activeKeywordRules(settings, catalog).map((rule) => ({
    id: `keyword:${rule.id}`,
    check(input) {
      // 垃圾账号常把引流词直接放在昵称里，而正文只发图片或表情。
      // handle 也参与匹配，方便用户自定义拦截固定账号前缀。
      // 每个字段独立匹配，避免昵称末尾和正文开头偶然拼成一个规则；
      // 命中字段透出到理由里（简介/正文…），用户第一眼能核对来源。
      const hitIndex = [
        input.displayName,
        input.handle,
        input.text,
        input.bio,
      ].findIndex(
        (value): value is string =>
          typeof value === 'string' && value.length > 0 && ruleMatchesText(value, rule),
      );
      if (hitIndex < 0) return null;
      const fieldLabel = fieldLabels[hitIndex];
      const base =
        rule.source === 'custom'
          ? `命中你的关键词：${rule.phrase}`
          : `命中官方规则：${rule.phrase}`;
      return fieldLabel ? `${base} · ${fieldLabel}` : base;
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
