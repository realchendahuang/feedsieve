import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCHEDULE_SETTINGS,
  capacityBetween,
  capacityDays,
  capacitySummary,
  dayLabel,
  formatClock,
  nextFreeSlots,
  normalizeScheduleSettings,
  parseClock,
  pickSlotInHour,
  recommendTimes,
  slotLabel,
  type ScheduleSettings,
  type ScheduleWindow,
} from './schedule-slots';

const at = (y: number, mo: number, d: number, h = 0, mi = 0) =>
  new Date(y, mo - 1, d, h, mi).getTime();

const window = (patch: Partial<ScheduleWindow> = {}): ScheduleWindow => ({
  id: 'w1',
  days: [1],
  start: '09:00',
  end: '10:00',
  perHour: 1,
  ...patch,
});

const settings = (patch: Partial<ScheduleSettings> = {}): ScheduleSettings =>
  normalizeScheduleSettings({ ...DEFAULT_SCHEDULE_SETTINGS, ...patch });

describe('parseClock / normalize', () => {
  it('认 9:05 和 09:05，拒绝越界；结束时间可以写 24:00', () => {
    expect(parseClock('9:05')).toBe(545);
    expect(parseClock('23:59')).toBe(1439);
    expect(parseClock('24:00')).toBeNull();
    expect(parseClock('9点')).toBeNull();
    expect(formatClock(1440)).toBe('24:00');
  });

  it('新设置：时段去重、排序、非法值回落默认', () => {
    const s = normalizeScheduleSettings({
      windows: [
        { id: 'a', days: [6, 1, 1, 9], start: '21:00', end: '22:00', perHour: 2 },
        { id: 'a', days: [1], start: '09:00', end: '10:00', perHour: 9 },
        { id: 'bad', days: [1], start: '10:00', end: '09:00', perHour: 1 },
      ],
      minGapMinutes: 60,
      leadMinutes: 30,
      randomize: false,
      horizonDays: 7,
    });
    expect(s.windows).toHaveLength(2);
    expect(s.windows.map((w) => w.id)).toEqual(['a', 'a-2']);
    expect(s.windows[0]!.days).toEqual([1, 6]);
    expect(s.windows[1]!.perHour).toBe(3);
    expect(s.minGapMinutes).toBe(60);
    expect(s.leadMinutes).toBe(30);
    expect(s.randomize).toBe(false);
    expect(s.horizonDays).toBe(7);
  });

  it('旧版固定时间点迁成整点小时段，同一小时合并成几条', () => {
    const s = normalizeScheduleSettings({
      mode: 'times',
      times: ['21:00', '09:30', '09:00', 'x'],
      days: [1, 3],
      composeHelper: false,
    });
    expect(s.windows).toEqual([
      { id: 'migrated-1', days: [1, 3], start: '09:00', end: '10:00', perHour: 2 },
      { id: 'migrated-2', days: [1, 3], start: '21:00', end: '22:00', perHour: 1 },
    ]);
    expect(s.composeHelper).toBe(false);
  });

  it('旧版按间隔迁成一个时段，间隔换算成每小时条数', () => {
    const s = normalizeScheduleSettings({
      mode: 'interval',
      intervalStart: '08:00',
      intervalEnd: '14:00',
      intervalMinutes: 30,
      days: [2],
    });
    expect(s.windows).toEqual([
      { id: 'migrated-interval', days: [2], start: '08:00', end: '14:00', perHour: 2 },
    ]);
  });

  it('显式清空时段保持为空，不回落默认', () => {
    expect(settings({ windows: [] }).windows).toEqual([]);
    expect(normalizeScheduleSettings(null).windows).toEqual(DEFAULT_SCHEDULE_SETTINGS.windows);
  });
});

