/**
 * X 原生静音词的本地镜像。
 *
 * 静音词只存在于 X 账号里：和 X 设置 › 隐私与安全 › 静音和屏蔽 › 静音的字词 是同一份列表，
 * 手机 App 的首页、通知、回复同样生效。本机只保存两样东西：
 * - rules：镜像，用来在弹窗里秒开列表，等 X 返回最新列表后再对齐；
 * - consented：用户是否同意「把词写入我的 X 账号」，首次写入前必须在弹窗里确认。
 *
 * 不做本地匹配/折叠：X 原生静音不覆盖的页面（例如搜索结果）这个模块也不承诺生效，
 * 免得用户以为已经静音了、其实只是本机遮了一下。
 */

export const MUTE_SETTINGS_KEY = 'keywordMutesV1';
export const MAX_MUTE_RULES = 200;
export const MAX_MUTE_PHRASE_LENGTH = 80;
export const MIN_MUTE_PHRASE_LENGTH = 2;

const ZERO_WIDTH_RE = /[\u200b-\u200d\u2060\ufeff\u00ad]/g;

/** 统一大小写、全半角、零宽字符和连续空白；用于去重与比较。 */
export function normalizeMuteText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(ZERO_WIDTH_RE, '')
    .toLocaleLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export interface MuteRule {
  /** 本地稳定 id（列表 key 与逐条操作用）。 */
  id: string;
  /** 用户看到的原文。 */
  phrase: string;
  /** X 静音词 id：镜像里的每条都必须有，删除/编辑靠它定位 X 上的词。 */
  nativeId: string;
  nativeSurfaces?: string[];
  nativeOptions?: string[];
  /** 原生静音词的到期时间；null / 空表示永久。 */
  validUntil?: string | null;
  createdAt: number;
}

export interface MuteSettings {
  /** 是否已确认「把静音词写入我的 X 账号」；未确认前不读也不写 X。 */
  consented: boolean;
  /** X 原生静音词的本地镜像。 */
  rules: MuteRule[];
}

export const DEFAULT_MUTE_SETTINGS: MuteSettings = {
  consented: false,
  rules: [],
};

export interface NativeMute {
  keyword: string;
  id: string;
  surfaces: string[];
  options: string[];
  validUntil: string | null;
}

export type MuteRuleError = 'duplicate' | 'limit';

function asString(value: unknown, max = 200): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === 'string' && item.length > 0);
  return items.length > 0 ? items : undefined;
}

export function mutePhraseKey(value: string): string {
  return normalizeMuteText(value);
}

/** 返回归一化后的词；不合法时返回 null。 */
export function normalizeMutePhrase(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const phrase = value.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!phrase) return null;
  const length = [...phrase].length;
  if (length < MIN_MUTE_PHRASE_LENGTH || length > MAX_MUTE_PHRASE_LENGTH) return null;
  // 只有标点/符号/emoji 的词没有意义，直接拒绝。
  if (!normalizeMuteText(phrase).replace(/[\p{P}\p{S}\s]+/gu, '')) return null;
  return phrase;
}

