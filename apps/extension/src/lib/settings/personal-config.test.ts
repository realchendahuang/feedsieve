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
import { BUNDLED_KEYWORD_PACK_CATALOG } from '../detection/keyword-packs';

function context(overrides: Partial<PersonalConfigContext> = {}): PersonalConfigContext {
  return {
    keywordRules: {
      subscriptionDefaultsVersion: 3,
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
          subscriptionDefaultsVersion: 3,
          subscribedCategoryIds: ['adult_gray_traffic'],
          disabledOfficialRuleIds: ['adult-profile-collect-benefits'],
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
      schemaVersion: 2,
      exportedAt: '2026-09-02T00:00:00.000Z',
      keywordRules: {
        customPhrases: ['我的词'],
        knownCategoryIds: BUNDLED_KEYWORD_PACK_CATALOG.packs.map((pack) => pack.id),
        subscribedCategoryIds: ['adult_gray_traffic'],
        disabledOfficialRuleIds: ['adult-profile-collect-benefits'],
      },
      preferences: { uiLanguage: 'en', communityEnabled: false, markStrength: 'deep_clean' },
    });
    expect(serializePersonalConfigDocument(value)).not.toContain('autoContribute');
    expect(serializePersonalConfigDocument(value)).not.toContain('installationId');
  });

  it('拒绝损坏、未知版本、非法字段和超大文件', () => {
    expect(parsePersonalConfigDocument('{')).toEqual({ ok: false, error: 'invalid_json' });
    expect(
      parsePersonalConfigDocument(JSON.stringify({ format: 'other', schemaVersion: 1 })),
    ).toEqual({
      ok: false,
      error: 'invalid_format',
    });
    expect(
      parsePersonalConfigDocument(JSON.stringify({ ...document(), schemaVersion: 9 })),
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
        disabledOfficialRuleIds: ['adult-profile-collect-benefits', 'removed_rule'],
      },
      preferences: { uiLanguage: 'en', communityEnabled: false, markStrength: 'deep_clean' },
    });
    const current = context({
      keywordRules: {
        subscriptionDefaultsVersion: 3,
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
    // 备份不知晓的新默认包（crypto_giveaway_scams）保留本机默认订阅状态；
    // adult 是备份显式取消过的分类，备份偏好为准 -> 从订阅列表移除
    expect(prepared.next?.keywordRules.subscribedCategoryIds).toEqual(['crypto_giveaway_scams']);
    expect(prepared.next?.keywordRules.disabledOfficialRuleIds).toEqual(['adult-profile-collect-benefits']);
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
    // 替换语义：备份不知晓的新默认包保留本机状态，被移除的旧分类不会带回来
    expect(replaced.next?.keywordRules.subscribedCategoryIds).toEqual(['crypto_giveaway_scams']);
    expect(replaced.next?.keywordRules.disabledOfficialRuleIds).toEqual(['adult-profile-collect-benefits']);
    expect(replaced.next?.preferences).toEqual(source.preferences);
  });

  it('合并超过 80 条时只给预览，替换仍可安全恢复备份', () => {
    const current = context({
      keywordRules: {
        subscriptionDefaultsVersion: 3,
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

  it('v2 支持完整纯偏好设置导入导出，且兼容 v1 备份（缺省分区不改写本机设置）', () => {
    const fullCtx = context({
      uiSettings: {
        cleanUi: true,
        hideForYou: true,
        hideTrends: false,
        hideWhoToFollow: true,
        hidePromoted: false,
        hidePromoteButton: false,
        hideGrok: true,
        dimPremiumReplies: false,
        systemFont: true,
      },
      composeSchedule: {
        composeHelper: false,
        articleHelper: true,
        windows: [{ id: 'w1', days: [1, 3, 5], start: '09:00', end: '11:00', perHour: 2 }],
        minGapMinutes: 30,
        leadMinutes: 10,
        randomize: false,
        horizonDays: 7,
      },
      modules: {
        hot: true,
        profile: false,
        write: true,
        aiCheck: false,
        filter: true,
        shareMenu: false,
      },
      searchAssist: {
        enabled: false,
        prefs: {
          allWords: 'ai',
          exactPhrase: '',
          anyWords: '',
          noneWords: '',
          hashtags: '',
          language: 'zh',
          to: '',
          mention: '',
          since: '2026-01-01',
          until: '',
          minReplies: '',
          minRetweets: '',
          minLikes: '10',
          content: 'images',
          replies: 'exclude',
          excludeRetweets: true,
          verifiedOnly: false,
          near: '',
          within: '',
          unit: 'km',
          sort: 'live',
          raw: '',
        },
      },
      insight: { badges: false, profileLine: true },
      aiDisplay: { mode: 'fold', scope: 'blue', markFollowing: true },
    });

    const exported = createPersonalConfigDocument(fullCtx, '2026-11-18T00:00:00.000Z');
    const serialized = serializePersonalConfigDocument(exported);
    expect(serialized).not.toContain('blockedAccounts');
    expect(serialized).not.toContain('scheduledPosts');
    expect(serialized).not.toContain('articleBackups');

    const parsed = parsePersonalConfigDocument(serialized);
    expect(parsed).toEqual({ ok: true, document: exported });
    if (!parsed.ok) return;

    const prepared = preparePersonalConfigImport(parsed.document, context(), 'merge');
    expect(prepared.preview.sectionChanges).toEqual([
      { section: 'uiSettings', changedCount: 5 },
      { section: 'modules', changedCount: 3 },
      { section: 'composeSchedule', changedCount: 5 },
      { section: 'searchAssist', changedCount: 9 },
      { section: 'insight', changedCount: 2 },
      { section: 'aiDisplay', changedCount: 3 },
    ]);
    expect(prepared.next?.uiSettings).toEqual(fullCtx.uiSettings);
    expect(prepared.next?.composeSchedule).toEqual(fullCtx.composeSchedule);
    expect(prepared.next?.modules).toEqual(fullCtx.modules);
    expect(prepared.next?.searchAssist).toEqual(fullCtx.searchAssist);
    expect(prepared.next?.insight).toEqual(fullCtx.insight);
    expect(prepared.next?.aiDisplay).toEqual(fullCtx.aiDisplay);

    // 导入旧版 v1 备份时不应生成额外分区的写入载荷
    const v1Parsed = parsePersonalConfigDocument(JSON.stringify(document()));
    expect(v1Parsed.ok).toBe(true);
    if (!v1Parsed.ok) return;
    const v1Prepared = preparePersonalConfigImport(v1Parsed.document, fullCtx, 'merge');
    expect(v1Prepared.preview.sectionChanges).toEqual([]);
    expect(v1Prepared.next?.uiSettings).toBeUndefined();
    expect(v1Prepared.next?.modules).toBeUndefined();
    expect(v1Prepared.next?.composeSchedule).toBeUndefined();

    // 非法可选字段直接拒收
    expect(
      parsePersonalConfigDocument(
        JSON.stringify({ ...exported, uiSettings: { cleanUi: 'yes' } }),
      ),
    ).toEqual({ ok: false, error: 'invalid_payload' });
    expect(
      parsePersonalConfigDocument(
        JSON.stringify({ ...exported, modules: { hot: 1 } }),
      ),
    ).toEqual({ ok: false, error: 'invalid_payload' });
    expect(
      parsePersonalConfigDocument(
        JSON.stringify({ ...exported, aiDisplay: { mode: 'bad', scope: 'all', markFollowing: false } }),
      ),
    ).toEqual({ ok: false, error: 'invalid_payload' });
  });
});
