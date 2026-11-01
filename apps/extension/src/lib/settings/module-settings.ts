/**
 * 模块总开关：X 页面上哪些功能整体生效（默认全开）。
 *
 * 只放「关掉以后页面上完全不再出现」的模块；模块自己的细项设置留在各自页面。
 * 存 browser.storage.local，不上传。
 */
export const MODULE_SETTINGS_KEY = 'moduleSettingsV1';

export interface ModuleSettings {
  /** AI 味标签 / 折叠 / 回复上的检测按钮（弹窗「AI 味」页仍可手动查） */
  aiCheck: boolean;
  /** 分享菜单里的「复制为 Markdown」「复制推文与评论」 */
  shareMenu: boolean;
}

export const DEFAULT_MODULE_SETTINGS: ModuleSettings = {
  aiCheck: true,
  shareMenu: true,
};

export function normalizeModuleSettings(raw: unknown): ModuleSettings {
  const value = (raw ?? {}) as Partial<ModuleSettings>;
  return {
    aiCheck: value.aiCheck !== false,
    shareMenu: value.shareMenu !== false,
  };
}

export async function getModuleSettings(): Promise<ModuleSettings> {
  const stored = await browser.storage.local.get(MODULE_SETTINGS_KEY);
  return normalizeModuleSettings(stored[MODULE_SETTINGS_KEY]);
}

export async function setModuleSettings(patch: Partial<ModuleSettings>): Promise<ModuleSettings> {
  const next = normalizeModuleSettings({ ...(await getModuleSettings()), ...patch });
  await browser.storage.local.set({ [MODULE_SETTINGS_KEY]: next });
  return next;
}

export function subscribeModuleSettings(onChange: (settings: ModuleSettings) => void): () => void {
  const listener = (changes: Record<string, unknown>, areaName: string): void => {
    if (areaName !== 'local' || !changes[MODULE_SETTINGS_KEY]) return;
    onChange(
      normalizeModuleSettings((changes[MODULE_SETTINGS_KEY] as { newValue?: unknown }).newValue),
    );
  };
  browser.storage.onChanged.addListener(
    listener as Parameters<typeof browser.storage.onChanged.addListener>[0],
  );
  return () =>
    browser.storage.onChanged.removeListener(
      listener as Parameters<typeof browser.storage.onChanged.removeListener>[0],
    );
}
