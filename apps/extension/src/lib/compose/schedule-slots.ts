/**
 * 排期槽位（纯函数）：用户设好每天几个发帖时间点、或「几点到几点每隔多久一条」，
 * 「下一个空档」= 从现在往后第一个没被已排期帖子占住的槽位。
 *
 * 时间一律按浏览器本地时区算，和 X 网页版「安排表」显示的时区一致。
 */
import type { UiLanguage } from '../platform/i18n';

export type SlotMode = 'times' | 'interval';

export interface ScheduleSettings {
  /** 发帖框和「安排表」里的排期按钮 */
  composeHelper: boolean;
  /** 文章编辑器：粘贴 Markdown 自动转格式、大纲与字数面板 */
  articleHelper: boolean;
  mode: SlotMode;
  /** 固定时间点，`HH:MM`，升序去重 */
  times: string[];
  /** 哪几天排（0 = 周日 … 6 = 周六），升序去重 */
  days: number[];
  intervalStart: string;
  intervalEnd: string;
  intervalMinutes: number;
  /** 槽位前后这么多分钟内已有排期的帖子，就算被占 */
  minGapMinutes: number;
  /** 最早排到现在之后这么多分钟（来不及写完的槽位跳过） */
  leadMinutes: number;
}

export const INTERVAL_OPTIONS = [30, 60, 90, 120, 180, 240, 360] as const;
export const GAP_OPTIONS = [0, 15, 30, 60, 120] as const;
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

export const DEFAULT_SCHEDULE_SETTINGS: ScheduleSettings = {
  composeHelper: true,
  articleHelper: true,
  mode: 'times',
  times: ['09:00', '12:30', '18:00', '21:30'],
  days: ALL_DAYS,
  intervalStart: '08:00',
  intervalEnd: '23:00',
  intervalMinutes: 180,
  minGapMinutes: 30,
  leadMinutes: 10,
};

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
/** 往后最多找这么多天（X 允许排一年多，找不到空档说明时间表本身是空的） */
const HORIZON_DAYS = 400;

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

export function formatClock(minutes: number): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

function normalizeTimes(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const minutes = [...new Set(value.map(parseClock).filter((m): m is number => m !== null))].sort(
    (a, b) => a - b,
  );
  return minutes.map(formatClock);
}

export function normalizeScheduleSettings(raw: unknown): ScheduleSettings {
  const base = DEFAULT_SCHEDULE_SETTINGS;
  if (!raw || typeof raw !== 'object')
    return { ...base, times: [...base.times], days: [...base.days] };
  const value = raw as Record<string, unknown>;
  const bool = (key: keyof ScheduleSettings): boolean =>
    typeof value[key] === 'boolean' ? (value[key] as boolean) : (base[key] as boolean);
  const clock = (key: 'intervalStart' | 'intervalEnd'): string => {
    const minutes = parseClock(value[key]);
    return minutes === null ? base[key] : formatClock(minutes);
  };
  const pick = <T extends number>(key: keyof ScheduleSettings, options: readonly T[]): T =>
    options.includes(value[key] as T) ? (value[key] as T) : (base[key] as T);
  const days = Array.isArray(value.days)
    ? [
        ...new Set(value.days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6)),
      ].sort((a, b) => a - b)
    : [...base.days];
  const leadRaw = Number(value.leadMinutes);
  return {
    composeHelper: bool('composeHelper'),
    articleHelper: bool('articleHelper'),
    mode: value.mode === 'interval' ? 'interval' : 'times',
    times: normalizeTimes(value.times) ?? [...base.times],
    days,
    intervalStart: clock('intervalStart'),
    intervalEnd: clock('intervalEnd'),
    intervalMinutes: pick('intervalMinutes', INTERVAL_OPTIONS),
    minGapMinutes: pick('minGapMinutes', GAP_OPTIONS),
    leadMinutes:
      Number.isInteger(leadRaw) && leadRaw >= 0 && leadRaw <= 180 ? leadRaw : base.leadMinutes,
  };
}

/** 一天里的槽位（分钟数，升序）。 */
export function dailySlotMinutes(settings: ScheduleSettings): number[] {
  if (settings.mode === 'times') {
    return settings.times.map(parseClock).filter((m): m is number => m !== null);
  }
  const start = parseClock(settings.intervalStart);
  const end = parseClock(settings.intervalEnd);
  if (start === null || end === null || end < start || settings.intervalMinutes <= 0) return [];
  const out: number[] = [];
  for (let m = start; m <= end; m += settings.intervalMinutes) out.push(m);
  return out;
}

function startOfLocalDay(ms: number): Date {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** [from, until) 之间的所有槽位（本地时间，毫秒，升序）。 */
export function slotsBetween(settings: ScheduleSettings, from: number, until: number): number[] {
  const minutes = dailySlotMinutes(settings);
  if (minutes.length === 0 || settings.days.length === 0 || until <= from) return [];
  const out: number[] = [];
  const day = startOfLocalDay(from);
  // 按日期递增（不按 24 小时加），夏令时切换那天也落在正确的钟点上
  for (let i = 0; day.getTime() < until && i <= HORIZON_DAYS; i++) {
    if (settings.days.includes(day.getDay())) {
      for (const m of minutes) {
        const at = new Date(
          day.getFullYear(),
          day.getMonth(),
          day.getDate(),
          Math.floor(m / 60),
          m % 60,
        ).getTime();
        if (at >= from && at < until) out.push(at);
      }
    }
    day.setDate(day.getDate() + 1);
  }
  return out;
}

export function isOccupied(at: number, occupied: readonly number[], gapMinutes: number): boolean {
  // 间隔为 0 时只认同一分钟
  const gap = Math.max(gapMinutes, 1) * MINUTE_MS;
  return occupied.some((t) => Math.abs(t - at) < gap);
}

/**
 * 从现在往后的 count 个空档。
 * - 最早是 now + leadMinutes
 * - 已排期的帖子前后 minGapMinutes 内的槽位算被占；返回的几个空档之间也互相避开
 */
export function nextFreeSlots(
  settings: ScheduleSettings,
  occupied: readonly number[],
  now: number,
  count = 1,
): number[] {
  const from = now + settings.leadMinutes * MINUTE_MS;
  const out: number[] = [];
  // 一次看 31 天，不够再往后，避免一次生成一年的槽位
  for (let start = from; out.length < count && start < from + HORIZON_DAYS * DAY_MS;) {
    const end = start + 31 * DAY_MS;
    for (const at of slotsBetween(settings, start, end)) {
      if (!isOccupied(at, [...occupied, ...out], settings.minGapMinutes)) out.push(at);
      if (out.length >= count) break;
    }
    start = end;
  }
  return out;
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
  return language === 'zh'
    ? `${d.getMonth() + 1}月${d.getDate()}日 ${week}`
    : `${week}, ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

/** 「明天 09:00」 */
export function slotLabel(at: number, now: number, language: UiLanguage): string {
  const d = new Date(at);
  return `${dayLabel(at, now, language)} ${formatClock(d.getHours() * 60 + d.getMinutes())}`;
}

export function localDayKey(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
