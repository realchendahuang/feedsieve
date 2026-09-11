// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearDetectionLog,
  readDetectionLog,
  readRuleStats,
  recordDetection,
  resetDeduplicationForTests,
  todayKey,
} from './detection-log';

let storage: Record<string, unknown>;

beforeEach(() => {
  storage = {};
  resetDeduplicationForTests();
  vi.stubGlobal('browser', {
    storage: {
      local: {
        get: vi.fn(async (key: string | string[]) => {
          const keys = Array.isArray(key) ? key : [key];
          return Object.fromEntries(keys.map((k) => [k, storage[k]]));
        }),
        set: vi.fn(async (patch: Record<string, unknown>) => Object.assign(storage, patch)),
        remove: vi.fn(async (key: string | string[]) => {
          for (const k of Array.isArray(key) ? key : [key]) delete storage[k];
        }),
      },
    },
  });
});

describe('本地检测日志', () => {
  it('记录命中并按本地日聚合 ruleId 计数', async () => {
    const now = new Date('2026-09-10T12:00:00');
    await recordDetection(
      { handle: 'spam1', ruleId: 'weak-signal-combo', source: 'heuristic', reason: 'r' },
      now.getTime(),
    );
    await recordDetection(
      { handle: 'spam2', ruleId: 'weak-signal-combo', source: 'heuristic', reason: 'r' },
      now.getTime() + 1000,
    );
    await recordDetection(
      { handle: 'spam3', ruleId: 'keyword:official:adult-x', source: 'heuristic' },
      now.getTime() + 2000,
    );

    expect(await readRuleStats()).toEqual({
      [todayKey(now)]: { 'weak-signal-combo': 2, 'keyword:official:adult-x': 1 },
    });
    const log = await readDetectionLog();
    expect(log).toHaveLength(3);
    expect(log[0]?.ruleId).toBe('keyword:official:adult-x');
  });

  it('同一 handle+rule 5 分钟内去重（虚拟滚动重建 DOM 不重复计数）', async () => {
    const now = Date.now();
    await recordDetection({ handle: 'spam1', ruleId: 'weak-signal-combo', source: 'heuristic' }, now);
    await recordDetection(
      { handle: 'spam1', ruleId: 'weak-signal-combo', source: 'heuristic' },
      now + 60_000,
    );
    expect(await readDetectionLog()).toHaveLength(1);
    // TTL 过后重新计数
    await recordDetection(
      { handle: 'spam1', ruleId: 'weak-signal-combo', source: 'heuristic' },
      now + 6 * 60_000,
    );
    expect(await readDetectionLog()).toHaveLength(2);
  });

  it('环形日志封顶 200 条，统计保留 30 天', async () => {
    const base = Date.parse('2026-09-10T00:00:00');
    for (let i = 0; i < 205; i++) {
      await recordDetection({ handle: `h${i}`, ruleId: 'r', source: 'heuristic' }, base + i);
    }
    const log = await readDetectionLog();
    expect(log).toHaveLength(200);
    expect(log[0]?.handle).toBe('h204');
    expect(log.at(-1)?.handle).toBe('h5');

    const stats = await readRuleStats();
    const days = Object.keys(stats).sort();
    // 205 条毫秒级时间戳落在同一天 —— 30 天裁剪把 40 天前的旧数据清掉
    storage.detectionRuleStatsV1 = {
      '2026-07-01': { stale: 9 },
      ...stats,
    };
    await recordDetection({ handle: 'zz', ruleId: 'r', source: 'heuristic' }, base + 400);
    const pruned = await readRuleStats();
    expect(pruned['2026-07-01']).toBeUndefined();
    expect(Object.keys(pruned).length).toBeGreaterThanOrEqual(days.length);
  });

  it('清空日志', async () => {
    await recordDetection({ handle: 'spam1', ruleId: 'r', source: 'heuristic' });
    await clearDetectionLog();
    expect(await readDetectionLog()).toHaveLength(0);
    expect(await readRuleStats()).toEqual({});
  });
});
