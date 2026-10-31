/**
 * 排期相关的本机存储（browser.storage.local，不上传）：
 * - 时间表设置
 * - 已排期帖子缓存：X 打开「预排期」列表、或你在 X 里新建 / 改 / 删预排期帖子时顺带记下
 * - 上一次在「安排表」里确认的时间（「同上一条」按钮用）
 */
import {
  DEFAULT_SCHEDULE_SETTINGS,
  normalizeScheduleSettings,
  type ScheduleSettings,
} from './schedule-slots';
import type { ScheduledEvent, ScheduledPost } from './scheduled-parse';

export const SCHEDULE_SETTINGS_KEY = 'composeScheduleV1';
export const SCHEDULED_CACHE_KEY = 'scheduledPostsV1';
export const SCHEDULE_LAST_PICK_KEY = 'scheduleLastPickV1';

export interface ScheduledCache {
  /** 这份列表属于哪个 X 账号（小写 handle；未知为 null） */
  account: string | null;
  /** 最近一次拿到完整列表的时刻（只有增量时为 null） */
  syncedAt: number | null;
  posts: ScheduledPost[];
}

export const EMPTY_SCHEDULED_CACHE: ScheduledCache = { account: null, syncedAt: null, posts: [] };

/** 过了发布时刻 1 分钟的帖子从缓存里拿掉（X 已经发出去了） */
const PAST_GRACE_MS = 60_000;

export function asScheduledCache(value: unknown): ScheduledCache {
  const raw = value && typeof value === 'object' ? (value as Partial<ScheduledCache>) : null;
  if (!raw || !Array.isArray(raw.posts)) return { ...EMPTY_SCHEDULED_CACHE, posts: [] };
  return {
    account: typeof raw.account === 'string' ? raw.account : null,
    syncedAt: typeof raw.syncedAt === 'number' ? raw.syncedAt : null,
    posts: raw.posts.filter(
      (p): p is ScheduledPost =>
        !!p &&
        typeof p.id === 'string' &&
        typeof p.executeAt === 'number' &&
        typeof p.text === 'string' &&
        typeof p.media === 'number',
    ),
  };
}

/** 纯函数：把一次事件合进缓存。换了账号就从空开始。 */
export function reduceScheduledCache(
  cache: ScheduledCache,
  event: ScheduledEvent,
  account: string | null,
  now: number,
): ScheduledCache {
  const base: ScheduledCache =
    account && cache.account && account !== cache.account
      ? { account, syncedAt: null, posts: [] }
      : { ...cache, account: account ?? cache.account };
  let posts: ScheduledPost[];
  let syncedAt = base.syncedAt;
  if (event.kind === 'list') {
    posts = event.posts;
    syncedAt = now;
  } else if (event.kind === 'upsert') {
    posts = [...base.posts.filter((p) => p.id !== event.post.id), event.post];
  } else {
    posts = base.posts.filter((p) => p.id !== event.id);
  }
  return {
    account: base.account,
    syncedAt,
    posts: posts
      .filter((p) => p.executeAt > now - PAST_GRACE_MS)
      .sort((a, b) => a.executeAt - b.executeAt),
  };
}

/** 还没发出去的排期时间（算空档用）。 */
export function upcomingTimes(cache: ScheduledCache, now: number): number[] {
  return cache.posts.filter((p) => p.executeAt > now).map((p) => p.executeAt);
}

function subscribeKey<T>(key: string, parse: (value: unknown) => T, onChange: (value: T) => void) {
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string): void => {
    if (area === 'local' && changes[key]) onChange(parse(changes[key].newValue));
  };
  browser.storage.onChanged.addListener(
    listener as Parameters<typeof browser.storage.onChanged.addListener>[0],
  );
  return () =>
    browser.storage.onChanged.removeListener(
      listener as Parameters<typeof browser.storage.onChanged.removeListener>[0],
    );
}

export async function getScheduleSettings(): Promise<ScheduleSettings> {
  const stored = await browser.storage.local.get(SCHEDULE_SETTINGS_KEY);
  return normalizeScheduleSettings(stored[SCHEDULE_SETTINGS_KEY] ?? DEFAULT_SCHEDULE_SETTINGS);
}