describe('容量', () => {
  it('按小时生成名额，时段重叠时容量取最大', () => {
    const s = settings({
      windows: [
        window({ id: 'a', days: [1], start: '08:00', end: '10:00', perHour: 2 }),
        window({ id: 'b', days: [1], start: '08:30', end: '09:30', perHour: 1 }),
        window({ id: 'c', days: [1], start: '20:00', end: '21:00', perHour: 1 }),
      ],
    });
    // 2026-11-02 是周一
    const plans = capacityBetween(s, [], at(2026, 11, 2), at(2026, 11, 3));
    expect(plans.map((plan) => [new Date(plan.at).getHours(), plan.capacity])).toEqual([
      [8, 2],
      [9, 2],
      [20, 1],
    ]);
  });

  it('已排期占用名额，时段外的时间不算', () => {
    const s = settings({
      windows: [window({ days: [1], start: '09:00', end: '10:00', perHour: 2 })],
    });
    const occupied = [at(2026, 11, 2, 9, 10), at(2026, 11, 2, 9, 50), at(2026, 11, 2, 8, 30)];
    const [plan] = capacityBetween(s, occupied, at(2026, 11, 2), at(2026, 11, 3));
    expect(plan).toMatchObject({ capacity: 2, used: 2, free: 0 });
  });

  it('本周按天汇总', () => {
    const s = settings({
      windows: [window({ days: [1, 3], start: '09:00', end: '10:00', perHour: 1 })],
    });
    const from = at(2026, 11, 2);
    const days = capacityDays(s, [], from, at(2026, 11, 9));
    expect(days.map((day) => new Date(day.at).getDay())).toEqual([1, 3]);
    expect(days.map((day) => day.capacity)).toEqual([1, 1]);
    const summary = capacitySummary(s, [], from, 7);
    expect(summary).toMatchObject({ capacity: 2, used: 0, free: 2 });
  });
});

describe('排下一条', () => {
  it('跳过提前量内的时间，按最早可用分钟排', () => {
    const s = settings({
      windows: [window({ days: [1], start: '09:00', end: '10:00', perHour: 2 })],
      leadMinutes: 10,
      minGapMinutes: 15,
      randomize: false,
    });
    expect(nextFreeSlots(s, [], at(2026, 11, 2, 8, 55), 1)).toEqual([at(2026, 11, 2, 9, 5)]);
    expect(nextFreeSlots(s, [], at(2026, 11, 2, 8, 55), 2)).toEqual([
      at(2026, 11, 2, 9, 5),
      at(2026, 11, 2, 9, 20),
    ]);
  });

  it('离已排期太近的分钟跳过；本小时满了就去下一天', () => {
    const s = settings({
      windows: [window({ days: [1], start: '09:00', end: '10:00', perHour: 2 })],
      leadMinutes: 0,
      minGapMinutes: 15,
      randomize: false,
    });
    expect(nextFreeSlots(s, [at(2026, 11, 2, 9, 30)], at(2026, 11, 2, 8), 1)).toEqual([
      at(2026, 11, 2, 9, 0),
    ]);
    expect(
      nextFreeSlots(s, [at(2026, 11, 2, 9, 30), at(2026, 11, 2, 9, 40)], at(2026, 11, 2, 8), 1),
    ).toEqual([at(2026, 11, 9, 9, 0)]);
  });

  it('随机分钟在可用分钟里抽，注入随机数可复现', () => {
    const s = settings({
      windows: [window({ days: [1], start: '09:00', end: '10:00', perHour: 1 })],
      leadMinutes: 0,
      randomize: true,
    });
    const now = at(2026, 11, 2, 8);
    const plan = capacityBetween(s, [], now, at(2026, 11, 3))[0]!;
    expect(pickSlotInHour(plan, s, [], now, () => 0)).toBe(at(2026, 11, 2, 9, 0));
    expect(pickSlotInHour(plan, s, [], now, () => 0.999)).toBe(at(2026, 11, 2, 9, 59));
    expect(nextFreeSlots(s, [], now, 1, () => 0)[0]).toBe(at(2026, 11, 2, 9, 0));
  });

  it('没有时段时找不到空位；星期不对就往后找到对的星期', () => {
    expect(nextFreeSlots(settings({ windows: [] }), [], at(2026, 11, 2))).toEqual([]);
    expect(
      nextFreeSlots(
        settings({ windows: [window({ days: [2] })], randomize: false }),
        [],
        at(2026, 11, 2),
      ),
    ).toEqual([at(2026, 11, 3, 9, 0)]);
  });

  it('最多只往后看 horizonDays 天', () => {
    const s = settings({
      windows: [window({ days: [1], start: '09:00', end: '10:00', perHour: 1 })],
      horizonDays: 7,
    });
    // 周一排满，下一个周一在 7 天后，正好超出窗口
    const taken = [at(2026, 11, 2, 9, 30)];
    expect(nextFreeSlots(s, taken, at(2026, 11, 2, 4), 1)).toEqual([]);
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
    expect(dayLabel(at(2027, 11, 1), now, 'zh')).toBe('2027年11月1日 周一');
  });
});
