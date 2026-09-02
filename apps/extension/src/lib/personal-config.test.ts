import { describe, expect, it } from 'vitest';
import {
  createPersonalConfigDocument,
  MAX_PERSONAL_CONFIG_BYTES,
  parsePersonalConfigDocument,
  PERSONAL_CONFIG_FORMAT,
  preparePersonalConfigImport,
  serializePersonalConfigDocument,
  type PersonalConfigContext,
  type PersonalConfigDocument,
} from './personal-config';
import { BUNDLED_KEYWORD_PACK_CATALOG } from './keyword-packs';

function context(overrides: Partial<PersonalConfigContext> = {}): PersonalConfigContext {
  return {
    keywordRules: {
      subscriptionDefaultsVersion: 2,
      subscribedCategoryIds: BUNDLED_KEYWORD_PACK_CATALOG.packs.map((pack) => pack.id),
      disabledOfficialRuleIds: [],
      customRules: [],
    },
    community: { enabled: true, strength: 'standard' },
    language: 'zh',
    catalog: BUNDLED_KEYWORD_PACK_CATALOG,
    ...overrides,
  };
}

function document(overrides: Partial<PersonalConfigDocument> = {}): PersonalConfigDocument {
  return {
    format: PERSONAL_CONFIG_FORMAT,
    schemaVersion: 1,
    exportedAt: '2026-09-02T00:00:00.000Z',
    keywordRules: {
      customPhrases: ['我的关键词'],
      knownCategoryIds: BUNDLED_KEYWORD_PACK_CATALOG.packs.map((pack) => pack.id),
      subscribedCategoryIds: BUNDLED_KEYWORD_PACK_CATALOG.packs.map((pack) => pack.id),
      disabledOfficialRuleIds: [],
    },
    preferences: { uiLanguage: 'zh', communityEnabled: true, markStrength: 'standard' },
    ...overrides,
  };
}

