// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_UI_SETTINGS,
  getUiSettings,
  normalizeUiSettings,
  setUiSettings,
  subscribeUiSettings,
  UI_SETTINGS_KEY,
  UI_SETTINGS_VERSION,
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
  it('总开关和细项都默认关；只有明确写 true 才开', () => {
    expect(normalizeUiSettings(undefined)).toEqual(DEFAULT_UI_SETTINGS);
    expect(normalizeUiSettings({ cleanUi: 'yes' })).toEqual(DEFAULT_UI_SETTINGS);
    // 老版本存的脏值 / 字符串不会把细项打开
    expect(normalizeUiSettings({ hideTrends: 'true', hideGrok: 1 })).toEqual(DEFAULT_UI_SETTINGS);
    expect(normalizeUiSettings({ cleanUi: true, hideTrends: true })).toEqual({
      ...DEFAULT_UI_SETTINGS,
      cleanUi: true,
      hideTrends: true,
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

  it('旧版存储没有版本号：细项一律按新默认关闭，只保留总开关', async () => {
    stored[UI_SETTINGS_KEY] = {
      cleanUi: true,
      hideTrends: true,
      hidePromoted: true,
      hideGrok: true,
      systemFont: true,
    };
    expect(await getUiSettings()).toEqual({ ...DEFAULT_UI_SETTINGS, cleanUi: true });
  });

  it('旧数据上保存新选择：保留本次勾选，其余按新默认关闭', async () => {
    stored[UI_SETTINGS_KEY] = { cleanUi: true, hideTrends: true, hidePromoted: true };
    const next = await setUiSettings({ hidePromoteButton: true });
    expect(next).toEqual({ ...DEFAULT_UI_SETTINGS, cleanUi: true, hidePromoteButton: true });
    expect((await getUiSettings()).hidePromoteButton).toBe(true);
  });

  it('保存时写入存储版本号，新版数据读回保留勾选', async () => {
    await setUiSettings({ cleanUi: true, hideGrok: true });
    expect(stored[UI_SETTINGS_KEY]).toMatchObject({
      v: UI_SETTINGS_VERSION,
      cleanUi: true,
      hideGrok: true,
      hideTrends: false,
    });
    expect((await getUiSettings()).hideGrok).toBe(true);
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
