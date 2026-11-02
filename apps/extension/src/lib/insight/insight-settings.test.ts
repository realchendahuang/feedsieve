// @vitest-environment happy-dom
// 主页洞察的两个显示开关：流速与量级默认开，主页人气行默认关。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getInsightBadgesEnabled,
  getProfileLineEnabled,
  setProfileLineEnabled,
  subscribeProfileLineEnabled,
} from './insight-settings';

let stored: Record<string, unknown>;
let listeners: Array<(changes: Record<string, unknown>, areaName: string) => void>;

beforeEach(() => {
  stored = {};
  listeners = [];
  vi.stubGlobal('browser', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: stored[key] })),
        set: vi.fn(async (patch: Record<string, unknown>) => Object.assign(stored, patch)),
      },
      onChanged: {
        addListener: (listener: (typeof listeners)[number]) => listeners.push(listener),
        removeListener: vi.fn(),
      },
    },
  });
});

describe('主页洞察开关', () => {
  it('流速与量级默认开，主页人气行默认关', async () => {
    expect(await getInsightBadgesEnabled()).toBe(true);
    expect(await getProfileLineEnabled()).toBe(false);
  });

  it('打开人气行会写入并通知内容脚本', async () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeProfileLineEnabled(onChange);
    await setProfileLineEnabled(true);
    expect(stored.profileLine).toBe(true);
    listeners.forEach((listener) => listener({ profileLine: { newValue: true } }, 'local'));
    expect(onChange).toHaveBeenCalledWith(true);
    unsubscribe();
  });
});
