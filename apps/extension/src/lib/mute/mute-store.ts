/**
 * 静音词的本地设置与规则存储。
 *
 * 两件事分开：
 * - rules 是用户确认过的静音词，本地立即生效（搜索、主页、列表、详情回复）；
 * - nativeSync 只控制「新词是否写入 X 原生静音词」，不控制本地匹配。
 *
 * X 原生静音词是账号级设置，能覆盖手机 App 的首页/通知/回复，但不覆盖搜索；
 * 本地规则负责搜索页和原生不生效的地方。两者用 nativeId 关联。
 */
import { normalizeMuteText } from './matcher';

export const MUTE_SETTINGS_KEY = 'keywordMutesV1';
export const MAX_MUTE_RULES = 200;
export const MAX_MUTE_PHRASE_LENGTH = 80;
export const MIN_MUTE_PHRASE_LENGTH = 2;

export type MuteSyncState = 'local' | 'pending' | 'synced' | 'failed';
export type MuteOrigin = 'local' | 'x';

export interface MuteRule {
  id: string;
  /** 用户看到的原文；匹配时另行归一化。 */
  phrase: string;
  enabled: boolean;
  origin: MuteOrigin;
  /** X 原生静音词的 id；没有同步过就是空。 */
  nativeId?: string;
  syncState: MuteSyncState;
  nativeSurfaces?: string[];
  nativeOptions?: string[];
  /** 原生静音词的到期时间；null / 空表示永久。 */
  validUntil?: string | null;
  createdAt: number;
}

export interface MuteSettings {
  /** 本地折叠总开关；关掉后不隐藏任何推文，规则保留。 */
  enabled: boolean;
  /** 新增词时是否同时写入 X 原生静音词（手机也生效）。 */
  nativeSync: boolean;
  rules: MuteRule[];
}

export const DEFAULT_MUTE_SETTINGS: MuteSettings = {
  enabled: true,
  nativeSync: false,
  rules: [],
};

export interface NativeMute {
  keyword: string;
  id: string;
  surfaces: string[];
  options: string[];
  validUntil: string | null;
}

export type MuteRuleError = 'invalid' | 'duplicate' | 'limit';

const SYNC_STATES: readonly MuteSyncState[] = ['local', 'pending', 'synced', 'failed'];

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
  // 只有标点/符号/emoji 的词无法可靠匹配，直接拒绝。
  if (!normalizeMuteText(phrase).replace(/[\p{P}\p{S}\s]+/gu, '')) return null;
  return phrase;
}

