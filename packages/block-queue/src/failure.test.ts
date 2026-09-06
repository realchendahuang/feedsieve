import { describe, expect, it, vi } from 'vitest';
import {
  classifyFailure,
  maxAttemptsForClass,
  nextBackoffMs,
  PACE_FLOOR_MS,
  type FailureClass,
} from './failure';

describe('classifyFailure（失败分类）', () => {
  it.each<[string, number | undefined, FailureClass]>([
    ['network_error', undefined, 'transient'],
    ['rate_limited', 429, 'transient'],
    ['http_error', 500, 'transient'],
    ['http_error', 503, 'transient'],
    ['auth_required', 403, 'pause'],
    ['missing_csrf', undefined, 'pause'],
    ['kill_switch', undefined, 'pause'],
    ['http_error', 404, 'unsupported'],
    ['http_error', 405, 'unsupported'],
    ['http_error', 410, 'unsupported'],
    ['http_error', 400, 'permanent'],
    ['no-id', undefined, 'permanent'],
    ['unknown_code', undefined, 'permanent'],
  ])('%s / %s -> %s', (code, httpStatus, expected) => {
    expect(classifyFailure({ code, httpStatus })).toBe(expected);
  });

  it('transient 有重试配额，其余类型不重试', () => {
    expect(maxAttemptsForClass('transient')).toBe(3);
    expect(maxAttemptsForClass('pause')).toBe(1);
    expect(maxAttemptsForClass('permanent')).toBe(1);
    expect(maxAttemptsForClass('unsupported')).toBe(1);
  });
});

describe('nextBackoffMs（自适应节奏）', () => {
  it('指数退避并以 400ms 为起点，封顶 15s', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      expect(nextBackoffMs(1)).toBe(PACE_FLOOR_MS);
      expect(nextBackoffMs(2)).toBe(800);
      expect(nextBackoffMs(3)).toBe(1600);
      expect(nextBackoffMs(4)).toBe(3200);
      expect(nextBackoffMs(5)).toBe(6400);
      expect(nextBackoffMs(6)).toBe(12800);
      // 封顶：15s 不再是指数继续涨
      expect(nextBackoffMs(8)).toBe(15000);
      expect(nextBackoffMs(20)).toBe(15000);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('尊重 Retry-After 且不低于下限', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      expect(nextBackoffMs(1, 5_000)).toBe(5_000);
      expect(nextBackoffMs(5, 100)).toBe(PACE_FLOOR_MS);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('抖动区间在 [0, 20%] 内', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(nextBackoffMs(1)).toBe(400);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    expect(nextBackoffMs(1)).toBe(440);
    vi.spyOn(Math, 'random').mockReturnValue(1);
    expect(nextBackoffMs(1)).toBe(480);
    vi.restoreAllMocks();
  });
});