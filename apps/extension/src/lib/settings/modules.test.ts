import { describe, expect, it } from 'vitest';
import { DEFAULT_MODULE_SETTINGS } from './module-settings';
import { enabledModules, isModuleId, MODULES, moduleById } from './modules';

describe('模块注册表', () => {
  it('固定顺序：热帖 → 主页 → 发帖 → AI 味 → 过滤', () => {
    expect(MODULES.map((module) => module.id)).toEqual([
      'hot',
      'profile',
      'write',
      'ai',
      'filter',
    ]);
  });

  it('按模块开关过滤；拿不到设置时先按全开处理，避免首帧空栏', () => {
    expect(enabledModules(null).map((module) => module.id)).toEqual([
      'hot',
      'profile',
      'write',
      'ai',
      'filter',
    ]);
    expect(
      enabledModules({ ...DEFAULT_MODULE_SETTINGS, hot: false, write: false }).map(
        (module) => module.id,
      ),
    ).toEqual(['profile', 'ai', 'filter']);
    expect(
      enabledModules({
        ...DEFAULT_MODULE_SETTINGS,
        hot: false,
        profile: false,
        write: false,
        aiCheck: false,
        filter: false,
      }),
    ).toEqual([]);
  });

  it('每个模块的齿轮页与开关字段一一对应', () => {
    expect(MODULES.map((module) => module.settingsPage)).toEqual([
      'hotSettings',
      'profileSettings',
      'writeSettings',
      'aiSettings',
      'filterSettings',
    ]);
    expect(moduleById('ai').enabled({ ...DEFAULT_MODULE_SETTINGS, aiCheck: false })).toBe(false);
    expect(moduleById('filter').enabled({ ...DEFAULT_MODULE_SETTINGS, filter: false })).toBe(
      false,
    );
  });

  it('只认已注册的模块 id', () => {
    expect(isModuleId('hot')).toBe(true);
    expect(isModuleId('global')).toBe(false);
    expect(isModuleId(undefined)).toBe(false);
  });
});
