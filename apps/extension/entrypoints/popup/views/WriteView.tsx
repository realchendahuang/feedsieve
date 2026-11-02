/**
 * 「发帖」视图：排期台。
 *
 * 只做三件事：看这一周怎么排、把队列里的文案排进空档、在 X 里写新帖。
 * 内容（图片、视频、投票、引用）全部在 X 原生发帖框里完成，这里不复制发帖器。
 *
 * 排期逻辑不在这里配：用户先在「发帖 › 齿轮 › 发帖节奏」里设好集中时段和
 * 每小时最多几条，这里只负责把内容排进下一个有名额的小时。
 * 已排期列表来自 X 自己的「预排期」页（同步 = 让当前 X 页面打开那一页，X 自己去拉），
 * 你在 X 里新建 / 改 / 删预排期帖子时也会顺带更新。全部只存本机。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { UI_COPY, type UiLanguage } from '../../../src/lib/platform/i18n';
import {
  DEFAULT_SCHEDULE_SETTINGS,
  capacityBetween,
  capacitySummary,
  dayLabel,
  formatClock,
  localDayKey,
  nextFreeSlots,
  pickSlotInHour,
  slotLabel,
  weekdayLabel,
  type HourCapacity,
  type ScheduleSettings,
} from '../../../src/lib/compose/schedule-slots';
import {
  addDraft,
  getAssignments,
  getBackups,
  getDrafts,
  moveDraft,
  removeAssignmentForDraft,
  removeAssignmentsMatching,
  removeBackup,
  removeDraft,
  setAssignment,
  setComposeIntent,
  subscribeAssignments,
  subscribeBackups,
  subscribeDrafts,
  tweetLength,
  type ArticleBackup,
  type ComposeDraft,
  type ScheduleAssignment,
  EMPTY_SCHEDULED_CACHE,
  getScheduledCache,
  getScheduleSettings,
  setScheduleSettings,
  subscribeScheduledCache,
  subscribeScheduleSettings,
  upcomingTimes,
  type ScheduledCache,
} from '../../../src/lib/compose/schedule-store';
import {
  COMPOSE_DRAFT_MESSAGE,
  OPEN_SCHEDULED_MESSAGE,
} from '../../../src/lib/compose/compose-schedule';
import { AppIcon, formatAgo, HelpIcon, IconButton, Toggle } from './shared';
import { useListPosition } from './use-list-position';

const DAYS_SHOWN = 7;
const MAX_WEEK_OFFSET = 4;
const MINUTE_MS = 60_000;
const COMPOSE_URL = 'https://x.com/compose/post';
const MEDIA_URL_RE = /^https:\/\/(pbs|video)\.twimg\.com\//;

const COPY = {
  zh: {
    upcoming: '排期',
    upcomingHint:
      '已排期和待确认来自 X 的「草稿 › 预排期」：点同步会在当前 X 页面打开那一页，由 X 自己加载；你在 X 里新建、修改、删除预排期帖子时也会自动更新。「待确认」是本机已经占好时间、还没在 X 点确认的帖子。一周里每天显示「已排 / 上限」，点一天看当天时间线；点空档会把队列下一条排进去，队列为空时在 X 打开发帖框。只存在本机。',
    sync: '同步预排期列表',
    synced: (ago: string) => ago,
    neverSynced: '还没同步过',
    next: '下一条空档',
    noSlot: '节奏里没有空位',
    remaining: (n: number) => `本周还能排 ${n} 条`,
    newPost: '写新帖',
    scheduleNext: '排下一条',
    needXTab: '先在当前窗口打开 X',
    syncing: '已在 X 页面打开预排期列表',
    openFailed: '打不开 X 发帖框',
    media: (n: number) => `${n} 张图`,
    noText: '（只有图片）',
    pending: '待确认',
    pendingPost: '新帖',
    pendingHint: '在 X 里点确认后才算排上',
    scheduled: '已排期',
    empty: '这一周没有排期',
    emptyHint: '先设好发帖时段，或者打开 X 的预排期页同步一次。',
    adjust: '调整节奏',
    openScheduled: '打开 X 预排期',
    week: '一周',
    prevWeek: '上一周',
    nextWeek: '下一周',
    capacityValue: (used: number, cap: number) => `${used}/${cap}`,
    dayCount: (n: number) => `${n} 条`,
    noScheduleDay: '不排',
    free: '空',
    nextBadge: '下一条',
    slotHint: (queue: boolean) => (queue ? '把队列下一条排到这里' : '在这里写新帖'),
    tooClose: '间隔太近',
    detail: '排期详情',
    closeDetail: '收起',
    editInX: '在 X 里改时间',
    noDraft: '先加一条文案',
    noCapacity: '这个小时已经满了',
    drafts: '文案队列',
    draftsHint:
      '队列只存文案；图片、视频、投票在 X 发帖框里加。点「配图」会贴好正文、先留时间，但不自动打开安排表；你加完图点日历，时间已经填好。排好后这条自动从这里拿掉。只存在本机。',
    draftPlaceholder: '写一条文案，⌘↵ 加入',
    addDraft: '加入队列',
    scheduleDraft: '排下一条',
    composeMedia: '配图',
    composeMediaHint: '在 X 打开发帖框并贴好正文，图片在 X 里加',
    openDraft: '打开发帖框',
    reroll: '换一个时间',
    clearAssignment: '取消分配',
    assigned: '待确认',
    copyDraft: '复制',
    deleteDraft: '删除',
    moveUp: '上移',
    moveDown: '下移',
    draftOpened: '已在 X 打开发帖框并填好时间，确认后点「预排期」',
    composeMediaOpened: '正文已贴好，加完图点日历',
    draftBusy: 'X 的发帖框里还有没写完的内容，先处理掉',
    copied: '已复制',
    length: (n: number) => `${n}/280`,
    backups: '文章备份',
    backupsHint:
      '在 X 文章编辑器里写作时，标题和正文会转成 Markdown 存在本机，每篇留 5 个版本（10 分钟内的修改合并成一版）。X 编辑器出问题或误删时，从这里复制回去。',
    backupsEmpty: '还没有备份',
    untitled: '（无标题）',
    copyBackup: '复制 Markdown',
    openArticle: '在 X 打开',
    deleteBackup: '删除备份',
    version: '版本',
    helpers: '助手',
    composeHelper: '发帖框排期按钮',
    composeHelperHint:
      '发帖框日历图标旁的「排下一条」按钮，以及 X 安排表顶上的快捷时间（+1 小时、明天此时、同上一条、±15 分钟）。',
    articleHelper: '文章编辑增强',
    articleHelperHint:
      '在 X 文章编辑器里粘贴 Markdown 自动排版（标题、列表、引用、加粗、链接、代码块），开头的 # 标题自动填进文章标题；右下角显示字数、阅读时长和大纲，可导入 .md 文件。⌘⇧V 粘贴原文。',
  },
  en: {
    upcoming: 'Schedule',
    upcomingHint:
      'Scheduled posts and pending times come from X’s Drafts › Scheduled page: Sync opens that page in the current X tab and X loads it itself. Creating, editing or deleting scheduled posts on X also updates this list. Pending means the time is reserved on this device but not confirmed on X yet. The week shows used / limit per day; click a day for its timeline. Click an open slot to place the next queued text, or to open X’s composer when the queue is empty. Stored on this device only.',
    sync: 'Sync scheduled posts',
    synced: (ago: string) => ago,
    neverSynced: 'Not synced yet',
    next: 'Next open slot',
    noSlot: 'No open slot in your cadence',
    remaining: (n: number) => `${n} left this week`,
    newPost: 'New post',
    scheduleNext: 'Schedule next',
    needXTab: 'Open X in this window first',
    syncing: 'Opened the scheduled list on X',
    openFailed: 'Could not open X’s composer',
    media: (n: number) => `${n} media`,
    noText: '(media only)',
    pending: 'Pending',
    pendingPost: 'New post',
    pendingHint: 'It is scheduled only after you confirm on X',
    scheduled: 'Scheduled',
    empty: 'Nothing scheduled this week',
    emptyHint: 'Set posting windows first, or sync X’s scheduled page once.',
    adjust: 'Edit cadence',
    openScheduled: 'Open X scheduled page',
    week: 'Week',
    prevWeek: 'Previous week',
    nextWeek: 'Next week',
    capacityValue: (used: number, cap: number) => `${used}/${cap}`,
    dayCount: (n: number) => `${n} post${n === 1 ? '' : 's'}`,
    noScheduleDay: '—',
    free: 'Open',
    nextBadge: 'Next',
    slotHint: (queue: boolean) =>
      queue ? 'Put the next queued text here' : 'Write a new post here',
    tooClose: 'Too close',
    detail: 'Schedule details',
    closeDetail: 'Close',
    editInX: 'Change time on X',
    noDraft: 'Add a text first',
    noCapacity: 'This hour is full',
    drafts: 'Text queue',
    draftsHint:
      'The queue stores text only; add images, video and polls in X’s composer. “Add media” pastes the text and reserves the time but does not open the schedule dialog; after you add media and click the calendar icon, the time is already filled in. Scheduled items leave this list automatically. Stored on this device only.',
    draftPlaceholder: 'Write one, ⌘↵ to add',
    addDraft: 'Add to queue',
    scheduleDraft: 'Schedule next',
    composeMedia: 'Add media',
    composeMediaHint: 'Open X’s composer with the text pasted; add media there',
    openDraft: 'Open composer',
    reroll: 'Change time',
    clearAssignment: 'Clear time',
    assigned: 'Pending',
    copyDraft: 'Copy',
    deleteDraft: 'Delete',
    moveUp: 'Move up',
    moveDown: 'Move down',
    draftOpened: 'Opened X’s composer with the time filled in; click Schedule',
    composeMediaOpened: 'Text pasted; add media, then click the calendar icon',
    draftBusy: 'X’s composer still has unfinished text',
    copied: 'Copied',
    length: (n: number) => `${n}/280`,
    backups: 'Article backups',
    backupsHint:
      'While you write in the X article editor, the title and body are saved here as Markdown, 5 versions per article (edits within 10 minutes count as one). Copy them back if the X editor loses your work.',
    backupsEmpty: 'No backups yet',
    untitled: '(untitled)',
    copyBackup: 'Copy Markdown',
    openArticle: 'Open on X',
    deleteBackup: 'Delete backup',
    version: 'Version',
    helpers: 'Helpers',
    composeHelper: 'Composer schedule button',
    composeHelperHint:
      'The Schedule next button next to the calendar icon in the composer, and quick times at the top of X’s schedule dialog.',
    articleHelper: 'Article editor',
    articleHelperHint:
      'Paste Markdown into the X article editor to format it; a leading # heading becomes the title. A panel shows word count, reading time and outline, and imports .md files. ⌘⇧V pastes plain text.',
  },
} as const;

function clockOf(at: number): string {
  const d = new Date(at);
  return formatClock(d.getHours() * 60 + d.getMinutes());
}

function untilLabel(at: number, now: number, language: UiLanguage): string {
  const minutes = Math.max(0, Math.round((at - now) / MINUTE_MS));
  if (minutes < 1) return language === 'zh' ? '马上' : 'now';
  if (minutes < 60) return language === 'zh' ? `${minutes} 分钟后` : `in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return language === 'zh' ? `${hours} 小时后` : `in ${hours} h`;
  const days = Math.round(hours / 24);
  return language === 'zh' ? `${days} 天后` : `in ${days} d`;
}

function weekRangeLabel(start: number, end: number, language: UiLanguage): string {
  const from = new Date(start);
  const to = new Date(end - 1);
  if (language === 'zh')
    return `${from.getMonth() + 1}月${from.getDate()}日 – ${to.getMonth() + 1}月${to.getDate()}日`;
  return `${from.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })} – ${to.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

interface DayItem {
  at: number;
  id: string;
  text: string;
  media: number;
  mediaUrls?: string[];
  pending: boolean;
}

interface DayGroup {
  key: string;
  at: number;
  items: DayItem[];
}

interface WeekDay {
  key: string;
  at: number;
  used: number;
  capacity: number;
  free: number;
  mediaCount: number;
  hasItems: boolean;
  hasCapacity: boolean;
  full: boolean;
  isToday: boolean;
  hasConflict: boolean;
}

type TimelineEntry =
  | { kind: 'item'; at: number; item: DayItem }
  | { kind: 'slot'; at: number; hour: HourCapacity; isNext: boolean };

function hasConflict(items: readonly DayItem[], gapMinutes: number): boolean {
  const gap = Math.max(1, gapMinutes) * MINUTE_MS;
  return items.some((item, index) =>
    items.some((other, otherIndex) => otherIndex !== index && Math.abs(item.at - other.at) < gap),
  );
}

function MediaThumbs({
  urls,
  count,
  limit,
  size,
  label,
}: {
  urls?: string[];
  count: number;
  limit: number;
  size: number;
  label?: string;
}) {
  const safe = (urls ?? []).filter((url) => MEDIA_URL_RE.test(url));
  if (safe.length === 0) {
    if (!count) return null;
    return (
      <span className="write-media-badge">
        <AppIcon name="image" size={12} />
        <span>{label ?? count}</span>
      </span>
    );
  }
  const shown = safe.slice(0, limit);
  const extra = Math.max(0, count - shown.length);
  return (
    <span className="write-thumbs">
      {shown.map((url) => (
        <img
          key={url}
          className="write-thumb"
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          style={{ width: size, height: size }}
        />
      ))}
      {extra > 0 ? <span className="write-thumb-more">+{extra}</span> : null}
    </span>
  );
}

export function WriteView({
  language,
  notify,
  sendToXPage,
  onOpenCadence,
}: {
  language: UiLanguage;
  notify: (message: string | null) => void;
  sendToXPage: (message: {
    type: string;
    text?: string;
    at?: number;
    openSchedule?: boolean;
  }) => Promise<unknown>;
  onOpenCadence: () => void;
}) {
  const c = COPY[language];
  const [settings, setSettings] = useState<ScheduleSettings>(DEFAULT_SCHEDULE_SETTINGS);
  const [cache, setCache] = useState<ScheduledCache>(EMPTY_SCHEDULED_CACHE);
  const [assignments, setAssignments] = useState<ScheduleAssignment[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [drafts, setDrafts] = useState<ComposeDraft[]>([]);
  const [draftText, setDraftText] = useState('');
  const [backups, setBackups] = useState<ArticleBackup[]>([]);
  const [versionPick, setVersionPick] = useState<Record<string, number>>({});
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const rootRef = useRef<HTMLElement | null>(null);

  // 切走再回来：回到上次看的位置（排期、队列、备份里随便哪一段）
  useListPosition({
    storageKey: 'writePositionV1',
    pageKey: 'write',
    rootRef,
    ready:
      drafts.length > 0 || backups.length > 0 || assignments.length > 0 || cache.posts.length > 0,
  });

  useEffect(() => {
    void getScheduleSettings().then(setSettings);
    void getScheduledCache().then(setCache);
    void getAssignments().then(setAssignments);
    void getDrafts().then(setDrafts);
    void getBackups().then(setBackups);
    const unsubs = [
      subscribeScheduleSettings(setSettings),
      subscribeScheduledCache(setCache),
      subscribeAssignments(setAssignments),
      subscribeDrafts(setDrafts),
      subscribeBackups(setBackups),
    ];
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      unsubs.forEach((fn) => fn());
      window.clearInterval(timer);
    };
  }, []);

  const update = useCallback((patch: Partial<ScheduleSettings>) => {
    void setScheduleSettings(patch).then(setSettings);
  }, []);

  const occupied = useMemo(
    () => [
      ...upcomingTimes(cache, now),
      ...assignments.filter((assignment) => assignment.at > now).map((assignment) => assignment.at),
    ],
    [cache, now, assignments],
  );
  const next = useMemo(
    () => nextFreeSlots(settings, occupied, now, 1)[0] ?? null,
    [settings, occupied, now],
  );
  const summary = useMemo(
    () => capacitySummary(settings, occupied, now, DAYS_SHOWN),
    [settings, occupied, now],
  );

  const assignmentByDraft = useMemo(() => {
    const map = new Map<string, ScheduleAssignment>();
    for (const assignment of assignments) {
      if (assignment.draftId && assignment.at > now) map.set(assignment.draftId, assignment);
    }
    return map;
  }, [assignments, now]);

  const firstQueued = drafts.find((draft) => !assignmentByDraft.has(draft.id)) ?? null;

  // 已排期 + 待确认，按天分组；同一分钟已经有 X 排期时不再重复显示分配
  const days = useMemo(() => {
    const groups = new Map<string, DayGroup>();
    const group = (at: number): DayGroup => {
      const key = localDayKey(at);
      let value = groups.get(key);
      if (!value) {
        value = { key, at, items: [] };
        groups.set(key, value);
      }
      return value;
    };
    const scheduledTimes = new Set<number>();
    for (const post of cache.posts) {
      if (post.executeAt <= now) continue;
      scheduledTimes.add(post.executeAt);
      group(post.executeAt).items.push({
        at: post.executeAt,
        id: post.id,
        text: post.text,
        media: post.media,
        mediaUrls: post.mediaUrls,
        pending: false,
      });
    }
    for (const assignment of assignments) {
      if (assignment.at <= now) continue;
      if (
        [...scheduledTimes].some((at) => Math.abs(at - assignment.at) < MINUTE_MS) ||
        assignment.at < now
      )
        continue;
      const draft = assignment.draftId
        ? drafts.find((item) => item.id === assignment.draftId)
        : undefined;
      group(assignment.at).items.push({
        at: assignment.at,
        id: `pending-${assignment.id}`,
        text: draft?.text ?? '',
        media: 0,
        pending: true,
      });
    }
    return [...groups.values()]
      .map((day) => ({ ...day, items: day.items.sort((a, b) => a.at - b.at) }))
      .sort((a, b) => a.at - b.at);
  }, [cache.posts, assignments, drafts, now]);

  const weekWindow = useMemo(() => {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() + weekOffset * DAYS_SHOWN);
    const end = new Date(start);
    end.setDate(end.getDate() + DAYS_SHOWN);
    // 本周从「现在」开始算，免得把今天已经过去的小时当成空档
    const from = weekOffset === 0 ? now : start.getTime();
    const hours = capacityBetween(settings, occupied, from, end.getTime());
    const hoursByDay = new Map<string, HourCapacity[]>();
    for (const hour of hours) {
      const key = localDayKey(hour.at);
      const list = hoursByDay.get(key);
      if (list) list.push(hour);
      else hoursByDay.set(key, [hour]);
    }
    return { start: start.getTime(), end: end.getTime(), hoursByDay };
  }, [now, weekOffset, settings, occupied]);

  const weekDays = useMemo(() => {
    const start = new Date(weekWindow.start);
    const groups = new Map(days.map((day) => [day.key, day]));
    return Array.from({ length: DAYS_SHOWN }, (_, index) => {
      const date = new Date(start);
      date.setDate(date.getDate() + index);
      const key = localDayKey(date.getTime());
      const hours = weekWindow.hoursByDay.get(key) ?? [];
      const items = groups.get(key)?.items ?? [];
      const capacity = hours.reduce((sum, hour) => sum + hour.capacity, 0);
      const free = hours.reduce((sum, hour) => sum + hour.free, 0);
      return {
        key,
        at: date.getTime(),
        used: items.length,
        capacity,
        free,
        mediaCount: items.filter((item) => item.media > 0).length,
        hasItems: items.length > 0,
        hasCapacity: hours.length > 0,
        full: hours.length > 0 && free <= 0,
        isToday: key === localDayKey(now),
        hasConflict: hasConflict(items, settings.minGapMinutes),
      } satisfies WeekDay;
    });
  }, [weekWindow, days, now, settings.minGapMinutes]);

  const preferredDayKey = useMemo(() => {
    const todayKey = localDayKey(now);
    const today = weekDays.find((day) => day.key === todayKey);
    if (today?.hasItems) return today.key;
    const withItems = weekDays.find((day) => day.hasItems);
    if (withItems) return withItems.key;
    if (next !== null) {
      const nextDay = weekDays.find((day) => day.key === localDayKey(next));
      if (nextDay) return nextDay.key;
    }
    return weekDays[0]?.key ?? todayKey;
  }, [weekDays, next, now]);
  const activeKey =
    selectedDayKey && weekDays.some((day) => day.key === selectedDayKey)
      ? selectedDayKey
      : preferredDayKey;
  const activeDay = weekDays.find((day) => day.key === activeKey) ?? weekDays[0] ?? null;
  const activeItems = useMemo(
    () => days.find((day) => day.key === activeKey)?.items ?? [],
    [days, activeKey],
  );
  const activeHours = useMemo(
    () => weekWindow.hoursByDay.get(activeKey) ?? [],
    [weekWindow, activeKey],
  );

  const timeline = useMemo(() => {
    const entries: TimelineEntry[] = activeItems.map((item) => ({
      kind: 'item',
      at: item.at,
      item,
    }));
    for (const hour of activeHours) {
      if (hour.free <= 0) continue;
      const isNext = next !== null && next >= hour.at && next < hour.at + 60 * MINUTE_MS;
      entries.push({ kind: 'slot', at: isNext ? next! : hour.at, hour, isNext });
    }
    return entries.sort((a, b) => {
      if (a.at !== b.at) return a.at - b.at;
      if (a.kind === b.kind) return 0;
      return a.kind === 'item' ? -1 : 1;
    });
  }, [activeItems, activeHours, next]);

  const selectedItem = activeItems.find((item) => item.id === selectedItemId) ?? null;
  const totalUpcoming =
    cache.posts.filter((post) => post.executeAt > now).length +
    assignments.filter((assignment) => assignment.at > now).length;
  const hasAnySchedule = weekDays.some((day) => day.hasItems || day.hasCapacity);

  async function sync(): Promise<void> {
    try {
      await sendToXPage({ type: OPEN_SCHEDULED_MESSAGE });
      notify(c.syncing);
    } catch {
      notify(c.needXTab);
    }
  }

  function shiftWeek(delta: number): void {
    setWeekOffset((current) => Math.min(MAX_WEEK_OFFSET, Math.max(0, current + delta)));
    setSelectedDayKey(null);
    setSelectedItemId(null);
  }

  function saveDraft(): void {
    if (!draftText.trim()) return;
    void addDraft(draftText).then(setDrafts);
    setDraftText('');
  }

  async function scheduleDraft(
    draft: ComposeDraft,
    at?: number,
    openSchedule = true,
  ): Promise<void> {
    const target = at ?? assignmentByDraft.get(draft.id)?.at ?? next;
    if (target === null || target === undefined) {
      notify(c.noSlot);
      return;
    }
    const list = await setAssignment({ draftId: draft.id, text: draft.text, at: target });
    setAssignments(list);
    try {
      const result = (await sendToXPage({
        type: COMPOSE_DRAFT_MESSAGE,
        text: draft.text,
        at: target,
        openSchedule,
      })) as { ok?: boolean; reason?: string } | null;
      if (result?.ok) notify(openSchedule ? c.draftOpened : c.composeMediaOpened);
      else notify(result?.reason === 'busy' ? c.draftBusy : c.needXTab);
    } catch {
      notify(c.needXTab);
    }
  }

  async function scheduleNext(): Promise<void> {
    if (!firstQueued) {
      notify(c.noDraft);
      return;
    }
    await scheduleDraft(firstQueued);
  }

  async function writeNewPost(at?: number): Promise<void> {
    if (at !== undefined) {
      setAssignments(await setAssignment({ text: '', at }));
      await setComposeIntent(at);
    }
    try {
      if (browser.windows?.create) {
        await browser.windows.create({
          url: COMPOSE_URL,
          type: 'popup',
          width: 620,
          height: 780,
          focused: true,
        });
      } else {
        await browser.tabs.create({ url: COMPOSE_URL });
      }
    } catch {
      if (at !== undefined) setAssignments(await removeAssignmentsMatching('', at));
      notify(c.openFailed);
    }
  }

  async function fillSlot(hour: HourCapacity): Promise<void> {
    const at = pickSlotInHour(hour, settings, occupied, now);
    if (at === null) {
      notify(c.noCapacity);
      return;
    }
    if (firstQueued) {
      await scheduleDraft(firstQueued, at);
      return;
    }
    await writeNewPost(at);
  }

  async function rerollDraft(draft: ComposeDraft): Promise<void> {
    const current = assignmentByDraft.get(draft.id);
    const at = nextFreeSlots(
      settings,
      current ? occupied.filter((time) => time !== current.at) : occupied,
      now,
      1,
    )[0];
    if (at === undefined) {
      notify(c.noSlot);
      return;
    }
    await scheduleDraft(draft, at);
  }

  async function clearAssignment(draft: ComposeDraft): Promise<void> {
    const list = await removeAssignmentForDraft(draft.id);
    setAssignments(list);
  }

  async function deleteDraft(draft: ComposeDraft): Promise<void> {
    const list = await removeAssignmentForDraft(draft.id);
    setAssignments(list);
    setDrafts(await removeDraft(draft.id));
  }

  function copyText(text: string): void {
    void navigator.clipboard.writeText(text).then(
      () => notify(c.copied),
      () => undefined,
    );
  }

  async function openArticle(id: string): Promise<void> {
    const url = `https://x.com/compose/articles/edit/${id}`;
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id && /^https:\/\/(www\.)?x\.com\//.test(tab.url ?? ''))
      await browser.tabs.update(tab.id, { url });
    else await browser.tabs.create({ url });
  }

  return (
    <section className="view write-view" ref={rootRef}>
      <section className="block" aria-label={c.upcoming}>
        <div className="block-head">
          <h2>{c.upcoming}</h2>
          {totalUpcoming ? <span className="count">{totalUpcoming}</span> : null}
          <HelpIcon text={c.upcomingHint} />
          <span
            className="row-meta write-synced"
            title={`${cache.account ? `@${cache.account} · ` : ''}${
              cache.syncedAt ? c.synced(formatAgo(cache.syncedAt, language)) : c.neverSynced
            }`}
          >
            {cache.account ? `@${cache.account} · ` : ''}
            {cache.syncedAt ? c.synced(formatAgo(cache.syncedAt, language)) : c.neverSynced}
          </span>
          <IconButton icon="refresh" label={c.sync} onClick={() => void sync()} />
          <button
            type="button"
            className="icon-button"
            aria-label={UI_COPY[language].writeSettings}
            title={UI_COPY[language].writeSettings}
            onClick={onOpenCadence}
          >
            <AppIcon name="settings" size={15} />
          </button>
        </div>

        <div className="write-hero">
          <div className="write-hero-main">
            <span className="write-hero-time">
              <span className="write-hero-label">{c.next}</span>
              {next !== null ? slotLabel(next, now, language) : c.noSlot}
            </span>
            {next !== null ? (
              <span className="write-hero-until">{untilLabel(next, now, language)}</span>
            ) : null}
          </div>
          <span className="row-meta">{c.remaining(summary.free)}</span>
        </div>

        <div className="write-actions">
          <button type="button" className="primary-button" onClick={() => void writeNewPost()}>
            <AppIcon name="plus" size={14} />
            <span>{c.newPost}</span>
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={!firstQueued || next === null}
            onClick={() => void scheduleNext()}
          >
            <AppIcon name="calendar" size={14} />
            <span>{c.scheduleNext}</span>
          </button>
        </div>

        {weekDays.length ? (
          <>
            <div className="write-week-head">
              <span className="row-meta">
                {weekRangeLabel(weekWindow.start, weekWindow.end, language)}
              </span>
              <span className="write-week-arrows">
                <button
                  type="button"
                  className="icon-button write-week-arrow is-prev"
                  aria-label={c.prevWeek}
                  title={c.prevWeek}
                  disabled={weekOffset === 0}
                  onClick={() => shiftWeek(-1)}
                >
                  <AppIcon name="chevron" size={14} />
                </button>
                <button
                  type="button"
                  className="icon-button write-week-arrow"
                  aria-label={c.nextWeek}
                  title={c.nextWeek}
                  disabled={weekOffset >= MAX_WEEK_OFFSET}
                  onClick={() => shiftWeek(1)}
                >
                  <AppIcon name="chevron" size={14} />
                </button>
              </span>
            </div>
            <div className="write-week" role="tablist" aria-label={c.week}>
              {weekDays.map((day) => {
                const count =
                  day.capacity > 0
                    ? c.capacityValue(day.used, day.capacity)
                    : day.used > 0
                      ? c.dayCount(day.used)
                      : c.noScheduleDay;
                return (
                  <button
                    key={day.key}
                    type="button"
                    role="tab"
                    aria-selected={day.key === activeKey}
                    className={`write-weekday${day.key === activeKey ? ' is-selected' : ''}${
                      day.isToday ? ' is-today' : ''
                    }${day.full ? ' is-full' : ''}${
                      day.capacity > 0 && day.used > day.capacity ? ' is-over' : ''
                    }`}
                    title={`${dayLabel(day.at, now, language)} · ${count}${
                      day.mediaCount ? ` · ${c.media(day.mediaCount)}` : ''
                    }`}
                    onClick={() => {
                      setSelectedDayKey(day.key);
                      setSelectedItemId(null);
                    }}
                  >
                    <span className="write-weekday-name">
                      {day.isToday
                        ? dayLabel(day.at, now, language)
                        : weekdayLabel(new Date(day.at).getDay(), language)}
                    </span>
                    <span className="write-weekday-date">{new Date(day.at).getDate()}</span>
                    <span className="write-weekday-count">{count}</span>
                    {day.mediaCount ? (
                      <span className="write-weekday-media" aria-hidden="true" />
                    ) : null}
                  </button>
                );
              })}
            </div>
          </>
        ) : null}

        {hasAnySchedule && activeDay ? (
          <>
            <h3 className="write-day-title">
              <span>{dayLabel(activeDay.at, now, language)}</span>
              <span className="row-meta">
                {activeDay.capacity > 0
                  ? c.capacityValue(activeDay.used, activeDay.capacity)
                  : activeDay.used > 0
                    ? c.dayCount(activeDay.used)
                    : c.noScheduleDay}
              </span>
              {activeDay.hasConflict ? (
                <span className="write-warn-inline">{c.tooClose}</span>
              ) : null}
            </h3>

            {timeline.length === 0 ? (
              <div className="empty-state is-clean">
                <p>{c.noScheduleDay}</p>
              </div>
            ) : (
              <div className="write-timeline">
                {timeline.map((entry) =>
                  entry.kind === 'item' ? (
                    <button
                      key={entry.item.id}
                      type="button"
                      className={`write-item is-post${
                        entry.item.pending ? ' is-pending' : ''
                      }${entry.item.id === selectedItemId ? ' is-selected' : ''}`}
                      onClick={() =>
                        setSelectedItemId((current) =>
                          current === entry.item.id ? null : entry.item.id,
                        )
                      }
                    >
                      <span className="write-time">{clockOf(entry.item.at)}</span>
                      <MediaThumbs
                        urls={entry.item.mediaUrls}
                        count={entry.item.media}
                        limit={2}
                        size={24}
                      />
                      <span className="write-text">
                        {entry.item.text ||
                          (entry.item.media ? c.noText : entry.item.pending ? c.pendingPost : '')}
                      </span>
                      {entry.item.pending ? (
                        <span className="write-status is-pending">{c.pending}</span>
                      ) : null}
                    </button>
                  ) : (
                    <button
                      key={`slot-${entry.hour.at}`}
                      type="button"
                      className={`write-item is-slot${entry.isNext ? ' is-next' : ''}`}
                      title={`${slotLabel(entry.at, now, language)} · ${c.slotHint(
                        firstQueued !== null,
                      )}`}
                      onClick={() => void fillSlot(entry.hour)}
                    >
                      <span className="write-time">{clockOf(entry.at)}</span>
                      <AppIcon name="plus" size={14} />
                      <span className="write-text">{c.free}</span>
                      {entry.isNext ? (
                        <span className="write-status is-next">{c.nextBadge}</span>
                      ) : null}
                    </button>
                  ),
                )}
              </div>
            )}

            {selectedItem ? (
              <section className="write-detail" aria-label={c.detail}>
                <div className="write-detail-head">
                  <span className="write-detail-time">
                    {slotLabel(selectedItem.at, now, language)}
                  </span>
                  <span className={`write-status${selectedItem.pending ? ' is-pending' : ''}`}>
                    {selectedItem.pending ? c.pending : c.scheduled}
                  </span>
                  <IconButton
                    icon="x"
                    label={c.closeDetail}
                    onClick={() => setSelectedItemId(null)}
                  />
                </div>
                {selectedItem.text ? (
                  <p className="write-detail-text">{selectedItem.text}</p>
                ) : selectedItem.pending ? (
                  <p className="write-detail-text">{c.pendingPost}</p>
                ) : null}
                <MediaThumbs
                  urls={selectedItem.mediaUrls}
                  count={selectedItem.media}
                  limit={4}
                  size={40}
                  label={c.media(selectedItem.media)}
                />
                <div className="write-detail-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={!selectedItem.text}
                    onClick={() => copyText(selectedItem.text)}
                  >
                    <AppIcon name="copy" size={14} />
                    <span>{c.copyDraft}</span>
                  </button>
                  {selectedItem.pending ? (
                    <span className="row-meta">{c.pendingHint}</span>
                  ) : (
                    <button type="button" className="secondary-button" onClick={() => void sync()}>
                      <AppIcon name="external" size={14} />
                      <span>{c.editInX}</span>
                    </button>
                  )}
                </div>
              </section>
            ) : null}
          </>
        ) : (
          <div className="empty-state is-clean write-empty">
            <p>{c.empty}</p>
            <span className="row-meta">{c.emptyHint}</span>
            <div className="write-empty-actions">
              <button type="button" className="secondary-button" onClick={onOpenCadence}>
                {c.adjust}
              </button>
              <button type="button" className="secondary-button" onClick={() => void sync()}>
                {c.openScheduled}
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="block" aria-label={c.drafts}>
        <div className="block-head">
          <h2>{c.drafts}</h2>
          {drafts.length ? <span className="count">{drafts.length}</span> : null}
          <HelpIcon text={c.draftsHint} />
        </div>
        <div className="write-compose">
          <textarea
            className="write-textarea"
            rows={3}
            value={draftText}
            placeholder={c.draftPlaceholder}
            aria-label={c.drafts}
            onChange={(event) => setDraftText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                saveDraft();
              }
            }}
          />
          <div className="write-compose-foot">
            <span className={`row-meta${tweetLength(draftText) > 280 ? ' write-over' : ''}`}>
              {c.length(tweetLength(draftText))}
            </span>
            <button type="button" className="secondary-button" onClick={saveDraft}>
              {c.addDraft}
            </button>
          </div>
        </div>
        {drafts.map((draft, index) => {
          const assignment = assignmentByDraft.get(draft.id);
          return (
            <div className="write-draft" key={draft.id}>
              <p className="write-draft-text">{draft.text}</p>
              <div className="write-draft-foot">
                <span className={`row-meta${tweetLength(draft.text) > 280 ? ' write-over' : ''}`}>
                  {c.length(tweetLength(draft.text))}
                </span>
                {assignment ? (
                  <span className="row-meta write-assigned">
                    {slotLabel(assignment.at, now, language)} · {c.assigned}
                  </span>
                ) : null}
                <span className="write-draft-actions">
                  <IconButton
                    icon="calendar"
                    label={assignment ? c.openDraft : c.scheduleDraft}
                    hint={
                      assignment
                        ? slotLabel(assignment.at, now, language)
                        : next !== null
                          ? slotLabel(next, now, language)
                          : c.noSlot
                    }
                    onClick={() => void scheduleDraft(draft)}
                  />
                  <IconButton
                    icon="image"
                    label={c.composeMedia}
                    hint={c.composeMediaHint}
                    onClick={() => void scheduleDraft(draft, undefined, false)}
                  />
                  {assignment ? (
                    <>
                      <IconButton
                        icon="refresh"
                        label={c.reroll}
                        onClick={() => void rerollDraft(draft)}
                      />
                      <IconButton
                        icon="x"
                        label={c.clearAssignment}
                        onClick={() => void clearAssignment(draft)}
                      />
                    </>
                  ) : null}
                  <IconButton
                    icon="copy"
                    label={c.copyDraft}
                    onClick={() => copyText(draft.text)}
                  />
                  <IconButton
                    icon="up"
                    label={c.moveUp}
                    disabled={index === 0}
                    onClick={() => void moveDraft(draft.id, -1).then(setDrafts)}
                  />
                  <IconButton
                    icon="down"
                    label={c.moveDown}
                    disabled={index === drafts.length - 1}
                    onClick={() => void moveDraft(draft.id, 1).then(setDrafts)}
                  />
                  <IconButton
                    icon="x"
                    label={c.deleteDraft}
                    onClick={() => void deleteDraft(draft)}
                  />
                </span>
              </div>
            </div>
          );
        })}
      </section>

      <section className="block" aria-label={c.backups}>
        <div className="block-head">
          <h2>{c.backups}</h2>
          {backups.length ? <span className="count">{backups.length}</span> : null}
          <HelpIcon text={c.backupsHint} />
        </div>
        {backups.length === 0 ? (
          <div className="empty-state is-clean">
            <p>{c.backupsEmpty}</p>
          </div>
        ) : (
          backups.map((backup) => {
            const pick = Math.min(versionPick[backup.id] ?? 0, backup.versions.length - 1);
            const version = backup.versions[pick]!;
            const latest = backup.versions[0]!;
            const markdown = version.title.trim()
              ? `# ${version.title.trim()}\n\n${version.markdown}`
              : version.markdown;
            return (
              <div className="row write-backup" key={backup.id}>
                <span className="row-label">
                  <span>{latest.title.trim() || c.untitled}</span>
                </span>
                {backup.versions.length > 1 ? (
                  <select
                    className="sort-select"
                    value={pick}
                    aria-label={c.version}
                    onChange={(event) =>
                      setVersionPick((current) => ({
                        ...current,
                        [backup.id]: Number(event.target.value),
                      }))
                    }
                  >
                    {backup.versions.map((v, i) => (
                      <option key={v.savedAt} value={i}>
                        {formatAgo(v.savedAt, language)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="row-meta">{formatAgo(latest.savedAt, language)}</span>
                )}
                <span className="row-control">
                  <IconButton icon="copy" label={c.copyBackup} onClick={() => copyText(markdown)} />
                  <IconButton
                    icon="external"
                    label={c.openArticle}
                    onClick={() => void openArticle(backup.id)}
                  />
                  <IconButton
                    icon="x"
                    label={c.deleteBackup}
                    onClick={() => void removeBackup(backup.id).then(setBackups)}
                  />
                </span>
              </div>
            );
          })
        )}
      </section>

      <section className="block" aria-label={c.helpers}>
        <div className="block-head">
          <h2>{c.helpers}</h2>
        </div>
        <div className="row">
          <span className="row-label">
            <span>{c.composeHelper}</span>
            <HelpIcon text={c.composeHelperHint} />
          </span>
          <Toggle
            checked={settings.composeHelper}
            label={c.composeHelper}
            onChange={(composeHelper) => update({ composeHelper })}
          />
        </div>
        <div className="row">
          <span className="row-label">
            <span>{c.articleHelper}</span>
            <HelpIcon text={c.articleHelperHint} />
          </span>
          <Toggle
            checked={settings.articleHelper}
            label={c.articleHelper}
            onChange={(articleHelper) => update({ articleHelper })}
          />
        </div>
      </section>
    </section>
  );
}