function newRuleId(now: number): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ?? `mute_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function isNativeMuteExpired(mute: Pick<NativeMute, 'validUntil'>, now = Date.now()): boolean {
  if (!mute.validUntil) return false;
  const time = Date.parse(mute.validUntil);
  return Number.isFinite(time) && time <= now;
}

export function normalizeNativeMute(raw: unknown): NativeMute | null {
  const value = (raw ?? {}) as Record<string, unknown>;
  const keyword = asString(value.keyword, MAX_MUTE_PHRASE_LENGTH);
  const id = asString(value.id, 80);
  if (!keyword || !id) return null;
  return {
    keyword,
    id,
    surfaces: asStringArray(value.surfaces) ?? [],
    options: asStringArray(value.options) ?? [],
    validUntil: typeof value.validUntil === 'string' && value.validUntil ? value.validUntil : null,
  };
}

function ruleFromNativeMute(mute: NativeMute, now: number, id?: string, createdAt?: number): MuteRule {
  return {
    id: id ?? newRuleId(now),
    phrase: normalizeMutePhrase(mute.keyword) ?? mute.keyword.trim(),
    nativeId: mute.id,
    ...(mute.surfaces.length > 0 ? { nativeSurfaces: mute.surfaces } : {}),
    ...(mute.options.length > 0 ? { nativeOptions: mute.options } : {}),
    validUntil: mute.validUntil,
    createdAt: createdAt ?? now,
  };
}

/**
 * 归一化存储：只保留有 X 词 id 的镜像条目。
 * 旧版存过「仅本机」规则（没有 nativeId）——本轮删除本地折叠后，这类条目直接丢弃。
 */
export function normalizeMuteRule(raw: unknown, now = Date.now()): MuteRule | null {
  const value = (raw ?? {}) as Record<string, unknown>;
  const phrase = normalizeMutePhrase(value.phrase);
  const nativeId = asString(value.nativeId, 80);
  if (!phrase || !nativeId) return null;
  return {
    id: asString(value.id, 80) || newRuleId(now),
    phrase,
    nativeId,
    ...(asStringArray(value.nativeSurfaces)
      ? { nativeSurfaces: asStringArray(value.nativeSurfaces) }
      : {}),
    ...(asStringArray(value.nativeOptions) ? { nativeOptions: asStringArray(value.nativeOptions) } : {}),
    ...(typeof value.validUntil === 'string' && value.validUntil
      ? { validUntil: value.validUntil }
      : value.validUntil === null
        ? { validUntil: null }
        : {}),
    createdAt:
      typeof value.createdAt === 'number' && Number.isFinite(value.createdAt) ? value.createdAt : now,
  };
}

export function normalizeMuteSettings(raw: unknown, now = Date.now()): MuteSettings {
  const value = (raw ?? {}) as Record<string, unknown>;
  const rules: MuteRule[] = [];
  const seen = new Set<string>();
  for (const entry of Array.isArray(value.rules) ? value.rules : []) {
    const rule = normalizeMuteRule(entry, now);
    if (!rule) continue;
    const key = mutePhraseKey(rule.phrase);
    if (seen.has(key)) continue;
    seen.add(key);
    rules.push(rule);
    if (rules.length >= MAX_MUTE_RULES) break;
  }
  return {
    // 旧版「同步到 X」开着，等价于已经同意写入账号
    consented: value.consented === true || value.nativeSync === true,
    rules,
  };
}

/**
 * 用 X 返回的列表对齐镜像：
 * - X 有、本地有：更新 surfaces / 到期时间，保留本地 id 与创建时间；
 * - X 有、本地没有：作为新条目补进来（imported）；
 * - 本地有、X 没有：说明用户在 X 端删了，直接从镜像移除（removed）。
 */
export function mergeNativeMutes(
  settings: MuteSettings,
  nativeMutes: readonly NativeMute[],
  now = Date.now(),
): { settings: MuteSettings; imported: number; removed: number } {
  const existing = new Map<string, MuteRule>();
  for (const rule of settings.rules) existing.set(rule.nativeId, rule);
  const rules: MuteRule[] = [];
  let imported = 0;
  for (const mute of nativeMutes) {
    if (isNativeMuteExpired(mute, now)) continue;
    const previous = existing.get(mute.id);
    if (previous) {
      existing.delete(mute.id);
      const merged = ruleFromNativeMute(mute, now, previous.id, previous.createdAt);
      rules.push(merged);
    } else {
      imported += 1;
      rules.push(ruleFromNativeMute(mute, now));
    }
    if (rules.length >= MAX_MUTE_RULES) break;
  }
  return {
    settings: { ...settings, rules },
    imported,
    removed: existing.size,
  };
}

/** 新增一条刚写入 X 的词（放在列表最前）。 */
export function addMuteRule(
  settings: MuteSettings,
  mute: NativeMute,
  now = Date.now(),
): { ok: true; settings: MuteSettings } | { ok: false; code: MuteRuleError } {
  const phrase = normalizeMutePhrase(mute.keyword) ?? mute.keyword.trim();
  const key = mutePhraseKey(phrase);
  if (settings.rules.some((rule) => mutePhraseKey(rule.phrase) === key)) {
    return { ok: false, code: 'duplicate' };
  }
  if (settings.rules.length >= MAX_MUTE_RULES) return { ok: false, code: 'limit' };
  return {
    ok: true,
    settings: {
      ...settings,
      rules: [ruleFromNativeMute({ ...mute, keyword: phrase }, now), ...settings.rules],
    },
  };
}

/** 编辑后的词已经在 X 上重建，用它替换镜像里的旧条目。 */
export function replaceMuteRule(
  settings: MuteSettings,
  id: string,
  mute: NativeMute,
  now = Date.now(),
): MuteSettings {
  return {
    ...settings,
    rules: settings.rules.map((rule) =>
      rule.id === id
        ? ruleFromNativeMute(mute, now, rule.id, rule.createdAt)
        : rule,
    ),
  };
}

export function removeMuteRule(settings: MuteSettings, id: string): MuteSettings {
  return { ...settings, rules: settings.rules.filter((rule) => rule.id !== id) };
}

export function grantMuteConsent(settings: MuteSettings): MuteSettings {
  return settings.consented ? settings : { ...settings, consented: true };
}

export async function getMuteSettings(): Promise<MuteSettings> {
  const stored = await browser.storage.local.get(MUTE_SETTINGS_KEY);
  return normalizeMuteSettings(stored[MUTE_SETTINGS_KEY]);
}

export async function setMuteSettings(settings: MuteSettings): Promise<void> {
  await browser.storage.local.set({ [MUTE_SETTINGS_KEY]: settings });
}

export function subscribeMuteSettings(onChange: (settings: MuteSettings) => void): () => void {
  const listener = (changes: Record<string, unknown>, areaName: string): void => {
    if (areaName !== 'local' || !changes[MUTE_SETTINGS_KEY]) return;
    onChange(normalizeMuteSettings((changes[MUTE_SETTINGS_KEY] as { newValue?: unknown }).newValue));
  };
  browser.storage.onChanged.addListener(
    listener as Parameters<typeof browser.storage.onChanged.addListener>[0],
  );
  return () =>
    browser.storage.onChanged.removeListener(
      listener as Parameters<typeof browser.storage.onChanged.removeListener>[0],
    );
}
