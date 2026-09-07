// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  noteActionResult,
  noteResolveTrace,
  noteTimelineHealth,
  readCapabilities,
  shouldPauseDestructive,
} from './status';

const BASE_MS = 1_000_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(BASE_MS);
  document.cookie = 'ct0=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
});

afterEach(() => {
  vi.useRealTimers();
  document.cookie = 'ct0=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
});

describe('readCapabilities（非破坏性观测汇总）', () => {
  it('没有任何观测时所有操作状态为 unknown', () => {
    document.cookie = 'ct0=garbage-token; other=1';
    const caps = readCapabilities();
    expect(caps).toMatchObject({
      sessionUsable: true,
      csrfAvailable: true,
      block: 'unknown',
      unblock: 'unknown',
      userIdResolution: 'unknown',
      timelineParsing: 'unknown',
    });
  });

  it('block 成功 -> working；429/网络 -> degraded；认证失败 -> failed 且暂停破坏性操作', () => {
    document.cookie = 'ct0=garbage-token';
    noteActionResult('block', { ok: true });
    expect(readCapabilities().block).toBe('working');

    noteActionResult('block', { ok: false, code: 'rate_limited', statusCode: 429 });
    expect(readCapabilities().block).toBe('degraded');

    noteActionResult('block', { ok: false, code: 'network_error' });
    expect(readCapabilities().block).toBe('degraded');

    noteActionResult('block', { ok: false, code: 'auth_required', statusCode: 403 });
    const failed = readCapabilities();
    expect(failed.block).toBe('failed');
    expect(failed.sessionUsable).toBe(false);
    expect(shouldPauseDestructive(failed)).toBe(true);
  });

  it('端点被移除（404/405/410）-> unsupported，扩展暂停破坏性操作', () => {
    document.cookie = 'ct0=garbage-token';
    noteActionResult('unblock', { ok: false, code: 'http_error', statusCode: 404 });
    const caps = readCapabilities();
    expect(caps.unblock).toBe('unsupported');
    expect(shouldPauseDestructive(caps)).toBe(true);
  });

  it('resolve 查无此人算 working；no_csrf/限流/网络算 degraded', () => {
    document.cookie = 'ct0=garbage-token';
    noteResolveTrace('unavailable');
    expect(readCapabilities().userIdResolution).toBe('working');
    noteResolveTrace('no_csrf');
    expect(readCapabilities().userIdResolution).toBe('degraded');
    noteResolveTrace('rate_limited');
    expect(readCapabilities().userIdResolution).toBe('degraded');
  });

  it('timeline 心跳失败 -> degraded', () => {
    document.cookie = 'ct0=garbage-token';
    noteTimelineHealth(true);
    expect(readCapabilities().timelineParsing).toBe('working');
    noteTimelineHealth(false, 'reader_exception');
    expect(readCapabilities().timelineParsing).toBe('degraded');
  });

  it('无 ct0 时破坏性操作应暂停', () => {
    noteActionResult('block', { ok: true });
    const caps = readCapabilities();
    expect(caps.csrfAvailable).toBe(false);
    expect(shouldPauseDestructive(caps)).toBe(true);
  });

  it('观测超出 15 分钟窗口后回到 unknown（契约可能已恢复，重新实测）', () => {
    document.cookie = 'ct0=garbage-token';
    noteActionResult('block', { ok: false, code: 'auth_required', statusCode: 401 });
    expect(readCapabilities().block).toBe('failed');

    vi.advanceTimersByTime(16 * 60 * 1000);
    expect(readCapabilities().block).toBe('unknown');
  });
});