// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_MODULE_SETTINGS,
  getModuleSettings,
  normalizeModuleSettings,
  setModuleSettings,
  subscribeModuleSettings,
} from './module-settings';

let stored: Record<string, unknown>;
let listener: ((changes: Record<string, unknown>, area: string) => void) | null;
let removed: unknown;

beforeEach(() => {
  stored = {};
  listener = null;
  removed = null;
  (globalThis as unknown as { browser: unknown }).browser = {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: stored[key] })),
        set: vi.fn(async (patch: Record<string, unknown>) => {
          Object.assign(stored, patch);
        }),
      },
      onChanged: {
        addListener: vi.fn((fn: typeof listener) => {
          listener = fn;
        }),
        removeListener: vi.fn((fn: unknown) => {
          removed = fn;
        }),
      },
    },
  };
});

describe('module-settings', () => {
  it('缺省全开，只有明确写 false 才关', () => {
    expect(normalizeModuleSettings(undefined)).toEqual(DEFAULT_MODULE_SETTINGS);
    expect(normalizeModuleSettings({ aiCheck: false })).toEqual({
      ...DEFAULT_MODULE_SETTINGS,
      aiCheck: false,
    });
    expect(normalizeModuleSettings({ shareMenu: 0 })).toEqual(DEFAULT_MODULE_SETTINGS);
    // 旧版本只存过 aiCheck / shareMenu：新模块必须默认开
    expect(normalizeModuleSettings({ aiCheck: false, shareMenu: false })).toEqual({
      ...DEFAULT_MODULE_SETTINGS,
      aiCheck: false,
      shareMenu: false,
    });
  });

  it('读不到时用默认值，写入按字段合并', async () => {
    expect(await getModuleSettings()).toEqual(DEFAULT_MODULE_SETTINGS);
    await setModuleSettings({ aiCheck: false });
    expect(await getModuleSettings()).toEqual({ ...DEFAULT_MODULE_SETTINGS, aiCheck: false });
    await setModuleSettings({ shareMenu: false, hot: false });
    expect(await getModuleSettings()).toEqual({
      ...DEFAULT_MODULE_SETTINGS,
      aiCheck: false,
      shareMenu: false,
      hot: false,
    });
  });

  it('订阅只认本键，取消后不再回调', () => {
    const seen: boolean[] = [];
    const unsubscribe = subscribeModuleSettings((settings) => seen.push(settings.aiCheck));
    listener?.({ other: { newValue: 1 } }, 'local');
    listener?.({ moduleSettingsV1: { newValue: { aiCheck: false } } }, 'sync');
    listener?.({ moduleSettingsV1: { newValue: { aiCheck: false } } }, 'local');
    expect(seen).toEqual([false]);
    unsubscribe();
    expect(removed).toBe(listener);
  });
});
