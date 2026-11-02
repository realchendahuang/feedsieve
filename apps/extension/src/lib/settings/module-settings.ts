/**
 * 模块总开关：X 页面上哪些功能整体生效（默认全开）。
 *
 * 只放「关掉以后页面上完全不再出现」的模块；模块自己的细项设置留在各自页面。
 * 关掉 = 停用界面与行为，不删本地数据；重新打开即恢复。
 * 存 browser.storage.local，不上传。
 */
export const MODULE_SETTINGS_KEY = 'moduleSettingsV1';

export interface ModuleSettings {
  /** 热帖：流速与量级、热帖采集、已读记录 */
  hot: boolean;
  /** 主页：资料卡人气行、主页帖子库采集与补全 */
  profile: boolean;
  /** 发帖：发帖框排期、发帖节奏、文章编辑器助手 */
  write: boolean;
  /** AI 味标签 / 折叠 / 回复上的检测按钮 */
  aiCheck: boolean;
  /** 过滤：自动标黄、界面净化、过滤规则与名单 */
  filter: boolean;
  /** 分享菜单里的「复制为 Markdown」「复制推文与评论」（无 tab，放全局） */
  shareMenu: boolean;
}

export const DEFAULT_MODULE_SETTINGS: ModuleSettings = {
  hot: true,
  profile: true,
  write: true,
  aiCheck: true,
  filter: true,
  shareMenu: true,
};

export function normalizeModuleSettings(raw: unknown): ModuleSettings {
  const value = (raw ?? {}) as Partial<ModuleSettings>;
  return {
    // 旧版本只存过 aiCheck / shareMenu；缺省的模块一律按开处理
    hot: value.hot !== false,
    profile: value.profile !== false,
    write: value.write !== false,
    aiCheck: value.aiCheck !== false,
    filter: value.filter !== false,
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
