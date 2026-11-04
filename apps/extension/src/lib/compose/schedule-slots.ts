/**
 * 发帖节奏（纯函数）：用户只设「哪些天的哪些时段、每小时最多几条」，
 * 系统按小时生成名额，再把内容排进名额里。
 *
 * 时间一律按浏览器本地时区算，和 X 网页版「安排表」显示的时区一致。
 */
import type { UiLanguage } from '../platform/i18n';

export interface ScheduleWindow {
  /** 稳定 id，设置页增删时用 */
  id: string;
  /** 哪几天排（0 = 周日 … 6 = 周六），升序去重 */
  days: number[];
  /** 时段开始，`HH:MM` */
  start: string;
  /** 时段结束，`HH:MM`；24:00 表示当天结束 */
  end: string;
  /** 这个时段里每小时最多几条 */
  perHour: number;
}

export interface ScheduleSettings {
  /** 发帖框和「安排表」里的排期按钮 */
  composeHelper: boolean;
  /** 文章编辑器：粘贴 Markdown 自动转格式、大纲与字数面板 */
  articleHelper: boolean;
  /** 集中发帖的时段；空数组 = 不排 */
  windows: ScheduleWindow[];
  /** 相邻两条至少隔这么多分钟 */
  minGapMinutes: number;
  /** 最早排到现在之后这么多分钟（来不及写完的槽位跳过） */
  leadMinutes: number;
  /** 在小时内随机一个分钟；关掉就排该小时最早的空位 */
  randomize: boolean;
  /** 往后最多排几天 */
  horizonDays: number;
}

/** 一个小时里的名额状态 */
export interface HourCapacity {
  /** 本地整点，毫秒 */
  at: number;
  /** 这个小时最多几条 */
  capacity: number;
  /** 已被占用的条数（已排期 + 待确认） */
  used: number;
  /** 还剩几条 */
  free: number;
  /** 可用分钟区间，相对整点的偏移（[start, end)） */
  ranges: Array<{ start: number; end: number }>;
  /** 覆盖这个小时的时段 id */
  windows: string[];
}

export interface CapacityDay {
  /** 本地当天 00:00，毫秒 */
  at: number;
  hours: HourCapacity[];
  capacity: number;
  used: number;
  free: number;
}

export const PER_HOUR_OPTIONS = [1, 2, 3] as const;
export const GAP_OPTIONS = [0, 10, 15, 30, 60, 120] as const;
export const LEAD_OPTIONS = [0, 5, 10, 30, 60] as const;
export const HORIZON_OPTIONS = [7, 14, 30] as const;

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const MAX_PER_HOUR = 3;

function cloneWindows(windows: readonly ScheduleWindow[]): ScheduleWindow[] {
  return windows.map((window) => ({ ...window, days: [...window.days] }));
}

export const DEFAULT_SCHEDULE_SETTINGS: ScheduleSettings = {
  composeHelper: true,
  articleHelper: true,
  windows: [
    { id: 'w1', days: ALL_DAYS, start: '09:00', end: '10:00', perHour: 1 },
    { id: 'w2', days: ALL_DAYS, start: '12:00', end: '13:00', perHour: 1 },
    { id: 'w3', days: ALL_DAYS, start: '18:00', end: '19:00', perHour: 1 },
    { id: 'w4', days: ALL_DAYS, start: '21:00', end: '22:00', perHour: 1 },
  ],
  minGapMinutes: 15,
  leadMinutes: 10,
  randomize: true,
  horizonDays: 14,
};

/**
 * 一天里均匀分布的时段：首条贴着开始、末条贴着结束前一小时。
 * 排期页的「定个发帖节奏」用它把「一天几条 + 哪个时间段」变成能直接排的时段。
 * 时段只有 N 小时却要 N+1 条时，最多排 N 条（一小时只放一条）。
 */
