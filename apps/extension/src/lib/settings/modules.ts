/**
 * 模块注册表：顶部 tab、齿轮页、模块总开关的唯一来源。
 *
 * 弹窗、内容脚本、后台都从这里读「有哪些模块、顺序、开关字段」，
 * 避免 tab 顺序、设置入口、开关字段三处各写一份。
 */
import type { ModuleSettings } from './module-settings';

export type ModuleId = 'hot' | 'profile' | 'write' | 'ai' | 'filter';

/** 齿轮页：每个模块自己的二级设置页（在模块 tab 内打开）。 */
export type ModuleSettingsPage =
  | 'hotSettings'
  | 'profileSettings'
  | 'writeSettings'
  | 'aiSettings'
  | 'filterSettings';

export interface ModuleDef {
  id: ModuleId;
  /** 顶部 tab 与齿轮页标题的 i18n key */
  labelKey: 'hot' | 'profileNav' | 'writeNav' | 'aiNav' | 'filterNav';
  /** 齿轮页标题的 i18n key（比 tab 名多「设置」） */
  settingsKey:
    | 'hotSettings'
    | 'profileSettings'
    | 'writeSettings'
    | 'aiSettings'
    | 'filterSettings';
  settingsPage: ModuleSettingsPage;
  /** 模块总开关在 ModuleSettings 里的字段名（ai 是 aiCheck，避免与 tab 名混用） */
  settingKey: keyof ModuleSettings;
  enabled: (settings: ModuleSettings) => boolean;
}

/** 固定顺序：热帖 → 主页 → 发帖 → AI 味 → 过滤。全局永远排最后，不在这里。 */
export const MODULES: readonly ModuleDef[] = [
  {
    id: 'hot',
    settingKey: 'hot',
    labelKey: 'hot',
    settingsKey: 'hotSettings',
    settingsPage: 'hotSettings',
    enabled: (settings) => settings.hot,
  },
  {
    id: 'profile',
    settingKey: 'profile',
    labelKey: 'profileNav',
    settingsKey: 'profileSettings',
    settingsPage: 'profileSettings',
    enabled: (settings) => settings.profile,
  },
  {
    id: 'write',
    settingKey: 'write',
    labelKey: 'writeNav',
    settingsKey: 'writeSettings',
    settingsPage: 'writeSettings',
    enabled: (settings) => settings.write,
  },
  {
    id: 'ai',
    settingKey: 'aiCheck',
    labelKey: 'aiNav',
    settingsKey: 'aiSettings',
    settingsPage: 'aiSettings',
    enabled: (settings) => settings.aiCheck,
  },
  {
    id: 'filter',
    settingKey: 'filter',
    labelKey: 'filterNav',
    settingsKey: 'filterSettings',
    settingsPage: 'filterSettings',
    enabled: (settings) => settings.filter,
  },
];

export function enabledModules(settings: ModuleSettings | null): ModuleDef[] {
  if (!settings) return [...MODULES];
  return MODULES.filter((module) => module.enabled(settings));
}

export function moduleById(id: ModuleId): ModuleDef {
  const found = MODULES.find((module) => module.id === id);
  if (!found) throw new Error(`unknown module: ${id}`);
  return found;
}

export function isModuleId(value: unknown): value is ModuleId {
  return typeof value === 'string' && MODULES.some((module) => module.id === value);
}
