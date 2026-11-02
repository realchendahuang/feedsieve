/**
 * 「发帖」视图：只读排期台。
 *
 * 这里只显示排了多少条、这一周和当天的排期列表；不在这里写帖、贴正文或排期。
 * 发帖和改时间都在 X 原生发帖框 /「安排表」里完成，扩展只在安排表里加快捷时间。
 * 已排期列表来自 X 自己的「预排期」页（同步 = 让当前 X 页面打开那一页，X 自己去拉），
 * 你在 X 里新建 / 改 / 删预排期帖子时也会顺带更新。全部只存本机。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { UI_COPY, type UiLanguage } from '../../../src/lib/platform/i18n';
import {
  DEFAULT_SCHEDULE_SETTINGS,
  capacityBetween,
  capacitySummary,
  dayLabel,
  formatClock,
  localDayKey,
  nextFreeSlots,
  slotLabel,
  weekdayLabel,
  type HourCapacity,
  type ScheduleSettings,
} from '../../../src/lib/compose/schedule-slots';
import {
  EMPTY_SCHEDULED_CACHE,
  getScheduledCache,
  getScheduleSettings,
  subscribeScheduledCache,
  subscribeScheduleSettings,
  upcomingTimes,
  type ScheduledCache,
} from '../../../src/lib/compose/schedule-store';
import { OPEN_SCHEDULED_MESSAGE } from '../../../src/lib/compose/compose-schedule';
import { AppIcon, formatAgo, HelpIcon, IconButton } from './shared';
import { useListPosition } from './use-list-position';

const DAYS_SHOWN = 7;
const MAX_WEEK_OFFSET = 4;
const MINUTE_MS = 60_000;
const MEDIA_URL_RE = /^https:\/\/(pbs|video)\.twimg\.com\//;

const COPY = {
  zh: {
    upcoming: '排期',
    upcomingHint:
      '已排期来自 X 的「草稿 › 预排期」：点同步会在当前 X 页面打开那一页，由 X 自己加载；你在 X 里新建、修改、删除预排期帖子时也会自动更新。这里只显示，不在这里写帖或排期；写帖和改时间都在 X 原生发帖框 /「安排表」里完成。只存在本机。',
    sync: '同步预排期列表',
    synced: (ago: string) => ago,
    neverSynced: '还没同步过',
    next: '下一条空档',
    noSlot: '节奏里没有空位',
    remaining: (n: number) => `本周还能排 ${n} 条`,
    needXTab: '先在当前窗口打开 X',
    syncing: '已在 X 页面打开预排期列表',
    media: (n: number) => `${n} 张图`,
    noText: '（只有图片）',
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
    tooClose: '间隔太近',
    detail: '排期详情',
    closeDetail: '收起',
    editInX: '在 X 里改时间',
    copyDraft: '复制文案',
    copied: '已复制',
  },
  en: {
    upcoming: 'Schedule',
    upcomingHint:
      'Scheduled posts come from X’s Drafts › Scheduled page: Sync opens that page in the current X tab and X loads it itself. Creating, editing or deleting scheduled posts on X also updates this list. This view is read-only; write and reschedule in X’s composer and schedule dialog. Stored on this device only.',
    sync: 'Sync scheduled posts',
    synced: (ago: string) => ago,
    neverSynced: 'Not synced yet',
    next: 'Next open slot',
    noSlot: 'No open slot in your cadence',
    remaining: (n: number) => `${n} left this week`,
    needXTab: 'Open X in this window first',
    syncing: 'Opened the scheduled list on X',
    media: (n: number) => `${n} media`,
    noText: '(media only)',
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
    tooClose: 'Too close',
    detail: 'Schedule details',
    closeDetail: 'Close',
    editInX: 'Change time on X',
    copyDraft: 'Copy',
    copied: 'Copied',
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
  onOpenSettings,
}: {
  language: UiLanguage;
  notify: (message: string | null) => void;
  sendToXPage: (message: { type: string }) => Promise<unknown>;
  onOpenSettings: () => void;
}) {
  const c = COPY[language];
  const [settings, setSettings] = useState<ScheduleSettings>(DEFAULT_SCHEDULE_SETTINGS);
  const [cache, setCache] = useState<ScheduledCache>(EMPTY_SCHEDULED_CACHE);
  const [now, setNow] = useState(() => Date.now());
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const rootRef = useRef<HTMLElement | null>(null);

  // 切走再回来：回到上次看的位置
  useListPosition({
    storageKey: 'writePositionV1',
    pageKey: 'write',
    rootRef,
    ready: cache.posts.length > 0,
  });

  useEffect(() => {
    void getScheduleSettings().then(setSettings);
    void getScheduledCache().then(setCache);
    const unsubs = [subscribeScheduleSettings(setSettings), subscribeScheduledCache(setCache)];
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      unsubs.forEach((fn) => fn());
      window.clearInterval(timer);
    };
  }, []);

  const occupied = useMemo(() => upcomingTimes(cache, now), [cache, now]);
  const next = useMemo(
    () => nextFreeSlots(settings, occupied, now, 1)[0] ?? null,
    [settings, occupied, now],
  );
  const summary = useMemo(
    () => capacitySummary(settings, occupied, now, DAYS_SHOWN),
    [settings, occupied, now],
  );

  const days = useMemo(() => {
    const groups = new Map<string, DayGroup>();
    for (const post of cache.posts) {
      if (post.executeAt <= now) continue;
      const key = localDayKey(post.executeAt);
      let group = groups.get(key);
      if (!group) {
        group = { key, at: post.executeAt, items: [] };
        groups.set(key, group);
      }
      group.items.push({
        at: post.executeAt,
        id: post.id,
        text: post.text,
        media: post.media,
        mediaUrls: post.mediaUrls,
      });
    }
    return [...groups.values()]
      .map((day) => ({ ...day, items: day.items.sort((a, b) => a.at - b.at) }))
      .sort((a, b) => a.at - b.at);
  }, [cache.posts, now]);

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
  const selectedItem = activeItems.find((item) => item.id === selectedItemId) ?? null;
  const totalUpcoming = cache.posts.filter((post) => post.executeAt > now).length;
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

  function copyText(text: string): void {
    void navigator.clipboard.writeText(text).then(
      () => notify(c.copied),
      () => undefined,
    );
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
            onClick={onOpenSettings}
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

            {activeItems.length === 0 ? (
              <div className="empty-state is-clean">
                <p>{c.noScheduleDay}</p>
              </div>
            ) : (
              <div className="write-timeline">
                {activeItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`write-item is-post${
                      item.id === selectedItemId ? ' is-selected' : ''
                    }`}
                    onClick={() =>
                      setSelectedItemId((current) => (current === item.id ? null : item.id))
                    }
                  >
                    <span className="write-time">{clockOf(item.at)}</span>
                    <MediaThumbs urls={item.mediaUrls} count={item.media} limit={2} size={24} />
                    <span className="write-text">{item.text || (item.media ? c.noText : '')}</span>
                  </button>
                ))}
              </div>
            )}

            {selectedItem ? (
              <section className="write-detail" aria-label={c.detail}>
                <div className="write-detail-head">
                  <span className="write-detail-time">
                    {slotLabel(selectedItem.at, now, language)}
                  </span>
                  <span className="write-status">{c.scheduled}</span>
                  <IconButton
                    icon="x"
                    label={c.closeDetail}
                    onClick={() => setSelectedItemId(null)}
                  />
                </div>
                {selectedItem.text ? (
                  <p className="write-detail-text">{selectedItem.text}</p>
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
                  <button type="button" className="secondary-button" onClick={() => void sync()}>
                    <AppIcon name="external" size={14} />
                    <span>{c.editInX}</span>
                  </button>
                </div>
              </section>
            ) : null}
          </>
        ) : (
          <div className="empty-state is-clean write-empty">
            <p>{c.empty}</p>
            <span className="row-meta">{c.emptyHint}</span>
            <div className="write-empty-actions">
              <button type="button" className="secondary-button" onClick={onOpenSettings}>
                {c.adjust}
              </button>
              <button type="button" className="secondary-button" onClick={() => void sync()}>
                {c.openScheduled}
              </button>
            </div>
          </div>
        )}
      </section>
    </section>
  );
}