export function evenWindows(perDay: number, startHour: number, endHour: number): ScheduleWindow[] {
  const start = Math.max(0, Math.min(23, Math.round(startHour)));
  const end = Math.max(start + 1, Math.min(24, Math.round(endHour)));
  const span = end - start;
  const count = Math.max(1, Math.min(Math.round(perDay) || 1, span));
  const hours: number[] = [];
  if (count === 1) {
    hours.push(start + Math.floor((span - 1) / 2));
  } else {
    for (let i = 0; i < count; i += 1) {
      hours.push(start + Math.round((i * (span - 1)) / (count - 1)));
    }
  }
  return [...new Set(hours)]
    .sort((a, b) => a - b)
    .map((hour, index) => ({
      id: `w${index + 1}`,
      days: [...ALL_DAYS],
      start: formatClock(hour * 60),
      end: formatClock((hour + 1) * 60),
      perHour: 1,
    }));
}

/** 还是出厂那几段（用户没动过发帖节奏）——只有这种时候才值得弹「定个节奏」。 */
export function isDefaultWindows(windows: readonly ScheduleWindow[]): boolean {
  const defaults = DEFAULT_SCHEDULE_SETTINGS.windows;
  if (windows.length !== defaults.length) return false;
  return windows.every((window, index) => {
    const preset = defaults[index];
    return (
      !!preset &&
      window.start === preset.start &&
      window.end === preset.end &&
      window.perHour === preset.perHour &&
      window.days.join(',') === preset.days.join(',')
    );
  });
}

/** `9:5` / `09:05` → 545；不合法返回 null。 */
export function parseClock(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

/** 同上，但额外接受 `24:00`（只用于时段结束）。 */
export function parseClockEnd(value: unknown): number | null {
  if (value === '24:00') return 24 * 60;
  return parseClock(value);
}

export function formatClock(minutes: number): string {
  if (minutes >= 24 * 60) return '24:00';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

function normalizeDays(value: unknown, fallback: number[] = ALL_DAYS): number[] {
  if (!Array.isArray(value)) return [...fallback];
  return [
    ...new Set(
      value.filter(
        (day): day is number => Number.isInteger(day) && Number(day) >= 0 && Number(day) <= 6,
      ),
    ),
  ].sort((a, b) => a - b);
}

function clampPerHour(value: unknown, fallback = 1): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_PER_HOUR, Math.max(1, Math.round(n)));
}

function pickNumber(value: unknown, options: readonly number[], fallback: number): number {
  const n = Number(value);
  return options.includes(n) ? n : fallback;
}

function normalizeWindow(
  raw: unknown,
  index: number,
  fallbackDays: number[],
  usedIds: Set<string>,
): ScheduleWindow | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const start = parseClock(value.start);
  const end = parseClockEnd(value.end);
  if (start === null || end === null || end <= start) return null;
  const rawId = typeof value.id === 'string' && value.id.trim() ? value.id.trim() : `w${index + 1}`;
  let id = rawId;
  for (let n = 2; usedIds.has(id); n++) id = `${rawId}-${n}`;
  usedIds.add(id);
  return {
    id,
    days: normalizeDays(value.days, fallbackDays),
    start: formatClock(start),
    end: formatClock(end),
    perHour: clampPerHour(value.perHour),
  };
}

/** 旧版「固定时间点」→ 每个整点一个小时段；同一小时里的多个点合并成每小时几条。 */
function windowsFromTimes(times: unknown, days: number[]): ScheduleWindow[] {
  if (!Array.isArray(times)) return [];
  const counts = new Map<number, number>();
  for (const time of times) {
    const minutes = parseClock(time);
    if (minutes === null) continue;
    const hour = Math.floor(minutes / 60);
    counts.set(hour, (counts.get(hour) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a], [b]) => a - b)
    .map(([hour, count], index) => ({
      id: `migrated-${index + 1}`,
      days: [...days],
      start: formatClock(hour * 60),
      end: formatClock(Math.min(hour * 60 + 60, 23 * 60 + 59)),
      perHour: clampPerHour(count),
    }));
}

