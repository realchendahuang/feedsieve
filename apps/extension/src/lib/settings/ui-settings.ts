/**
 * 界面净化：只改 X 自己的界面，不动内容。
 *
 * - 总开关和每个细项都默认关闭：这是改变 X 外观的功能，用户没主动勾选就不该
 *   有东西消失，否则会以为 X 坏了或插件出故障。
 * - 只存 browser.storage.local，不上传。
 */
export const UI_SETTINGS_KEY = 'uiSettingsV1';

/** 存储结构版本：v1 时代细项默认是开的，读取时按新默认重置（见 readUiSettings）。 */
export const UI_SETTINGS_VERSION = 2;

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
  /** 隐藏帖子右上角给作者本人看的「推广」按钮 */
  hidePromoteButton: boolean;
  /** 隐藏左侧导航的 Grok */
  hideGrok: boolean;
  /** 评论区里只为回复位买蓝 V、没有实质内容的回复降低不透明度 */
  dimPremiumReplies: boolean;
  /** 禁用 Chirp 字体，中文改用 PingFang SC 等系统字体 */
  systemFont: boolean;
}

export const DEFAULT_UI_SETTINGS: UiSettings = {
  cleanUi: false,
  hideForYou: false,
  hideTrends: false,
  hideWhoToFollow: false,
  hidePromoted: false,
  hidePromoteButton: false,
  hideGrok: false,
  dimPremiumReplies: false,
  systemFont: false,
};

export function normalizeUiSettings(raw: unknown): UiSettings {
  const value = (raw ?? {}) as Partial<UiSettings>;
  return {
    cleanUi: value.cleanUi === true,
    hideForYou: value.hideForYou === true,
    hideTrends: value.hideTrends === true,
    hideWhoToFollow: value.hideWhoToFollow === true,
    hidePromoted: value.hidePromoted === true,
    hidePromoteButton: value.hidePromoteButton === true,
    hideGrok: value.hideGrok === true,
    dimPremiumReplies: value.dimPremiumReplies === true,
    systemFont: value.systemFont === true,
  };
}

/**
 * 读存储里的设置，处理旧版本迁移。
 *
 * v1（0.18.x 及更早）细项默认是开的：用户只要动过设置页，storage 里就会落进
 * 「全开」的细项，升级后没法区分哪些是用户主动勾的。这类数据统一按新默认
 * （细项全关）处理，只保留总开关——宁可用户重新勾一次，也不能让人看到东西
 * 消失却不是自己选的。下次保存会写上新版本号，之后按用户的选择走。
 */
export function readUiSettings(raw: unknown): UiSettings {
  const value = (raw ?? {}) as { v?: unknown };
  const settings = normalizeUiSettings(raw);
  if (value.v === UI_SETTINGS_VERSION) return settings;
  return { ...DEFAULT_UI_SETTINGS, cleanUi: settings.cleanUi };
}

export async function getUiSettings(): Promise<UiSettings> {
  const stored = await browser.storage.local.get(UI_SETTINGS_KEY);
  return readUiSettings(stored[UI_SETTINGS_KEY]);
}

export async function setUiSettings(patch: Partial<UiSettings>): Promise<UiSettings> {
  const stored = await browser.storage.local.get(UI_SETTINGS_KEY);
  const next = normalizeUiSettings({ ...readUiSettings(stored[UI_SETTINGS_KEY]), ...patch });
  await browser.storage.local.set({
    [UI_SETTINGS_KEY]: { ...next, v: UI_SETTINGS_VERSION },
  });
  return next;
}

export function subscribeUiSettings(onChange: (settings: UiSettings) => void): () => void {
  const listener = (changes: Record<string, unknown>, areaName: string): void => {
    if (areaName !== 'local' || !changes[UI_SETTINGS_KEY]) return;
    onChange(readUiSettings((changes[UI_SETTINGS_KEY] as { newValue?: unknown }).newValue));
  };
  browser.storage.onChanged.addListener(
    listener as Parameters<typeof browser.storage.onChanged.addListener>[0],
  );
  return () =>
    browser.storage.onChanged.removeListener(
      listener as Parameters<typeof browser.storage.onChanged.removeListener>[0],
    );
}