export async function setScheduleSettings(
  patch: Partial<ScheduleSettings>,
): Promise<ScheduleSettings> {
  const next = normalizeScheduleSettings({ ...(await getScheduleSettings()), ...patch });
  await browser.storage.local.set({ [SCHEDULE_SETTINGS_KEY]: next });
  return next;
}

export function subscribeScheduleSettings(onChange: (settings: ScheduleSettings) => void) {
  return subscribeKey(SCHEDULE_SETTINGS_KEY, normalizeScheduleSettings, onChange);
}

export async function getScheduledCache(): Promise<ScheduledCache> {
  const stored = await browser.storage.local.get(SCHEDULED_CACHE_KEY);
  return asScheduledCache(stored[SCHEDULED_CACHE_KEY]);
}

/** 同一页面里事件可能连着来（列表 + 新建），串起来写，后一个基于前一个的结果。 */
let writeChain: Promise<unknown> = Promise.resolve();

export function applyScheduledEvent(
  event: ScheduledEvent,
  account: string | null,
  now = Date.now(),
): Promise<ScheduledCache> {
  const run = writeChain.then(async () => {
    const next = reduceScheduledCache(await getScheduledCache(), event, account, now);
    await browser.storage.local.set({ [SCHEDULED_CACHE_KEY]: next });
    return next;
  });
  writeChain = run.catch(() => undefined);
  return run;
}

export function subscribeScheduledCache(onChange: (cache: ScheduledCache) => void) {
  return subscribeKey(SCHEDULED_CACHE_KEY, asScheduledCache, onChange);
}

export async function getLastPick(): Promise<number | null> {
  const stored = await browser.storage.local.get(SCHEDULE_LAST_PICK_KEY);
  const value = stored[SCHEDULE_LAST_PICK_KEY];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export async function setLastPick(at: number): Promise<void> {
  await browser.storage.local.set({ [SCHEDULE_LAST_PICK_KEY]: at });
}

// ---------- 草稿队列：在面板里先写好，一条条排进空档 ----------

export const COMPOSE_DRAFTS_KEY = 'composeDraftsV1';
const DRAFTS_MAX = 200;
const DRAFT_TEXT_MAX = 25_000;

export interface ComposeDraft {
  id: string;
  text: string;
  createdAt: number;
}

export function asDrafts(value: unknown): ComposeDraft[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (d): d is ComposeDraft =>
      !!d &&
      typeof d.id === 'string' &&
      typeof d.text === 'string' &&
      typeof d.createdAt === 'number',
  );
}

export async function getDrafts(): Promise<ComposeDraft[]> {
  const stored = await browser.storage.local.get(COMPOSE_DRAFTS_KEY);
  return asDrafts(stored[COMPOSE_DRAFTS_KEY]);
}

async function saveDrafts(list: ComposeDraft[]): Promise<ComposeDraft[]> {
  const next = list.slice(0, DRAFTS_MAX);
  await browser.storage.local.set({ [COMPOSE_DRAFTS_KEY]: next });
  return next;
}