function migratedWindows(value: Record<string, unknown>): ScheduleWindow[] | null {
  const days = normalizeDays(value.days);
  if (value.mode === 'interval' || typeof value.intervalStart === 'string') {
    const start = parseClock(value.intervalStart);
    const end = parseClockEnd(value.intervalEnd);
    if (start === null || end === null || end <= start) return null;
    const interval = Number(value.intervalMinutes);
    const perHour = Number.isFinite(interval) && interval > 0 ? Math.round(60 / interval) : 1;
    return [
      {
        id: 'migrated-interval',
        days,
        start: formatClock(start),
        end: formatClock(end),
        perHour: clampPerHour(perHour),
      },
    ];
  }
  if (Array.isArray(value.times)) return windowsFromTimes(value.times, days);
  return null;
}

export function normalizeScheduleSettings(raw: unknown): ScheduleSettings {
  const base = DEFAULT_SCHEDULE_SETTINGS;
  if (!raw || typeof raw !== 'object') {
    return {
      ...base,
      windows: cloneWindows(base.windows),
    };
  }
  const value = raw as Record<string, unknown>;
  const bool = (key: keyof ScheduleSettings): boolean =>
    typeof value[key] === 'boolean' ? (value[key] as boolean) : (base[key] as boolean);
  const fallbackDays = normalizeDays(value.days);
  const usedIds = new Set<string>();
  const windows = Array.isArray(value.windows)
    ? value.windows
        .map((window, index) => normalizeWindow(window, index, fallbackDays, usedIds))
        .filter((window): window is ScheduleWindow => window !== null)
    : (migratedWindows(value) ?? cloneWindows(base.windows)).map((window, index) => {
        const normalized = normalizeWindow(window, index, fallbackDays, usedIds);
        return normalized ?? { ...window, days: [...window.days] };
      });
  return {
    composeHelper: bool('composeHelper'),
    articleHelper: bool('articleHelper'),
    windows,
    minGapMinutes: pickNumber(value.minGapMinutes, GAP_OPTIONS, base.minGapMinutes),
    leadMinutes: pickNumber(value.leadMinutes, LEAD_OPTIONS, base.leadMinutes),
    randomize: bool('randomize'),
    horizonDays: pickNumber(value.horizonDays, HORIZON_OPTIONS, base.horizonDays),
  };
}

function startOfLocalDay(ms: number): Date {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function localDayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function windowMinutes(window: ScheduleWindow): { start: number; end: number } | null {
  const start = parseClock(window.start);
  const end = parseClockEnd(window.end);
  if (start === null || end === null || end <= start) return null;
  return { start, end };
}

function mergeRanges(ranges: Array<{ start: number; end: number }>): Array<{
  start: number;
  end: number;
}> {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const out: Array<{ start: number; end: number }> = [];
  for (const range of sorted) {
    const last = out[out.length - 1];
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else out.push({ ...range });
  }
  return out;
}

function usedInHour(plan: HourCapacity, occupied: readonly number[]): number {
  const used = new Set<number>();
  for (const at of occupied) {
    if (at < plan.at || at >= plan.at + 60 * MINUTE_MS) continue;
    const minute = Math.floor((at - plan.at) / MINUTE_MS);
    if (plan.ranges.some((range) => minute >= range.start && minute < range.end)) used.add(at);
  }
  return used.size;
}

/**
 * [from, until) 之间每个有安排的小时，以及已经占用的名额。
 * 已排期在时段外的时间不算占用；同一小时有重叠时段时，容量取最大的 perHour。
 */
export function capacityBetween(
  settings: ScheduleSettings,
  occupied: readonly number[],
  from: number,
  until: number,
): HourCapacity[] {
  if (until <= from) return [];
  const out: HourCapacity[] = [];
  const day = startOfLocalDay(from);
  for (
    let guard = 0;
    day.getTime() < until && guard < 400;
    guard++, day.setDate(day.getDate() + 1)
  ) {
    const weekday = day.getDay();
    const windows = settings.windows
      .filter((window) => window.days.includes(weekday))
      .map((window) => ({ window, range: windowMinutes(window) }))
      .filter(
        (entry): entry is { window: ScheduleWindow; range: { start: number; end: number } } =>
          entry.range !== null,
      );
    if (windows.length === 0) continue;
    for (let hour = 0; hour < 24; hour++) {
      const hourAt = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour).getTime();
      if (hourAt + 60 * MINUTE_MS <= from || hourAt >= until) continue;
      const ranges: Array<{ start: number; end: number }> = [];
      const windowIds: string[] = [];
      let capacity = 0;
      for (const { window, range } of windows) {
        const start = Math.max(range.start, hour * 60);
        const end = Math.min(range.end, (hour + 1) * 60);
        if (end <= start) continue;
        ranges.push({ start: start - hour * 60, end: end - hour * 60 });
        windowIds.push(window.id);
        capacity = Math.max(capacity, window.perHour);
      }
      if (capacity === 0) continue;
      const plan: HourCapacity = {
        at: hourAt,
        capacity,
        used: 0,
        free: capacity,
        ranges: mergeRanges(ranges),
        windows: [...new Set(windowIds)],
      };
      plan.used = usedInHour(plan, occupied);
      plan.free = Math.max(0, plan.capacity - plan.used);
      out.push(plan);
    }
  }
  return out;
}

