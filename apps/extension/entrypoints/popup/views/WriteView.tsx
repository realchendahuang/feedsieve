/**
 * 「发帖」视图：已排期的帖子和接下来的空档（按天）、草稿队列、发帖时间表、文章备份、
 * 发帖框和文章编辑器的助手开关。
 *
 * 已排期列表来自 X 自己的「预排期」页（同步 = 让当前 X 页面打开那一页，X 自己去拉，扩展顺带记下），
 * 你在 X 里新建 / 改 / 删预排期帖子时也会顺带更新。全部只存本机。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { analyzeProfile, HEATMAP_SLOT_HOURS } from '@feedsieve/metrics';
import type { UiLanguage } from '../../../src/lib/platform/i18n';
import {
  DEFAULT_SCHEDULE_SETTINGS,
  GAP_OPTIONS,
  INTERVAL_OPTIONS,
  dayLabel,
  formatClock,
  localDayKey,
  nextFreeSlots,
  parseClock,
  recommendTimes,
  slotLabel,
  slotsBetween,
  weekdayLabel,
  type ScheduleSettings,
} from '../../../src/lib/compose/schedule-slots';
import {
  addDraft,
  getBackups,
  getDrafts,
  moveDraft,
  removeBackup,
  removeDraft,
  subscribeBackups,
  subscribeDrafts,
  tweetLength,
  type ArticleBackup,
  type ComposeDraft,
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
import { getSelfHandle } from '../../../src/lib/community/following-allowlist';
import { asCatalogEntry } from './profile-model';
import { AppIcon, formatAgo, HelpIcon, IconButton, Toggle } from './shared';

const DAYS_SHOWN = 7;
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

const COPY = {
  zh: {
    upcoming: '排期',
    upcomingHint:
      '已排期的帖子来自 X 的「草稿 › 预排期」：点同步会在当前 X 页面打开那一页，由 X 自己加载；你在 X 里新建、修改、删除预排期帖子时也会自动更新。空档按下面的时间表算。只存在本机。',
    sync: '同步预排期列表',
    synced: (ago: string) => `同步于 ${ago}`,
    neverSynced: '还没同步过',
    next: '下一个空档',
    noSlot: '没有空档',
    free: '空档',
    empty: '接下来 7 天没有排期，也没有空档',
    needXTab: '先在当前窗口打开 X',
    syncing: '已在 X 页面打开预排期列表',
    media: (n: number) => `${n} 张图`,
    noText: '（只有图片）',
    schedule: '时间表',
    scheduleHint:
      '发帖框里点日历旁的「下一个空档」按钮（或 Alt+N），会打开 X 的安排表并填好这里的下一个空档，你只需点 X 的「确认」。前后间隔内已有排期的时间算被占。',
    mode: '方式',
    modes: { times: '固定时间', interval: '按间隔' },
    times: '时间点',
    add: '添加',
    remove: (t: string) => `删除 ${t}`,
    recommend: '按我的数据推荐',
    recommendHint:
      '用「主页」里你自己账号各发帖时段的爆款倍数，挑表现最好的 3 个时段。要先打开过自己的主页。',
    recommendNone: '自己主页的数据还不够，先打开自己的主页刷一会儿',
    recommended: (list: string) => `已换成 ${list}`,
    days: '星期',
    from: '从',
    to: '到',
    every: '每隔',
    minutes: (m: number) => (m % 60 === 0 ? `${m / 60} 小时` : `${m} 分钟`),
    gap: '最小间隔',
    gapHint: '离已排期的帖子不到这么久的时间点，不算空档。',
    gapNone: '不限',
    lead: '最早',
    leadHint: '空档至少在现在之后这么多分钟，留出写完的时间。',
    drafts: '草稿',
    draftsHint:
      '先在这里写好几条，再一条条点日历按钮：会在当前 X 页面打开发帖框、贴好正文、填好下一个空档，你检查后点 X 的「确认」和「预排期」。排好后这条草稿自动从这里拿掉。只存在本机。',
    draftPlaceholder: '写一条，⌘↵ 加入',
    addDraft: '加入草稿',
    scheduleDraft: '排进下一个空档',
    copyDraft: '复制',
    deleteDraft: '删除',
    moveUp: '上移',
    moveDown: '下移',
    draftOpened: '已在 X 打开发帖框并填好时间，确认后点「预排期」',
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
      '发帖框日历图标旁的「下一个空档」按钮，以及 X 安排表顶上的快捷时间（+1 小时、明天此时、同上一条、±15 分钟）。',
    articleHelper: '文章编辑增强',
    articleHelperHint:
      '在 X 文章编辑器里粘贴 Markdown 自动排版（标题、列表、引用、加粗、链接、代码块），开头的 # 标题自动填进文章标题；右下角显示字数、阅读时长和大纲，可导入 .md 文件。⌘⇧V 粘贴原文。',
  },
  en: {
    upcoming: 'Schedule',
    upcomingHint:
      'Scheduled posts come from X’s Drafts › Scheduled page: Sync opens that page in the current X tab and X loads it itself. Creating, editing or deleting scheduled posts on X also updates this list. Free slots follow the schedule below. Stored on this device only.',
    sync: 'Sync scheduled posts',
    synced: (ago: string) => `Synced ${ago}`,
    neverSynced: 'Not synced yet',
    next: 'Next free slot',
    noSlot: 'No free slot',
    free: 'Free',
    empty: 'Nothing scheduled and no free slots in the next 7 days',
    needXTab: 'Open X in this window first',
    syncing: 'Opened the scheduled list on X',
    media: (n: number) => `${n} media`,
    noText: '(media only)',
    schedule: 'Posting times',
    scheduleHint:
      'In the composer, the Next slot button next to the calendar icon (or Alt+N) opens X’s schedule dialog filled with the next free slot; you only click Confirm. Times within the gap of a scheduled post count as taken.',
    mode: 'Mode',
    modes: { times: 'Fixed times', interval: 'Interval' },
    times: 'Times',
    add: 'Add',
    remove: (t: string) => `Remove ${t}`,
    recommend: 'Suggest from my data',
    recommendHint:
      'Picks the 3 best posting periods from your own Profile view. Open your own profile first.',
    recommendNone: 'Not enough data yet; open your own profile and scroll a bit',
    recommended: (list: string) => `Changed to ${list}`,
    days: 'Days',
    from: 'From',
    to: 'to',
    every: 'Every',
    minutes: (m: number) => (m % 60 === 0 ? `${m / 60} h` : `${m} min`),
    gap: 'Minimum gap',
    gapHint: 'Times closer than this to a scheduled post are not free.',
    gapNone: 'None',
    lead: 'Earliest',
    leadHint: 'Free slots start at least this many minutes from now.',
    drafts: 'Drafts',
    draftsHint:
      'Write a few posts here, then press the calendar button on one: X’s composer opens in the current tab with the text and the next free slot filled in; review it and click Confirm and Schedule on X. Scheduled drafts are removed from this list. Stored on this device only.',
    draftPlaceholder: 'Write a post, ⌘↵ to add',
    addDraft: 'Add draft',
    scheduleDraft: 'Schedule in next slot',
    copyDraft: 'Copy',
    deleteDraft: 'Delete',
    moveUp: 'Move up',
    moveDown: 'Move down',
    draftOpened: 'Opened on X with the time filled in; confirm, then Schedule',
    draftBusy: 'X’s composer still has unfinished text; deal with it first',
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
      'The Next slot button next to the calendar icon in the composer, and quick times at the top of X’s schedule dialog.',
    articleHelper: 'Article editor',
    articleHelperHint:
      'Paste Markdown into the X article editor to format it; a leading # heading becomes the title. A panel shows word count, reading time and outline, and imports .md files. ⌘⇧V pastes plain text.',
  },
} as const;

const LEAD_OPTIONS = [0, 5, 10, 30, 60] as const;

function clockOf(at: number): string {
  const d = new Date(at);
  return formatClock(d.getHours() * 60 + d.getMinutes());
}

interface DayGroup {
  key: string;
  at: number;
  posts: Array<{ at: number; id: string; text: string; media: number }>;
  slots: number[];
}

export function WriteView({
  language,
  notify,
  sendToXPage,
}: {
  language: UiLanguage;
  notify: (message: string | null) => void;
  sendToXPage: (message: { type: string; text?: string }) => Promise<unknown>;
}) {
  const c = COPY[language];
  const [settings, setSettings] = useState<ScheduleSettings>(DEFAULT_SCHEDULE_SETTINGS);
  const [cache, setCache] = useState<ScheduledCache>(EMPTY_SCHEDULED_CACHE);
  const [now, setNow] = useState(() => Date.now());
  const [draftTime, setDraftTime] = useState('');
  const [drafts, setDrafts] = useState<ComposeDraft[]>([]);
  const [draftText, setDraftText] = useState('');
  const [backups, setBackups] = useState<ArticleBackup[]>([]);
  const [versionPick, setVersionPick] = useState<Record<string, number>>({});

  useEffect(() => {
    void getScheduleSettings().then(setSettings);
    void getScheduledCache().then(setCache);
    void getDrafts().then(setDrafts);
    void getBackups().then(setBackups);
    const unsubs = [
      subscribeScheduleSettings(setSettings),
      subscribeScheduledCache(setCache),
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

  const occupied = useMemo(() => upcomingTimes(cache, now), [cache, now]);
  const next = useMemo(
    () => nextFreeSlots(settings, occupied, now, 1)[0] ?? null,
    [settings, occupied, now],
  );

  // 按天分组：所有已排期的帖子；空档只列接下来 7 天，一天一行
  const days = useMemo(() => {
    const until = new Date(now + DAYS_SHOWN * DAY_MS).setHours(0, 0, 0, 0);
    const groups = new Map<string, DayGroup>();
    const group = (at: number): DayGroup => {
      const key = localDayKey(at);
      let value = groups.get(key);
      if (!value) {
        value = { key, at, posts: [], slots: [] };
        groups.set(key, value);
      }
      return value;
    };
    for (const p of cache.posts) {
      if (p.executeAt > now)
        group(p.executeAt).posts.push({ at: p.executeAt, id: p.id, text: p.text, media: p.media });
    }
    for (const at of nextFreeSlots(settings, occupied, now, 200)) {
      if (at < until) group(at).slots.push(at);
    }
    return [...groups.values()].sort((a, b) => a.at - b.at);
  }, [cache.posts, settings, occupied, now]);

  // 本周的槽位数（看时间表是不是空的）
  const hasSlots = useMemo(
    () => slotsBetween(settings, now, now + 7 * DAY_MS).length > 0,
    [settings, now],
  );

  async function sync(): Promise<void> {
    try {
      await sendToXPage({ type: OPEN_SCHEDULED_MESSAGE });
      notify(c.syncing);
    } catch {
      notify(c.needXTab);
    }
  }

  async function openScheduled(): Promise<void> {
    await sync();
  }

  function saveDraft(): void {
    if (!draftText.trim()) return;
    void addDraft(draftText).then(setDrafts);
    setDraftText('');
  }

  async function scheduleDraft(draft: ComposeDraft): Promise<void> {
    try {
      const result = (await sendToXPage({ type: COMPOSE_DRAFT_MESSAGE, text: draft.text })) as {
        ok?: boolean;
        reason?: string;
      } | null;
      if (result?.ok) notify(c.draftOpened);
      else notify(result?.reason === 'busy' ? c.draftBusy : c.needXTab);
    } catch {
      notify(c.needXTab);
    }
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

  async function recommend(): Promise<void> {
    const self = await getSelfHandle();
    const entry = self
      ? asCatalogEntry(
          await browser.runtime
            .sendMessage({ type: 'feedsieve:profile-get', handle: self })
            .catch(() => null),
          self,
        )
      : null;
    const heatmap = entry ? analyzeProfile(Object.values(entry.posts), Date.now()).heatmap : null;
    const times = heatmap ? recommendTimes(heatmap.cells, HEATMAP_SLOT_HOURS, 3) : [];
    if (times.length === 0) {
      notify(c.recommendNone);
      return;
    }
    update({ mode: 'times', times });
    notify(c.recommended(times.join('、')));
  }

  function addTime(): void {
    const minutes = parseClock(draftTime);
    if (minutes === null) return;
    update({ times: [...settings.times, formatClock(minutes)] });
    setDraftTime('');
  }

  function toggleDay(day: number): void {
    update({
      days: settings.days.includes(day)
        ? settings.days.filter((d) => d !== day)
        : [...settings.days, day],
    });
  }

  const weekOrder = [1, 2, 3, 4, 5, 6, 0];

  return (
    <section className="view write-view">
      <section className="block" aria-label={c.upcoming}>
        <div className="block-head">
          <h2>{c.upcoming}</h2>
          {cache.posts.length ? (
            <span className="count">{cache.posts.filter((p) => p.executeAt > now).length}</span>
          ) : null}
          <HelpIcon text={c.upcomingHint} />
          <span className="row-meta write-synced">
            {cache.syncedAt ? c.synced(formatAgo(cache.syncedAt, language)) : c.neverSynced}
          </span>
          <IconButton icon="refresh" label={c.sync} onClick={() => void sync()} />
        </div>
        <div className="row">
          <span className="row-label">
            <span>{c.next}</span>
          </span>
          <span className="row-value write-next">
            {next !== null ? slotLabel(next, now, language) : c.noSlot}
          </span>
        </div>
        {days.length === 0 ? (
          <div className="empty-state is-clean">
            <p>{c.empty}</p>
          </div>
        ) : (
          days.map((day) => (
            <div className="write-day" key={day.key}>
              <h3 className="write-day-title">{dayLabel(day.at, now, language)}</h3>
              {day.posts.map((post) => (
                <button
                  key={post.id}
                  type="button"
                  className="write-item is-post"
                  onClick={() => void openScheduled()}
                >
                  <span className="write-time">{clockOf(post.at)}</span>
                  <span className="write-text">{post.text || c.noText}</span>
                  {post.media ? <span className="row-meta">{c.media(post.media)}</span> : null}
                </button>
              ))}
              {day.slots.length ? (
                <div className="write-item is-slot">
                  <span className="write-time">{c.free}</span>
                  <span className="write-slots">
                    {day.slots.map((at) => (
                      <span key={at}>{clockOf(at)}</span>
                    ))}
                  </span>
                </div>
              ) : null}
            </div>
          ))
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
            <button
              type="button"
              className="secondary-button"
              disabled={!draftText.trim()}
              onClick={saveDraft}
            >
              {c.addDraft}
            </button>
          </div>
        </div>
        {drafts.map((draft, index) => (
          <div className="write-draft" key={draft.id}>
            <p className="write-draft-text">{draft.text}</p>
            <div className="write-draft-foot">
              <span className={`row-meta${tweetLength(draft.text) > 280 ? ' write-over' : ''}`}>
                {c.length(tweetLength(draft.text))}
              </span>
              <span className="write-draft-actions">
                <IconButton
                  icon="calendar"
                  label={c.scheduleDraft}
                  hint={next !== null ? slotLabel(next, now, language) : c.noSlot}
                  onClick={() => void scheduleDraft(draft)}
                />
                <IconButton icon="copy" label={c.copyDraft} onClick={() => copyText(draft.text)} />
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
                  onClick={() => void removeDraft(draft.id).then(setDrafts)}
                />
              </span>
            </div>
          </div>
        ))}
      </section>

      <section className="block" aria-label={c.schedule}>
        <div className="block-head">
          <h2>{c.schedule}</h2>
          <HelpIcon text={c.scheduleHint} />
          <button
            type="button"
            className="text-button toolbar-end"
            onClick={() => void recommend()}
          >
            <AppIcon name="sparkles" size={14} />
            <span>{c.recommend}</span>
          </button>
          <HelpIcon text={c.recommendHint} />
        </div>
        <div className="row">
          <span className="row-label">
            <span>{c.mode}</span>
          </span>
          <div className="row-control segmented" role="radiogroup" aria-label={c.mode}>
            {(['times', 'interval'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={settings.mode === mode}
                className={settings.mode === mode ? 'is-selected' : ''}
                onClick={() => update({ mode })}
              >
                {c.modes[mode]}
              </button>
            ))}
          </div>
        </div>
        {settings.mode === 'times' ? (
          <div className="row write-times">
            <span className="row-label">
              <span>{c.times}</span>
            </span>
            <div className="write-chips">
              {settings.times.map((time) => (
                <span key={time} className="chip is-on write-chip">
                  {time}
                  <button
                    type="button"
                    aria-label={c.remove(time)}
                    title={c.remove(time)}
                    onClick={() => update({ times: settings.times.filter((t) => t !== time) })}
                  >
                    <AppIcon name="x" size={12} />
                  </button>
                </span>
              ))}
              <span className="write-add">
                <input
                  type="time"
                  className="number-input write-time-input"
                  value={draftTime}
                  aria-label={c.add}
                  onChange={(event) => setDraftTime(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') addTime();
                  }}
                />
                <IconButton
                  icon="plus"
                  label={c.add}
                  disabled={parseClock(draftTime) === null}
                  onClick={addTime}
                />
              </span>
            </div>
          </div>
        ) : (
          <div className="row">
            <span className="row-label">
              <span>{c.from}</span>
            </span>
            <div className="row-control write-interval">
              <input
                type="time"
                className="number-input write-time-input"
                value={settings.intervalStart}
                aria-label={c.from}
                onChange={(event) =>
                  event.target.value && update({ intervalStart: event.target.value })
                }
              />
              <span className="row-meta">{c.to}</span>
              <input
                type="time"
                className="number-input write-time-input"
                value={settings.intervalEnd}
                aria-label={c.to}
                onChange={(event) =>
                  event.target.value && update({ intervalEnd: event.target.value })
                }
              />
              <span className="row-meta">{c.every}</span>
              <select
                className="sort-select"
                value={settings.intervalMinutes}
                aria-label={c.every}
                onChange={(event) => update({ intervalMinutes: Number(event.target.value) })}
              >
                {INTERVAL_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {c.minutes(m)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
        <div className="row">
          <span className="row-label">
            <span>{c.days}</span>
          </span>
          <div className="row-control write-days" role="group" aria-label={c.days}>
            {weekOrder.map((day) => (
              <button
                key={day}
                type="button"
                aria-pressed={settings.days.includes(day)}
                className={`chip${settings.days.includes(day) ? ' is-on' : ''}`}
                onClick={() => toggleDay(day)}
              >
                {weekdayLabel(day, language).replace('周', '')}
              </button>
            ))}
          </div>
        </div>
        <div className="row">
          <span className="row-label">
            <span>{c.gap}</span>
            <HelpIcon text={c.gapHint} />
          </span>
          <select
            className="sort-select row-control"
            value={settings.minGapMinutes}
            aria-label={c.gap}
            onChange={(event) => update({ minGapMinutes: Number(event.target.value) })}
          >
            {GAP_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {m === 0 ? c.gapNone : c.minutes(m)}
              </option>
            ))}
          </select>
        </div>
        <div className="row">
          <span className="row-label">
            <span>{c.lead}</span>
            <HelpIcon text={c.leadHint} />
          </span>
          <select
            className="sort-select row-control"
            value={settings.leadMinutes}
            aria-label={c.lead}
            onChange={(event) => update({ leadMinutes: Number(event.target.value) })}
          >
            {LEAD_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {m === 0 ? c.gapNone : c.minutes(m)}
              </option>
            ))}
          </select>
        </div>
        {!hasSlots ? <p className="row-meta write-warn">{c.noSlot}</p> : null}
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
