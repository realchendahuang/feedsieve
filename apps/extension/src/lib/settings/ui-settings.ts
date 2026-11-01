/**
 * 界面净化：只改 X 自己的界面，不动内容。
 *
 * - 总开关关闭时，所有细项都不生效（默认关闭：这是改变 X 外观的功能，要用户主动开）。
 * - 细项默认开启，打开总开关就能直接看到效果。
 * - 只存 browser.storage.local，不上传。
 */
export const UI_SETTINGS_KEY = 'uiSettingsV1';

export interface UiSettings {
  /** 总开关 */
  cleanUi: boolean;
  /** 隐藏「为你推荐」并停在「正在关注」 */
  hideForYou: boolean;
  /** 隐藏右侧栏的趋势模块 */
  hideTrends: boolean;
  /** 隐藏右侧栏的推荐关注模块 */
  hideWhoToFollow: boolean;
  /** 隐藏时间线里的付费推广 */
  hidePromoted: boolean;
  /** 隐藏左侧导航的 Grok */
  hideGrok: boolean;
  /** 评论区里只为回复位买蓝 V、没有实质内容的回复降低不透明度 */
  dimPremiumReplies: boolean;
  /** 禁用 Chirp 字体，中文改用 PingFang SC 等系统字体 */
  systemFont: boolean;
}

export const DEFAULT_UI_SETTINGS: UiSettings = {
  cleanUi: false,
  hideForYou: true,
  hideTrends: true,
  hideWhoToFollow: true,
  hidePromoted: true,
  hideGrok: true,
  dimPremiumReplies: true,
  systemFont: true,
};

export function normalizeUiSettings(raw: unknown): UiSettings {
  const value = (raw ?? {}) as Partial<UiSettings>;
  return {
    cleanUi: value.cleanUi === true,
    hideForYou: value.hideForYou !== false,
    hideTrends: value.hideTrends !== false,
    hideWhoToFollow: value.hideWhoToFollow !== false,
    hidePromoted: value.hidePromoted !== false,
    hideGrok: value.hideGrok !== false,
    dimPremiumReplies: value.dimPremiumReplies !== false,
    systemFont: value.systemFont !== false,
  };
}

export async function getUiSettings(): Promise<UiSettings> {
  const stored = await browser.storage.local.get(UI_SETTINGS_KEY);
  return normalizeUiSettings(stored[UI_SETTINGS_KEY]);
}

export async function setUiSettings(patch: Partial<UiSettings>): Promise<UiSettings> {
  const next = normalizeUiSettings({ ...(await getUiSettings()), ...patch });
  await browser.storage.local.set({ [UI_SETTINGS_KEY]: next });
  return next;
}

export function subscribeUiSettings(onChange: (settings: UiSettings) => void): () => void {
  const listener = (changes: Record<string, unknown>, areaName: string): void => {
    if (areaName !== 'local' || !changes[UI_SETTINGS_KEY]) return;
    onChange(normalizeUiSettings((changes[UI_SETTINGS_KEY] as { newValue?: unknown }).newValue));
  };
  browser.storage.onChanged.addListener(
    listener as Parameters<typeof browser.storage.onChanged.addListener>[0],
  );
  return () =>
    browser.storage.onChanged.removeListener(
      listener as Parameters<typeof browser.storage.onChanged.removeListener>[0],
    );
}
