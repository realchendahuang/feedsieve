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
import { isMediaUrl, type ScheduledEvent, type ScheduledPost } from './scheduled-parse';

export const SCHEDULE_SETTINGS_KEY = 'composeScheduleV1';
export const SCHEDULED_CACHE_KEY = 'scheduledPostsV1';
export const SCHEDULE_LAST_PICK_KEY = 'scheduleLastPickV1';
/** 「定个发帖节奏」的引导走完没有（跳过也算，别反复弹） */
export const SCHEDULE_SETUP_KEY = 'scheduleSetupV1';
export const SCHEDULE_ASSIGNMENTS_KEY = 'scheduleAssignmentsV1';

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
const MINUTE_MS = 60_000;

export function asScheduledCache(value: unknown): ScheduledCache {
  const raw = value && typeof value === 'object' ? (value as Partial<ScheduledCache>) : null;
  if (!raw || !Array.isArray(raw.posts)) return { ...EMPTY_SCHEDULED_CACHE, posts: [] };
  return {
    account: typeof raw.account === 'string' ? raw.account : null,
    syncedAt: typeof raw.syncedAt === 'number' ? raw.syncedAt : null,
    posts: raw.posts
      .filter(
        (p): p is ScheduledPost =>
          !!p &&
          typeof p.id === 'string' &&
          typeof p.executeAt === 'number' &&
          typeof p.text === 'string' &&
          typeof p.media === 'number',
      )
      .map((post) => {
        const base = { ...post };
        delete base.mediaUrls;
        if (!Array.isArray(post.mediaUrls)) return base;
        const urls = post.mediaUrls
          .map(isMediaUrl)
          .filter((url): url is string => url !== null)
          .slice(0, 4);
        return urls.length ? { ...base, mediaUrls: urls } : base;
      }),
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

// ---------- 已分配、还没在 X 里确认的时间 ----------
//
// 排班时先在本机占一个位置，避免两条草稿被分到同一个小时；X 里确认后
// （CreateScheduledTweet / 预排期列表）再把这条分配拿掉。只存在本机。

/** 分配只在「打开发帖框、等你点确认」的这段时间里有效；不确认就释放，别一直占着名额 */
const ASSIGNMENT_ACTIVE_MS = 30 * MINUTE_MS;
const ASSIGNMENT_PAST_MS = 2 * 60 * MINUTE_MS;

export interface ScheduleAssignment {
  id: string;
  /** 来自草稿队列时记下草稿 id；直接到发帖框排的为 null */
  draftId: string | null;
  /** 正文指纹，用来和 X 里排好的帖子对上 */
  textKey: string;
  /** 分配到的发布时刻（Unix 毫秒） */
  at: number;
  createdAt: number;
}

export function asAssignments(value: unknown): ScheduleAssignment[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (a): a is ScheduleAssignment =>
      !!a &&
      typeof a.id === 'string' &&
      (a.draftId === null || typeof a.draftId === 'string') &&
      typeof a.textKey === 'string' &&
      typeof a.at === 'number' &&
      Number.isFinite(a.at) &&
      typeof a.createdAt === 'number' &&
      Number.isFinite(a.createdAt),
  );
}

function liveAssignments(list: ScheduleAssignment[], now: number): ScheduleAssignment[] {
  return list
    .filter((a) => a.at > now - ASSIGNMENT_PAST_MS && a.createdAt > now - ASSIGNMENT_ACTIVE_MS)
    .sort((a, b) => a.at - b.at);
}

export async function getAssignments(now = Date.now()): Promise<ScheduleAssignment[]> {
  const stored = await browser.storage.local.get(SCHEDULE_ASSIGNMENTS_KEY);
  return liveAssignments(asAssignments(stored[SCHEDULE_ASSIGNMENTS_KEY]), now);
}

let assignmentChain: Promise<unknown> = Promise.resolve();

function writeAssignments(
  update: (list: ScheduleAssignment[], now: number) => ScheduleAssignment[],
  now = Date.now(),
): Promise<ScheduleAssignment[]> {
  const run = assignmentChain.then(async () => {
    const stored = await browser.storage.local.get(SCHEDULE_ASSIGNMENTS_KEY);
    const next = liveAssignments(update(asAssignments(stored[SCHEDULE_ASSIGNMENTS_KEY]), now), now);
    await browser.storage.local.set({ [SCHEDULE_ASSIGNMENTS_KEY]: next });
    return next;
  });
  assignmentChain = run.catch(() => undefined);
  return run;
}

/** 给草稿（或发帖框里临时排的一条）占一个时间。同一个草稿再排会覆盖旧时间。 */
export async function setAssignment(input: {
  id?: string;
  draftId?: string | null;
  text: string;
  at: number;
  now?: number;
}): Promise<ScheduleAssignment[]> {
  const now = input.now ?? Date.now();
  const id = input.id ?? `${now.toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const draftId = input.draftId ?? null;
  const textKey = draftKey(input.text);
  return writeAssignments((list) => {
    const kept = list.filter(
      (a) =>
        a.id !== id && (!draftId || a.draftId !== draftId) && (!textKey || a.textKey !== textKey),
    );
    return [...kept, { id, draftId, textKey, at: input.at, createdAt: now }];
  }, now);
}

export async function removeAssignment(id: string): Promise<ScheduleAssignment[]> {
  return writeAssignments((list) => list.filter((a) => a.id !== id));
}

export async function removeAssignmentForDraft(draftId: string): Promise<ScheduleAssignment[]> {
  return writeAssignments((list) => list.filter((a) => a.draftId !== draftId));
}

/** X 里已经出现这条排期：按正文指纹（或时间）清掉本机分配。 */
export async function removeAssignmentsMatching(
  text: string,
  at?: number,
): Promise<ScheduleAssignment[]> {
  const key = draftKey(text);
  return writeAssignments((list) =>
    list.filter(
      (a) => !(key && a.textKey === key) && (at === undefined || Math.abs(a.at - at) >= MINUTE_MS),
    ),
  );
}

/** 打开预排期列表时，一次性把里面已经存在的帖子对应的本机分配清掉。 */
export async function removeAssignmentsForPosts(
  posts: ReadonlyArray<{ text: string; executeAt: number }>,
): Promise<ScheduleAssignment[]> {
  const keys = new Set(posts.map((post) => draftKey(post.text)).filter(Boolean));
  const times = posts.map((post) => post.executeAt);
  return writeAssignments((list) =>
    list.filter(
      (a) =>
        !(a.textKey && keys.has(a.textKey)) && !times.some((at) => Math.abs(a.at - at) < MINUTE_MS),
    ),
  );
}

export function subscribeAssignments(onChange: (list: ScheduleAssignment[]) => void) {
  return subscribeKey(SCHEDULE_ASSIGNMENTS_KEY, asAssignments, (value) =>
    onChange(liveAssignments(value, Date.now())),
  );
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

/** 排期页的「定个发帖节奏」引导走完没有（用户主动跳过也算，别反复弹）。 */
export async function getScheduleSetupDone(): Promise<boolean> {
  const stored = await browser.storage.local.get(SCHEDULE_SETUP_KEY);
  return stored[SCHEDULE_SETUP_KEY] === true;
}

export async function setScheduleSetupDone(): Promise<void> {
  await browser.storage.local.set({ [SCHEDULE_SETUP_KEY]: true });
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
