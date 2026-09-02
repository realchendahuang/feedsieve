// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BUNDLED_KEYWORD_PACK_CATALOG,
  getKeywordPackCatalog,
  parseKeywordPackCatalog,
} from './keyword-packs';

let storage: Record<string, unknown>;

beforeEach(() => {
  storage = {};
  vi.stubGlobal('browser', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
        set: vi.fn(async (patch: Record<string, unknown>) => Object.assign(storage, patch)),
      },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  });
});

describe('远程关键词包契约', () => {
  it('构建时词库包含可订阅行业包和大量完整短语', () => {
    expect(BUNDLED_KEYWORD_PACK_CATALOG.pack_version).toBe('2026.09.02.3');
    expect(BUNDLED_KEYWORD_PACK_CATALOG.packs).toHaveLength(8);
    expect(
      BUNDLED_KEYWORD_PACK_CATALOG.packs.reduce((count, pack) => count + pack.rules.length, 0),
    ).toBe(138);
    expect(
      BUNDLED_KEYWORD_PACK_CATALOG.packs
        .find((pack) => pack.id === 'task_job_scam')
        ?.rules.some((rule) => rule.phrase === '刷单返利'),
    ).toBe(true);
  });

  it('拒绝重复规则 ID，避免远程包覆盖或混淆用户的逐条开关', () => {
    const invalid = structuredClone(BUNDLED_KEYWORD_PACK_CATALOG) as unknown as {
      packs: Array<{ rules: Array<{ id: string }> }>;
    };
    invalid.packs[1]!.rules[0]!.id = invalid.packs[0]!.rules[0]!.id;
    expect(parseKeywordPackCatalog(invalid)).toBeNull();
  });

  it('没有校验通过的远程缓存时，使用随扩展打包的公开版本', async () => {
    const catalog = await getKeywordPackCatalog();
    expect(catalog.pack_version).toBe(BUNDLED_KEYWORD_PACK_CATALOG.pack_version);
  });
});