function newRuleId(now: number): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ?? `mute_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeMuteRule(raw: unknown, now = Date.now()): MuteRule | null {
  const value = (raw ?? {}) as Record<string, unknown>;
  const phrase = normalizeMutePhrase(value.phrase);
  if (!phrase) return null;
  const syncState = SYNC_STATES.includes(value.syncState as MuteSyncState)
    ? (value.syncState as MuteSyncState)
    : value.nativeId
      ? 'synced'
      : 'local';
  return {
    id: asString(value.id, 80) || newRuleId(now),
    phrase,
    enabled: value.enabled !== false,
    origin: value.origin === 'x' ? 'x' : 'local',
    ...(asString(value.nativeId, 80) ? { nativeId: asString(value.nativeId, 80) } : {}),
    syncState,
    ...(asStringArray(value.nativeSurfaces)
      ? { nativeSurfaces: asStringArray(value.nativeSurfaces) }
      : {}),
    ...(asStringArray(value.nativeOptions) ? { nativeOptions: asStringArray(value.nativeOptions) } : {}),
    ...(typeof value.validUntil === 'string' && value.validUntil
      ? { validUntil: value.validUntil }
      : value.validUntil === null
        ? { validUntil: null }
        : {}),
    createdAt: typeof value.createdAt === 'number' && Number.isFinite(value.createdAt)
      ? value.createdAt
      : now,
  };
}

export function normalizeMuteSettings(raw: unknown, now = Date.now()): MuteSettings {
  const value = (raw ?? {}) as Record<string, unknown>;
  const seen = new Set<string>();
  const rules: MuteRule[] = [];
  for (const entry of Array.isArray(value.rules) ? value.rules : []) {
    const rule = normalizeMuteRule(entry, now);
    if (!rule) continue;
    const key = mutePhraseKey(rule.phrase);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    rules.push(rule);
    if (rules.length >= MAX_MUTE_RULES) break;
  }
  return {
    enabled: value.enabled !== false,
    nativeSync: value.nativeSync === true,
    rules,
  };
}

export function addMuteRule(
  settings: MuteSettings,
  phrase: string,
  options: { origin?: MuteOrigin; nativeId?: string; syncState?: MuteSyncState; now?: number } = {},
): { ok: true; settings: MuteSettings; rule: MuteRule } | { ok: false; code: MuteRuleError } {
  const normalized = normalizeMutePhrase(phrase);
  if (!normalized) return { ok: false, code: 'invalid' };
  const key = mutePhraseKey(normalized);
  if (settings.rules.some((rule) => mutePhraseKey(rule.phrase) === key)) {
    return { ok: false, code: 'duplicate' };
  }
  if (settings.rules.length >= MAX_MUTE_RULES) return { ok: false, code: 'limit' };
  const now = options.now ?? Date.now();
  const rule: MuteRule = {
    id: newRuleId(now),
    phrase: normalized,
    enabled: true,
    origin: options.origin ?? 'local',
    ...(options.nativeId ? { nativeId: options.nativeId } : {}),
    syncState: options.syncState ?? (options.nativeId ? 'synced' : 'local'),
    createdAt: now,
  };
  return { ok: true, settings: { ...settings, rules: [rule, ...settings.rules] }, rule };
}

/** 改词只动 phrase；重复校验要排除自己，否则原词无法重存。 */
export function renameMuteRule(
  settings: MuteSettings,
  id: string,
  phrase: string,
): { ok: true; settings: MuteSettings; rule: MuteRule } | { ok: false; code: MuteRuleError } {
  const normalized = normalizeMutePhrase(phrase);
  if (!normalized) return { ok: false, code: 'invalid' };
  const target = settings.rules.find((rule) => rule.id === id);
  if (!target) return { ok: false, code: 'invalid' };
  const key = mutePhraseKey(normalized);
  if (settings.rules.some((rule) => rule.id !== id && mutePhraseKey(rule.phrase) === key)) {
    return { ok: false, code: 'duplicate' };
  }
  const rule = { ...target, phrase: normalized };
  return {
    ok: true,
    rule,
    settings: {
      ...settings,
      rules: settings.rules.map((entry) => (entry.id === id ? rule : entry)),
    },
  };
}

export function removeMuteRule(settings: MuteSettings, id: string): MuteSettings {
  return { ...settings, rules: settings.rules.filter((rule) => rule.id !== id) };
}

export function patchMuteRule(
  settings: MuteSettings,
  id: string,
  patch: Partial<Omit<MuteRule, 'id' | 'phrase'>>,
): MuteSettings {
  return {
    ...settings,
    rules: settings.rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)),
  };
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
    surfaces: asStringArray(value.mute_surfaces) ?? asStringArray(value.surfaces) ?? [],
    options: asStringArray(value.mute_options) ?? asStringArray(value.options) ?? [],
    validUntil: asString(value.valid_until, 40) || null,
  };
}

/**
 * 把 X 原生静音词合并进本地列表。
 *
 * - 原生有、本地没有：作为已同步规则导入（origin=x），让搜索页也生效；
 * - 两边都有：补上 nativeId / surfaces / 到期时间；
 * - 本地有 nativeId、原生列表里没有：说明用户在 X 端删了，退回「仅本机」，
 *   不直接删本地规则，避免用户在搜索页突然又看到内容。
 */
export function mergeNativeMutes(
  settings: MuteSettings,
  nativeMutes: readonly NativeMute[],
  now = Date.now(),
): { settings: MuteSettings; imported: number; linked: number } {
  const byKey = new Map<string, NativeMute>();
  for (const mute of nativeMutes) {
    if (isNativeMuteExpired(mute, now)) continue;
    const key = mutePhraseKey(mute.keyword);
    if (key && !byKey.has(key)) byKey.set(key, mute);
  }

  let imported = 0;
  let linked = 0;
  const rules = settings.rules.map((rule) => {
    const mute = byKey.get(mutePhraseKey(rule.phrase));
    if (!mute) {
      if (!rule.nativeId) return rule;
      // 原生端已删除：退回本地，但保留用户确认过的规则。
      return {
        ...rule,
        nativeId: undefined,
        syncState: 'local' as const,
        nativeSurfaces: undefined,
        nativeOptions: undefined,
        validUntil: undefined,
      };
    }
    byKey.delete(mutePhraseKey(rule.phrase));
    linked += 1;
    return {
      ...rule,
      nativeId: mute.id,
      syncState: 'synced' as const,
      nativeSurfaces: mute.surfaces,
      nativeOptions: mute.options,
      validUntil: mute.validUntil,
    };
  });

  for (const mute of byKey.values()) {
    if (rules.length >= MAX_MUTE_RULES) break;
    const phrase = normalizeMutePhrase(mute.keyword);
    if (!phrase) continue;
    rules.unshift({
      id: newRuleId(now),
      phrase,
      enabled: true,
      origin: 'x',
      nativeId: mute.id,
      syncState: 'synced',
      nativeSurfaces: mute.surfaces,
      nativeOptions: mute.options,
      validUntil: mute.validUntil,
      createdAt: now,
    });
    imported += 1;
  }

  return { settings: { ...settings, rules }, imported, linked };
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