export function isOccupied(at: number, occupied: readonly number[], gapMinutes: number): boolean {
  // 间隔为 0 时只认同一分钟
  const gap = Math.max(gapMinutes, 1) * MINUTE_MS;
  return occupied.some((t) => Math.abs(t - at) < gap);
}

/** 在一个小时里挑一个空分钟；随机开时在可用分钟里抽，关掉时取最早。 */
export function pickSlotInHour(
  plan: HourCapacity,
  settings: ScheduleSettings,
  occupied: readonly number[],
  now: number,
  random: () => number = Math.random,
): number | null {
  const earliest = now + settings.leadMinutes * MINUTE_MS;
  const candidates: number[] = [];
  for (const range of plan.ranges) {
    for (let minute = range.start; minute < range.end; minute++) {
      const at = plan.at + minute * MINUTE_MS;
      if (at < earliest) continue;
      if (isOccupied(at, occupied, settings.minGapMinutes)) continue;
      candidates.push(at);
    }
  }
  if (candidates.length === 0) return null;
  if (!settings.randomize) return candidates[0] ?? null;
  const index = Math.min(candidates.length - 1, Math.floor(random() * candidates.length));
  return candidates[index] ?? null;
}

/**
 * 从现在往后的 count 个空位。
 * - 最早是 now + leadMinutes
 * - 已排期的帖子前后 minGapMinutes 内的空位跳过；返回的几个空位之间也互相避开
 * - 只在用户在设置里选的时段里找，最多看 horizonDays 天
 */
export function nextFreeSlots(
  settings: ScheduleSettings,
  occupied: readonly number[],
  now: number,
  count = 1,
  random: () => number = Math.random,
): number[] {
  if (count <= 0 || settings.windows.length === 0) return [];
  const from = now + settings.leadMinutes * MINUTE_MS;
  const until = from + settings.horizonDays * DAY_MS;
  const plans = capacityBetween(settings, occupied, from, until);
  const out: number[] = [];
  for (const plan of plans) {
    // 一个小时可能允许 2–3 条，要把这个小时里的名额用完再往后走
    while (out.length < count) {
      const taken = [...occupied, ...out];
      if (usedInHour(plan, taken) >= plan.capacity) break;
      const at = pickSlotInHour(plan, settings, taken, now, random);
      if (at === null) break;
      out.push(at);
    }
    if (out.length >= count) break;
  }
  return out;
}