export async function addDraft(text: string, now = Date.now()): Promise<ComposeDraft[]> {
  const clean = text.split('\u0000').join('').trim().slice(0, DRAFT_TEXT_MAX);
  if (!clean) return getDrafts();
  const id = `${now.toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  return saveDrafts([...(await getDrafts()), { id, text: clean, createdAt: now }]);
}

export async function removeDraft(id: string): Promise<ComposeDraft[]> {
  return saveDrafts((await getDrafts()).filter((d) => d.id !== id));
}

export async function moveDraft(id: string, delta: -1 | 1): Promise<ComposeDraft[]> {
  const list = await getDrafts();
  const index = list.findIndex((d) => d.id === id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= list.length) return list;
  [list[index], list[target]] = [list[target]!, list[index]!];
  return saveDrafts(list);
}

/** 比较用：去掉首尾空白、统一换行，只看前 280 字（X 的预排期列表只给这么多）。 */
export function draftKey(text: string): string {
  return text.replace(/\r\n?/g, '\n').trim().slice(0, 280);
}

/** X 里排好了一条：正文和某条草稿一样，就把那条草稿拿掉。 */
export async function removeDraftsMatching(text: string): Promise<void> {
  const key = draftKey(text);
  if (!key) return;
  const list = await getDrafts();
  const next = list.filter((d) => draftKey(d.text) !== key);
  if (next.length !== list.length) await saveDrafts(next);
}

export function subscribeDrafts(onChange: (drafts: ComposeDraft[]) => void) {
  return subscribeKey(COMPOSE_DRAFTS_KEY, asDrafts, onChange);
}

/**
 * X 计字规则（twitter-text v3 的简化版）：拉丁字母、常用标点算 1，中日韩文字和 emoji 算 2，
 * 链接一律算 23。普通账号上限 280。
 */
export function tweetLength(text: string): number {
  let length = 0;
  const withoutUrls = text.replace(/https?:\/\/\S+/g, () => {
    length += 23;
    return '';
  });
  for (const char of withoutUrls) {
    const code = char.codePointAt(0)!;
    const light =
      code <= 4351 ||
      (code >= 8192 && code <= 8205) ||
      (code >= 8208 && code <= 8223) ||
      (code >= 8242 && code <= 8247);
    length += light ? 1 : 2;
  }
  return length;
}

// ---------- 文章本机备份 ----------

export const ARTICLE_BACKUPS_KEY = 'articleBackupsV1';
const BACKUP_VERSIONS = 5;
const BACKUP_ARTICLES = 30;
const BACKUP_TEXT_MAX = 200_000;

export interface ArticleBackupVersion {
  savedAt: number;
  title: string;
  markdown: string;
}

export interface ArticleBackup {
  id: string;
  versions: ArticleBackupVersion[];
}

export function asBackups(value: unknown): ArticleBackup[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((b): b is ArticleBackup => !!b && typeof b.id === 'string' && Array.isArray(b.versions))
    .map((b) => ({
      id: b.id,
      versions: b.versions.filter(
        (v): v is ArticleBackupVersion =>
          !!v &&
          typeof v.savedAt === 'number' &&
          typeof v.title === 'string' &&
          typeof v.markdown === 'string',
      ),
    }))
    .filter((b) => b.versions.length > 0);
}

/**
 * 纯函数：记一个版本。和最新版本一样就不记；同一篇 10 分钟内的改动覆盖最新那一版
 * （否则一边写一边存，5 个版本很快被刚才几秒的内容占满）。
 */
export function reduceBackups(
  list: ArticleBackup[],
  id: string,
  version: ArticleBackupVersion,
): ArticleBackup[] {
  const markdown = version.markdown.slice(0, BACKUP_TEXT_MAX);
  if (!markdown.trim() && !version.title.trim()) return list;
  const current = list.find((b) => b.id === id);
  const versions = current ? [...current.versions] : [];
  const latest = versions[0];
  if (latest && latest.markdown === markdown && latest.title === version.title) return list;
  const entry = { ...version, markdown };
  if (latest && version.savedAt - latest.savedAt < 10 * 60_000)
    versions[0] = { ...entry, savedAt: version.savedAt };
  else versions.unshift(entry);
  const next = { id, versions: versions.slice(0, BACKUP_VERSIONS) };
  return [next, ...list.filter((b) => b.id !== id)].slice(0, BACKUP_ARTICLES);
}

export async function getBackups(): Promise<ArticleBackup[]> {
  const stored = await browser.storage.local.get(ARTICLE_BACKUPS_KEY);
  return asBackups(stored[ARTICLE_BACKUPS_KEY]);
}

export async function saveBackup(id: string, version: ArticleBackupVersion): Promise<void> {
  const list = await getBackups();
  const next = reduceBackups(list, id, version);
  if (next !== list) await browser.storage.local.set({ [ARTICLE_BACKUPS_KEY]: next });
}

export async function removeBackup(id: string): Promise<ArticleBackup[]> {
  const next = (await getBackups()).filter((b) => b.id !== id);
  await browser.storage.local.set({ [ARTICLE_BACKUPS_KEY]: next });
  return next;
}

export function subscribeBackups(onChange: (backups: ArticleBackup[]) => void) {
  return subscribeKey(ARTICLE_BACKUPS_KEY, asBackups, onChange);
}
