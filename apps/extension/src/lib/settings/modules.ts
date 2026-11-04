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
  /** 顶栏悬浮提示：名字取得诗意，hover 时给出它到底是干什么的 */
  titleKey?: 'hotTabTitle' | 'profileTabTitle' | 'writeTabTitle';
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

/** 固定顺序：淘金 → 阅人 → 落笔 → 水军 → 伪人。校秤永远排最后，不在这里。
 *  水军与伪人同属「降噪」，顶栏合并成一格；这里的先后要和 MODULE_GROUPS 的组内顺序
 *  一致，否则「设置 › 模块开关」的排列会和二级 tab 对不上。 */
export const MODULES: readonly ModuleDef[] = [
  {
    id: 'hot',
    settingKey: 'hot',
    labelKey: 'hot',
    titleKey: 'hotTabTitle',
    settingsKey: 'hotSettings',
    settingsPage: 'hotSettings',
    enabled: (settings) => settings.hot,
  },
  {
    id: 'profile',
    settingKey: 'profile',
    labelKey: 'profileNav',
    titleKey: 'profileTabTitle',
    settingsKey: 'profileSettings',
    settingsPage: 'profileSettings',
    enabled: (settings) => settings.profile,
  },
  {
    id: 'write',
    settingKey: 'write',
    labelKey: 'writeNav',
    titleKey: 'writeTabTitle',
    settingsKey: 'writeSettings',
    settingsPage: 'writeSettings',
    enabled: (settings) => settings.write,
  },
  {
    id: 'filter',
    settingKey: 'filter',
    labelKey: 'filterNav',
    settingsKey: 'filterSettings',
    settingsPage: 'filterSettings',
    enabled: (settings) => settings.filter,
  },
  {
    id: 'ai',
    settingKey: 'aiCheck',
    labelKey: 'aiNav',
    settingsKey: 'aiSettings',
    settingsPage: 'aiSettings',
    enabled: (settings) => settings.aiCheck,
  },
];

/**
 * 二级导航分组：同组模块共用顶栏一个 tab，组内再分二级 tab。
 * `moduleIds` 的顺序就是二级 tab 的顺序（水军在前，伪人在后）。
 */
export interface ModuleGroupDef {
  id: 'noise';
  /** 顶栏 tab 名的 i18n key */
  labelKey: 'noiseNav';
  moduleIds: readonly ModuleId[];
}

/** 「降噪」= 把刷到的噪音降下去：黄推水军、AI 味、关键词都在这一格下面。 */
export const MODULE_GROUPS: readonly ModuleGroupDef[] = [
  { id: 'noise', labelKey: 'noiseNav', moduleIds: ['filter', 'ai'] },
];

/** 模块属于哪个分组；不在分组里的模块自己占一个顶栏 tab。 */
export function groupOf(moduleId: ModuleId): ModuleGroupDef | undefined {
  return MODULE_GROUPS.find((group) => group.moduleIds.includes(moduleId));
}

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
