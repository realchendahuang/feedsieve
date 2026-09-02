// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BUNDLED_KEYWORD_PACK_CATALOG,
  getKeywordPackCatalog,
  KEYWORD_PACK_SYNC_MAX_AGE_MS,
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
  it('构建时词库包含八个可订阅行业包、成人高召回规则和分词组合', () => {
    expect(BUNDLED_KEYWORD_PACK_CATALOG.pack_version).toBe('2026.09.02.5');
    expect(BUNDLED_KEYWORD_PACK_CATALOG.packs).toHaveLength(8);
    expect(
      BUNDLED_KEYWORD_PACK_CATALOG.packs.reduce((count, pack) => count + pack.rules.length, 0),
    ).toBe(778);
    expect(
      BUNDLED_KEYWORD_PACK_CATALOG.packs
        .find((pack) => pack.id === 'task_job_scam')
        ?.rules.some((rule) => rule.phrase === '刷单返利'),
    ).toBe(true);
    expect(
      BUNDLED_KEYWORD_PACK_CATALOG.packs.find((pack) => pack.id === 'adult_gray_traffic')?.rules,
    ).toHaveLength(629);
    expect(
      BUNDLED_KEYWORD_PACK_CATALOG.packs
        .find((pack) => pack.id === 'adult_gray_traffic')
        ?.rules.find((rule) => rule.id === 'adult-terms-local-door'),
    ).toMatchObject({
      phrase: '同城 + 上门',
      terms: ['同城', '上门'],
      max_gap: 12,
      name: { zh: '同城 + 上门', en: '同城 + 上门' },
    });
    expect(KEYWORD_PACK_SYNC_MAX_AGE_MS).toBe(15 * 60 * 1000);
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