describe('个人配置备份与迁移', () => {
  it('只导出个人过滤配置，不包含社区上传授权或动作记录', () => {
    const value = createPersonalConfigDocument(
      context({
        keywordRules: {
          subscriptionDefaultsVersion: 2,
          subscribedCategoryIds: ['adult_gray_traffic'],
          disabledOfficialRuleIds: ['adult-fu-not-black'],
          customRules: [
            { id: 'one', phrase: '  我的词  ', createdAt: 100 },
            { id: 'two', phrase: '我的词', createdAt: 200 },
          ],
        },
        community: { enabled: false, strength: 'deep_clean' },
        language: 'en',
      }),
      '2026-09-02T00:00:00.000Z',
    );

    expect(value).toEqual({
      format: PERSONAL_CONFIG_FORMAT,
      schemaVersion: 1,
      exportedAt: '2026-09-02T00:00:00.000Z',
      keywordRules: {
        customPhrases: ['我的词'],
        knownCategoryIds: BUNDLED_KEYWORD_PACK_CATALOG.packs.map((pack) => pack.id),
        subscribedCategoryIds: ['adult_gray_traffic'],
        disabledOfficialRuleIds: ['adult-fu-not-black'],
      },
      preferences: { uiLanguage: 'en', communityEnabled: false, markStrength: 'deep_clean' },
    });
    expect(serializePersonalConfigDocument(value)).not.toContain('autoContribute');
    expect(serializePersonalConfigDocument(value)).not.toContain('installationId');
  });

  it('拒绝损坏、未知版本、非法字段和超大文件', () => {
    expect(parsePersonalConfigDocument('{')).toEqual({ ok: false, error: 'invalid_json' });
    expect(parsePersonalConfigDocument(JSON.stringify({ format: 'other', schemaVersion: 1 }))).toEqual({
      ok: false,
      error: 'invalid_format',
    });
    expect(
      parsePersonalConfigDocument(
        JSON.stringify({ ...document(), schemaVersion: 9 }),
      ),
    ).toEqual({ ok: false, error: 'unsupported_version' });
    expect(
      parsePersonalConfigDocument(
        JSON.stringify({
          ...document(),
          keywordRules: { ...document().keywordRules, customPhrases: [''] },
        }),
      ),
    ).toEqual({ ok: false, error: 'invalid_payload' });
    expect(
      parsePersonalConfigDocument(
        JSON.stringify({
          ...document(),
          keywordRules: {
            ...document().keywordRules,
            customPhrases: Array.from({ length: 81 }, (_, index) => `词${index}`),
          },
        }),
      ),
    ).toEqual({ ok: false, error: 'invalid_payload' });
    expect(
      parsePersonalConfigDocument(
        JSON.stringify({
          ...document(),
          preferences: { ...document().preferences, uiLanguage: 'ja' },
        }),
      ),
    ).toEqual({ ok: false, error: 'invalid_payload' });
    expect(
      parsePersonalConfigDocument(
        JSON.stringify({
          ...document(),
          preferences: { ...document().preferences, markStrength: 'maximum' },
        }),
      ),
    ).toEqual({ ok: false, error: 'invalid_payload' });
    expect(parsePersonalConfigDocument('a'.repeat(MAX_PERSONAL_CONFIG_BYTES + 1))).toEqual({
      ok: false,
      error: 'file_too_large',
    });
  });

  it('接受重复文本但以现有匹配归一化规则去重', () => {
    const result = parsePersonalConfigDocument(
      JSON.stringify({
        ...document(),
        keywordRules: {
          ...document().keywordRules,
          customPhrases: ['ＡＢＣ', 'abc', '  abc  ', '不同词'],
        },
      }),
    );

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        document: expect.objectContaining({
          keywordRules: expect.objectContaining({ customPhrases: ['ＡＢＣ', '不同词'] }),
        }),
      }),
    );
  });

  it('导入时按实际关键词归一化去重，并保留新增分类的本机默认状态', () => {
    const source = document({
      keywordRules: {
        customPhrases: ['ＡＢＣ', 'abc', '新词'],
        knownCategoryIds: ['adult_gray_traffic', 'removed-category'],
        subscribedCategoryIds: [],
        disabledOfficialRuleIds: ['adult-fu-not-black', 'removed_rule'],
      },
      preferences: { uiLanguage: 'en', communityEnabled: false, markStrength: 'deep_clean' },
    });
    const current = context({
      keywordRules: {
        subscriptionDefaultsVersion: 2,
        subscribedCategoryIds: BUNDLED_KEYWORD_PACK_CATALOG.packs.map((pack) => pack.id),
        disabledOfficialRuleIds: [],
        customRules: [{ id: 'kept', phrase: 'abc', createdAt: 10 }],
      },
    });

    const prepared = preparePersonalConfigImport(source, current, 'merge', {
      now: () => 20,
      makeRuleId: () => 'new-id',
    });

    expect(prepared.preview.customRules).toMatchObject({
      backupCount: 2,
      addedCount: 1,
      alreadyPresentCount: 1,
      resultCount: 2,
    });
    expect(prepared.preview.ignoredRuleIds).toEqual(['removed_rule']);
    expect(prepared.preview.ignoredCategoryIds).toEqual(['removed-category']);
    expect(prepared.next?.keywordRules.customRules).toEqual([
      { id: 'kept', phrase: 'abc', createdAt: 10 },
      { id: 'new-id', phrase: '新词', createdAt: 20 },
    ]);
    expect(prepared.next?.keywordRules.subscribedCategoryIds).not.toContain('adult_gray_traffic');
    expect(prepared.next?.keywordRules.subscribedCategoryIds).toContain('scam_phishing');
    expect(prepared.next?.keywordRules.disabledOfficialRuleIds).toEqual(['adult-fu-not-black']);
    expect(prepared.next?.preferences).toEqual(source.preferences);

    let replacementId = 0;
    const replaced = preparePersonalConfigImport(source, current, 'replace', {
      now: () => 30,
      makeRuleId: () => `restored-${++replacementId}`,
    });
    expect(replaced.next?.keywordRules.customRules).toEqual([
      { id: 'restored-1', phrase: 'ＡＢＣ', createdAt: 30 },
      { id: 'restored-2', phrase: '新词', createdAt: 30 },
    ]);
    expect(replaced.next?.keywordRules.subscribedCategoryIds).not.toContain('adult_gray_traffic');
    expect(replaced.next?.keywordRules.subscribedCategoryIds).toContain('scam_phishing');
    expect(replaced.next?.keywordRules.disabledOfficialRuleIds).toEqual(['adult-fu-not-black']);
    expect(replaced.next?.preferences).toEqual(source.preferences);
  });

  it('合并超过 80 条时只给预览，替换仍可安全恢复备份', () => {
    const current = context({
      keywordRules: {
        subscriptionDefaultsVersion: 2,
        subscribedCategoryIds: [],
        disabledOfficialRuleIds: [],
        customRules: Array.from({ length: 80 }, (_, index) => ({
          id: `local-${index}`,
          phrase: `本机词${index}`,
          createdAt: index,
        })),
      },
    });
    const source = document({
      keywordRules: {
        ...document().keywordRules,
        customPhrases: ['备份词'],
      },
    });

    const merged = preparePersonalConfigImport(source, current, 'merge');
    const replaced = preparePersonalConfigImport(source, current, 'replace', {
      now: () => 1,
      makeRuleId: () => 'restored',
    });

    expect(merged.preview.customRules.exceedsLimit).toBe(true);
    expect(merged.next).toBeNull();
    expect(replaced.preview.customRules.exceedsLimit).toBe(false);
    expect(replaced.preview.customRules.removedCount).toBe(80);
    expect(replaced.next?.keywordRules.customRules).toEqual([
      { id: 'restored', phrase: '备份词', createdAt: 1 },
    ]);
  });

  it('配置文件解析后仍可得到稳定、可导入的纯数据', () => {
    const source = createPersonalConfigDocument(context(), '2026-09-02T00:00:00.000Z');
    expect(parsePersonalConfigDocument(serializePersonalConfigDocument(source))).toEqual({
      ok: true,
      document: source,
    });
  });
});
