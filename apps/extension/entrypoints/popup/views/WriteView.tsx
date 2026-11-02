/**
 * 「发帖」视图：下一条排期、本周每小时的名额、草稿队列、文章备份、助手开关。
 *
 * 排期逻辑不在这里配：用户先在「设置 › 功能开关 › 发帖节奏」里设好集中时段和
 * 每小时最多几条，这里只负责把内容排进下一个有名额的小时。
 * 已排期列表来自 X 自己的「预排期」页（同步 = 让当前 X 页面打开那一页，X 自己去拉），
 * 你在 X 里新建 / 改 / 删预排期帖子时也会顺带更新。全部只存本机。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { UiLanguage } from '../../../src/lib/platform/i18n';
import {
  DEFAULT_SCHEDULE_SETTINGS,
  capacitySummary,
  dayLabel,
  formatClock,
  localDayKey,
  nextFreeSlots,
  pickSlotInHour,
  slotLabel,
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
  removeBackup,
  removeDraft,
  setAssignment,
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
const MINUTE_MS = 60_000;

const COPY = {
  zh: {
    upcoming: '排期',
    upcomingHint:
      '已排期的帖子来自 X 的「草稿 › 预排期」：点同步会在当前 X 页面打开那一页，由 X 自己加载；你在 X 里新建、修改、删除预排期帖子时也会自动更新。「待确认」是本机已经占好时间、还没在 X 点确认的帖子。只存在本机。',
    sync: '同步预排期列表',
    synced: (ago: string) => `同步于 ${ago}`,
    neverSynced: '还没同步过',
    next: '下一条',
    noSlot: '节奏里没有空位',
    remaining: (n: number) => `本周还能排 ${n} 条`,
    scheduleNext: '排下一条',
    needXTab: '先在当前窗口打开 X',
    syncing: '已在 X 页面打开预排期列表',
    media: (n: number) => `${n} 张图`,
    noText: '（只有图片）',
    pending: '待确认',
    pendingPost: '待确认的排期',
    empty: '接下来 7 天没有排期',
    capacity: '本周容量',
    capacityHint:
      '每个小时显示「已排 / 上限」。点一个还有空位的小时，会把队列里的下一条排进这个小时（分钟内随机）；满了的小时不能再点。到「设置 › 功能开关 › 发帖节奏」里改时段和每小时条数。',
    adjust: '调整节奏',
    capacityValue: (used: number, cap: number) => `${used}/${cap}`,
    noDraft: '先写一条草稿',
    noCapacity: '这个小时已经满了',
    drafts: '草稿',
    draftsHint:
      '先在这里写好几条，再点日历按钮：会按顺序排进下一个有名额的小时，在当前 X 页面打开发帖框、贴好正文、填好时间；你检查后点 X 的「确认」和「预排期」。排好后这条草稿自动从这里拿掉。只存在本机。',
    draftPlaceholder: '写一条，⌘↵ 加入',
    addDraft: '加入草稿',
    scheduleDraft: '排下一条',
    openDraft: '打开发帖框',
    reroll: '换一个时间',
    clearAssignment: '取消分配',
    assigned: '待确认',
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
      '发帖框日历图标旁的「排下一条」按钮，以及 X 安排表顶上的快捷时间（+1 小时、明天此时、同上一条、±15 分钟）。',
    articleHelper: '文章编辑增强',
    articleHelperHint:
      '在 X 文章编辑器里粘贴 Markdown 自动排版（标题、列表、引用、加粗、链接、代码块），开头的 # 标题自动填进文章标题；右下角显示字数、阅读时长和大纲，可导入 .md 文件。⌘⇧V 粘贴原文。',
  },
  en: {
    upcoming: 'Schedule',
    upcomingHint:
      'Scheduled posts come from X’s Drafts › Scheduled page: Sync opens that page in the current X tab and X loads it itself. Creating, editing or deleting scheduled posts on X also updates this list. Pending means the time is reserved on this device but not confirmed on X yet. Stored on this device only.',
    sync: 'Sync scheduled posts',
    synced: (ago: string) => `Synced ${ago}`,
    neverSynced: 'Not synced yet',
    next: 'Next',
    noSlot: 'No open slot in your cadence',
    remaining: (n: number) => `${n} left this week`,
    scheduleNext: 'Schedule next',
    needXTab: 'Open X in this window first',
    syncing: 'Opened the scheduled list on X',
    media: (n: number) => `${n} media`,
    noText: '(media only)',
    pending: 'Pending',
    pendingPost: 'Pending post',
    empty: 'Nothing scheduled in the next 7 days',
    capacity: 'This week',
    capacityHint:
      'Each hour shows used / limit. Click an hour with room to put the next queued draft there (a random minute inside the hour). Full hours cannot be clicked. Change windows and per-hour limits in Settings › Modules › Posting cadence.',
    adjust: 'Edit cadence',
    capacityValue: (used: number, cap: number) => `${used}/${cap}`,
    noDraft: 'Write a draft first',
    noCapacity: 'This hour is full',
    drafts: 'Drafts',
    draftsHint:
      'Write a few posts here, then press the calendar button on one: it schedules into the next open hour, opens X’s composer in the current tab, pastes the text and fills the time; review it and click Confirm and Schedule on X. Scheduled drafts are removed from this list. Stored on this device only.',
    draftPlaceholder: 'Write one, ⌘↵ to add',
    addDraft: 'Add draft',
    scheduleDraft: 'Schedule next',
    openDraft: 'Open composer',
    reroll: 'Change time',
    clearAssignment: 'Clear time',
    assigned: 'Pending',
    copyDraft: 'Copy',
    deleteDraft: 'Delete',
    moveUp: 'Move up',
    moveDown: 'Move down',
    draftOpened: 'Opened X’s composer with the time filled in; click Schedule',
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

interface DayItem {
  at: number;
  id: string;
  text: string;
  media: number;
  pending: boolean;
}

interface DayGroup {
  key: string;
  at: number;
  items: DayItem[];
}

export function WriteView({
  language,
  notify,
  sendToXPage,
  onOpenCadence,
}: {
  language: UiLanguage;
  notify: (message: string | null) => void;
  sendToXPage: (message: { type: string; text?: string; at?: number }) => Promise<unknown>;
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
  const rootRef = useRef<HTMLElement | null>(null);

  // 切走再回来：回到上次看的位置（排期、草稿、备份里随便哪一段）
  useListPosition({
    storageKey: 'writePositionV1',
    pageKey: 'write',
    rootRef,
    ready: drafts.length > 0 || backups.length > 0 || assignments.length > 0,
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

  async function sync(): Promise<void> {
    try {
      await sendToXPage({ type: OPEN_SCHEDULED_MESSAGE });
      notify(c.syncing);
    } catch {
      notify(c.needXTab);
    }
  }

  function saveDraft(): void {
    if (!draftText.trim()) return;
    void addDraft(draftText).then(setDrafts);
    setDraftText('');
  }

  async function scheduleDraft(draft: ComposeDraft, at?: number): Promise<void> {
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
      })) as { ok?: boolean; reason?: string } | null;
      if (result?.ok) notify(c.draftOpened);
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

  async function assignToHour(hour: HourCapacity): Promise<void> {
    if (!firstQueued) {
      notify(c.noDraft);
      return;
    }
    const at = pickSlotInHour(hour, settings, occupied, now);
    if (at === null) {
      notify(c.noCapacity);
      return;
    }
    await scheduleDraft(firstQueued, at);
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

  const pendingCount = assignments.filter((assignment) => assignment.at > now).length;

  return (
    <section className="view write-view" ref={rootRef}>
      <section className="block" aria-label={c.upcoming}>
        <div className="block-head">
          <h2>{c.upcoming}</h2>
          {cache.posts.length || pendingCount ? (
            <span className="count">
              {cache.posts.filter((post) => post.executeAt > now).length + pendingCount}
            </span>
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
        <div className="write-next-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={!firstQueued || next === null}
            onClick={() => void scheduleNext()}
          >
            <AppIcon name="calendar" size={14} />
            <span>{c.scheduleNext}</span>
          </button>
          <span className="row-meta">{c.remaining(summary.free)}</span>
        </div>
        {days.length === 0 ? (
          <div className="empty-state is-clean">
            <p>{c.empty}</p>
          </div>
        ) : (
          days.map((day) => (
            <div className="write-day" key={day.key}>
              <h3 className="write-day-title">{dayLabel(day.at, now, language)}</h3>
              {day.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`write-item${item.pending ? ' is-pending' : ' is-post'}`}
                  onClick={() => (item.pending ? undefined : void sync())}
                >
                  <span className="write-time">{clockOf(item.at)}</span>
                  <span className="write-text">{item.text || c.noText}</span>
                  {item.pending ? <span className="row-meta">{c.pending}</span> : null}
                  {item.media ? <span className="row-meta">{c.media(item.media)}</span> : null}
                </button>
              ))}
            </div>
          ))
        )}
      </section>

      <section className="block" aria-label={c.capacity}>
        <div className="block-head">
          <h2>{c.capacity}</h2>
          <span className="count">{c.capacityValue(summary.used, summary.capacity)}</span>
          <HelpIcon text={c.capacityHint} />
          <button type="button" className="text-button toolbar-end" onClick={onOpenCadence}>
            {c.adjust}
          </button>
        </div>
        {summary.days.length === 0 ? (
          <div className="empty-state is-clean">
            <p>{c.noSlot}</p>
          </div>
        ) : (
          summary.days.map((day) => (
            <div className="write-day" key={day.at}>
              <h3 className="write-day-title">
                <span>{dayLabel(day.at, now, language)}</span>
                <span className="row-meta">{c.capacityValue(day.used, day.capacity)}</span>
              </h3>
              <div className="write-hours">
                {day.hours.map((hour) => {
                  const full = hour.used >= hour.capacity;
                  return (
                    <button
                      key={hour.at}
                      type="button"
                      className={`write-hour${full ? ' is-full' : ''}`}
                      disabled={full}
                      title={`${slotLabel(hour.at, now, language)} · ${c.capacityValue(
                        hour.used,
                        hour.capacity,
                      )}`}
                      onClick={() => void assignToHour(hour)}
                    >
                      <span>{clockOf(hour.at)}</span>
                      <span className="row-meta">{c.capacityValue(hour.used, hour.capacity)}</span>
                    </button>
                  );
                })}
              </div>
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
