import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCHEDULE_SETTINGS,
  dailySlotMinutes,
  dayLabel,
  nextFreeSlots,
  normalizeScheduleSettings,
  parseClock,
  recommendTimes,
  slotLabel,
  slotsBetween,
  type ScheduleSettings,
} from './schedule-slots';

const at = (y: number, mo: number, d: number, h = 0, mi = 0) =>
  new Date(y, mo - 1, d, h, mi).getTime();
const settings = (patch: Partial<ScheduleSettings> = {}): ScheduleSettings =>
  normalizeScheduleSettings({ ...DEFAULT_SCHEDULE_SETTINGS, ...patch });

describe('parseClock / normalize', () => {
  it('认 9:05 和 09:05，拒绝越界', () => {
    expect(parseClock('9:05')).toBe(545);
    expect(parseClock('23:59')).toBe(1439);
    expect(parseClock('24:00')).toBeNull();
    expect(parseClock('9点')).toBeNull();
  });

  it('时间点去重排序，非法值回落默认', () => {
    const s = normalizeScheduleSettings({
      times: ['21:30', '9:00', '09:00', 'x'],
      days: [6, 1, 1, 9],
      intervalMinutes: 7,
      minGapMinutes: 60,
      mode: 'weird',
    });
    expect(s.times).toEqual(['09:00', '21:30']);
    expect(s.days).toEqual([1, 6]);
    expect(s.intervalMinutes).toBe(DEFAULT_SCHEDULE_SETTINGS.intervalMinutes);
    expect(s.minGapMinutes).toBe(60);
    expect(s.mode).toBe('times');
    expect(normalizeScheduleSettings(null)).toEqual(DEFAULT_SCHEDULE_SETTINGS);
  });
});

describe('槽位', () => {
  it('按间隔：起止都含', () => {
    expect(
      dailySlotMinutes(
        settings({
          mode: 'interval',
          intervalStart: '08:00',
          intervalEnd: '14:00',
          intervalMinutes: 180,
        }),
      ),
    ).toEqual([480, 660, 840]);
  });

  it('只在选中的星期几出槽位', () => {
    // 2026-11-02 是周一
    const s = settings({ times: ['09:00'], days: [1] });
    const slots = slotsBetween(s, at(2026, 11, 1), at(2026, 11, 15));
    expect(slots).toEqual([at(2026, 11, 2, 9), at(2026, 11, 9, 9)]);
  });

  it('下一个空档：跳过提前量内的、跳过已被占的', () => {
    const s = settings({ times: ['09:00', '12:30', '21:30'], minGapMinutes: 30, leadMinutes: 10 });
    const now = at(2026, 11, 1, 8, 55);
    // 9:00 在 10 分钟提前量内跳过；12:40 有一条，12:30 被占
    expect(nextFreeSlots(s, [at(2026, 11, 1, 12, 40)], now, 2)).toEqual([
      at(2026, 11, 1, 21, 30),
      at(2026, 11, 2, 9, 0),
    ]);
  });

  it('间隔为 0 时只有同一分钟才算占', () => {
    const s = settings({ times: ['09:00'], minGapMinutes: 0, leadMinutes: 0 });
    const now = at(2026, 11, 1, 8);
    expect(nextFreeSlots(s, [at(2026, 11, 1, 9, 1)], now)).toEqual([at(2026, 11, 1, 9)]);
    expect(nextFreeSlots(s, [at(2026, 11, 1, 9)], now)).toEqual([at(2026, 11, 2, 9)]);
  });

  it('时间表为空时找不到空档', () => {
    expect(nextFreeSlots(settings({ times: [] }), [], at(2026, 11, 1))).toEqual([]);
    expect(nextFreeSlots(settings({ days: [] }), [], at(2026, 11, 1))).toEqual([]);
  });

  it('一个月排满了也会往后找', () => {
    const s = settings({ times: ['09:00'], minGapMinutes: 0, leadMinutes: 0 });
    const now = at(2026, 11, 1, 8);
    const taken = Array.from({ length: 40 }, (_, d) => at(2026, 11, 1 + d, 9));
    expect(nextFreeSlots(s, taken, now)).toEqual([at(2026, 11, 41, 9)]);
  });
});

describe('推荐与显示', () => {
  it('取跨天平均倍数最高的段，时间放在段开始后 1 小时', () => {
    const cells = Array.from({ length: 7 }, () => [null, 0.5, 2, 1, 0.8, 3]);
    expect(recommendTimes(cells, 4, 3)).toEqual(['09:00', '13:00', '21:00']);
  });

  it('今天 / 明天 / 日期', () => {
    const now = at(2026, 11, 1, 10);
    expect(dayLabel(at(2026, 11, 1, 23), now, 'zh')).toBe('今天');
    expect(slotLabel(at(2026, 11, 2, 9), now, 'zh')).toBe('明天 09:00');
    expect(dayLabel(at(2026, 11, 3), now, 'zh')).toBe('后天');
    expect(dayLabel(at(2026, 11, 4), now, 'zh')).toBe('11月4日 周三');
  });
});
