/**
 * 搜索框高级搜索（页面弹窗）的开关与偏好。
 *
 * 这是往 X 页面上加展示的模块，但从 0.16 起按用户要求默认开启；
 * 不想用的人可以在「主页 › 设置」里关掉（见 i18n 的 searchAssistHint）。
 * 偏好存 browser.storage.local，只在本机；关掉开关不会清掉已填的条件。
 */
import {
  normalizeDistanceUnit,
  normalizeRepliesMode,
  normalizeSearchContent,
  normalizeSearchSort,
  validDate,
  type DistanceUnit,
  type RepliesMode,
  type SearchContent,
  type SearchSort,
} from '../search/advanced';

const ENABLED_KEY = 'searchAssist';
const PREFS_KEY = 'searchAssistPrefsV1';

/** 默认开启；显式存过 false 才关闭。 */
const enabledOn = (value: unknown): boolean => value !== false;

function subscribeFlag(
  key: string,
  read: (value: unknown) => boolean,
  onChange: (enabled: boolean) => void,
): () => void {
  const listener = (changes: Record<string, unknown>, areaName: string): void => {
    if (areaName !== 'local' || !changes[key]) return;
    onChange(read((changes[key] as { newValue?: unknown }).newValue));
  };
  browser.storage.onChanged.addListener(
    listener as Parameters<typeof browser.storage.onChanged.addListener>[0],
  );
  return () =>
    browser.storage.onChanged.removeListener(
      listener as Parameters<typeof browser.storage.onChanged.removeListener>[0],
    );
}

export async function getSearchAssistEnabled(): Promise<boolean> {
  const stored = await browser.storage.local.get(ENABLED_KEY);
  return enabledOn(stored[ENABLED_KEY]);
}

export async function setSearchAssistEnabled(enabled: boolean): Promise<void> {
  await browser.storage.local.set({ [ENABLED_KEY]: enabled });
}

export function subscribeSearchAssistEnabled(onChange: (enabled: boolean) => void): () => void {
  return subscribeFlag(ENABLED_KEY, enabledOn, onChange);
}

export interface SearchAssistPrefs {
  /** 包含全部词。 */
  allWords: string;
  /** 精确短语。 */
  exactPhrase: string;
  /** 任意一个词。 */
  anyWords: string;
  /** 排除词。 */
  noneWords: string;
  /** 话题标签。 */
  hashtags: string;
  /** 语言代码；空 = 不限。 */
  language: string;
  /** 发给这些账号。 */
  to: string;
  /** 提到这些账号。 */
  mention: string;
  since: string;
  until: string;
  minReplies: string;
  minRetweets: string;
  minLikes: string;
  content: SearchContent;
  replies: RepliesMode;
  excludeRetweets: boolean;
  verifiedOnly: boolean;
  near: string;
  within: string;
  unit: DistanceUnit;
  sort: SearchSort;
  /** 没做控件的运算符，原样拼进查询。 */
  raw: string;
}

export const DEFAULT_SEARCH_ASSIST_PREFS: SearchAssistPrefs = {
  allWords: '',
  exactPhrase: '',
  anyWords: '',
  noneWords: '',
  hashtags: '',
  language: '',
  to: '',
  mention: '',
  since: '',
  until: '',
  minReplies: '',
  minRetweets: '',
  minLikes: '',
  content: 'any',
  replies: 'any',
  excludeRetweets: false,
  verifiedOnly: false,
  near: '',
  within: '',
  unit: 'km',
  sort: 'top',
  raw: '',
};

const text = (value: unknown, max = 400): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').slice(0, max) : '';

export function normalizeSearchAssistPrefs(raw: unknown): SearchAssistPrefs {
  const value = (raw ?? {}) as Record<string, unknown>;
  return {
    allWords: text(value.allWords),
    exactPhrase: text(value.exactPhrase, 200),
    anyWords: text(value.anyWords),
    noneWords: text(value.noneWords),
    hashtags: text(value.hashtags),
    language: text(value.language, 10).toLowerCase(),
    to: text(value.to, 20),
    mention: text(value.mention, 20),
    since: validDate(typeof value.since === 'string' ? value.since : ''),
    until: validDate(typeof value.until === 'string' ? value.until : ''),
    minReplies: text(value.minReplies, 20),
    minRetweets: text(value.minRetweets, 20),
    minLikes: text(value.minLikes, 20),
    content: normalizeSearchContent(value.content),
    replies: normalizeRepliesMode(value.replies),
    excludeRetweets: value.excludeRetweets === true,
    verifiedOnly: value.verifiedOnly === true,
    near: text(value.near, 100),
    within: text(value.within, 10),
    unit: normalizeDistanceUnit(value.unit),
    sort: normalizeSearchSort(value.sort),
    raw: text(value.raw, 400),
  };
}

export async function getSearchAssistPrefs(): Promise<SearchAssistPrefs> {
  const stored = await browser.storage.local.get(PREFS_KEY);
  return normalizeSearchAssistPrefs(stored[PREFS_KEY]);
}

export async function setSearchAssistPrefs(patch: Partial<SearchAssistPrefs>): Promise<void> {
  const next = normalizeSearchAssistPrefs({ ...(await getSearchAssistPrefs()), ...patch });
  await browser.storage.local.set({ [PREFS_KEY]: next });
}
