// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { UI_COPY } from './i18n';

/** zh/en 两份大 map 手写维护，键集合必须完全一致，否则英文用户拿到 undefined 文案。 */
describe('i18n 键对齐', () => {
  it('zh 与 en 的键集合一致', () => {
    expect(Object.keys(UI_COPY.zh).sort()).toEqual(Object.keys(UI_COPY.en).sort());
  });
  it('两语言的键值类型一一对应（字符串对字符串、函数对函数）', () => {
    for (const [key, value] of Object.entries(UI_COPY.zh)) {
      const en = (UI_COPY.en as Record<string, unknown>)[key];
      expect(typeof en, `en.${key} 类型`).toBe(typeof value);
    }
  });
});