/** 按天汇总容量，给「本周」视图用。 */
export function capacityDays(
  settings: ScheduleSettings,
  occupied: readonly number[],
  from: number,
  until: number,
): CapacityDay[] {
  const days = new Map<string, CapacityDay>();
  for (const plan of capacityBetween(settings, occupied, from, until)) {
    const key = localDayKey(plan.at);
    let day = days.get(key);
    if (!day) {
      day = { at: startOfLocalDay(plan.at).getTime(), hours: [], capacity: 0, used: 0, free: 0 };
      days.set(key, day);
    }
    day.hours.push(plan);
    day.capacity += plan.capacity;
    day.used += plan.used;
    day.free += plan.free;
  }
  return [...days.values()].sort((a, b) => a.at - b.at);
}

/** 今天起 days 天的容量汇总。 */
export function capacitySummary(
  settings: ScheduleSettings,
  occupied: readonly number[],
  now: number,
  days = 7,
): { capacity: number; used: number; free: number; days: CapacityDay[] } {
  const until = new Date(startOfLocalDay(now).getTime() + days * DAY_MS).getTime();
  const list = capacityDays(settings, occupied, now, until);
  return {
    capacity: list.reduce((sum, day) => sum + day.capacity, 0),
    used: list.reduce((sum, day) => sum + day.used, 0),
    free: list.reduce((sum, day) => sum + day.free, 0),
    days: list,
  };
}

/**
 * 按自己主页的「发帖时段表现」推荐时间点：热力图 7 天 × 6 段（每段 4 小时），
 * 取各段跨天的中位倍数平均值最高的几段，时间点放在段开始后 1 小时。
 */
export function recommendTimes(
  cells: ReadonlyArray<ReadonlyArray<number | null>>,
  slotHours: number,
  count = 3,
): string[] {
  const slots = cells[0]?.length ?? 0;
  const scored: Array<{ slot: number; score: number }> = [];
  for (let slot = 0; slot < slots; slot++) {
    const values = cells.map((row) => row[slot]).filter((v): v is number => typeof v === 'number');
    if (values.length === 0) continue;
    scored.push({ slot, score: values.reduce((a, b) => a + b, 0) / values.length });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.slot - b.slot)
    .slice(0, count)
    .map(({ slot }) => formatClock((slot * slotHours + 1) * 60))
    .sort();
}

const WEEKDAYS: Record<UiLanguage, string[]> = {
  zh: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
};

export function weekdayLabel(day: number, language: UiLanguage): string {
  return WEEKDAYS[language][day] ?? '';
}

/** 「今天」「明天」「11月3日 周二」。 */
export function dayLabel(at: number, now: number, language: UiLanguage): string {
  const diff = Math.round(
    (startOfLocalDay(at).getTime() - startOfLocalDay(now).getTime()) / DAY_MS,
  );
  if (diff === 0) return language === 'zh' ? '今天' : 'Today';
  if (diff === 1) return language === 'zh' ? '明天' : 'Tomorrow';
  if (diff === 2 && language === 'zh') return '后天';
  const d = new Date(at);
  const week = weekdayLabel(d.getDay(), language);
  const year = d.getFullYear() === new Date(now).getFullYear() ? '' : `${d.getFullYear()}年`;
  return language === 'zh'
    ? `${year}${d.getMonth() + 1}月${d.getDate()}日 ${week}`
    : `${week}, ${d.toLocaleDateString('en-US', {
        year: year ? 'numeric' : undefined,
        month: 'short',
        day: 'numeric',
      })}`;
}

function clockLabel(at: number): string {
  const d = new Date(at);
  return formatClock(d.getHours() * 60 + d.getMinutes());
}

/** 「今天 09:00」「明天 09:00」「11月3日 周二 09:00」。 */
export function slotLabel(at: number, now: number, language: UiLanguage): string {
  return `${dayLabel(at, now, language)} ${clockLabel(at)}`;
}
