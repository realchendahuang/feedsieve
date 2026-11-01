// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_UI_SETTINGS,
  getUiSettings,
  normalizeUiSettings,
  setUiSettings,
  subscribeUiSettings,
} from './ui-settings';

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

describe('ui-settings', () => {
  it('总开关默认关，细项默认开；只有明确写 false 才关', () => {
    expect(normalizeUiSettings(undefined)).toEqual(DEFAULT_UI_SETTINGS);
    expect(normalizeUiSettings({ cleanUi: 'yes' })).toEqual(DEFAULT_UI_SETTINGS);
    expect(normalizeUiSettings({ cleanUi: true, hideTrends: false })).toEqual({
      ...DEFAULT_UI_SETTINGS,
      cleanUi: true,
      hideTrends: false,
    });
  });

  it('读写按字段合并', async () => {
    expect(await getUiSettings()).toEqual(DEFAULT_UI_SETTINGS);
    await setUiSettings({ cleanUi: true });
    expect((await getUiSettings()).cleanUi).toBe(true);
    await setUiSettings({ systemFont: false });
    expect((await getUiSettings()).systemFont).toBe(false);
    expect((await getUiSettings()).cleanUi).toBe(true);
  });

  it('订阅只认本键，取消后不再回调', () => {
    const seen: boolean[] = [];
    const unsubscribe = subscribeUiSettings((settings) => seen.push(settings.cleanUi));
    listener?.({ other: { newValue: 1 } }, 'local');
    listener?.({ uiSettingsV1: { newValue: { cleanUi: true } } }, 'sync');
    listener?.({ uiSettingsV1: { newValue: { cleanUi: true } } }, 'local');
    expect(seen).toEqual([true]);
    unsubscribe();
    expect(removed).toBe(listener);
  });
});
