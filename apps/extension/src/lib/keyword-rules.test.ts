// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activeKeywordRules,
  addCustomKeywordRule,
  createKeywordHeuristics,
  getKeywordRuleSettings,
  isOfficialKeywordCategorySubscribed,
  OFFICIAL_KEYWORD_RULES,
  setOfficialKeywordCategorySubscribed,
  setOfficialKeywordRuleEnabled,
} from './keyword-rules';
import { BUNDLED_KEYWORD_PACK_CATALOG } from './keyword-packs';

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

describe('本地关键词规则', () => {
  it('默认启用的黄推引流词库会命中目标成人引流样本', async () => {
    const settings = await getKeywordRuleSettings();
    const rule = createKeywordHeuristics(settings).find(
      (candidate) => candidate.id === 'keyword:official:adult-fu-not-black',
    );
    expect(rule?.check({ handle: 'bait', text: '应该没人比我玩的开了吧 🤚 😊 我福不黑不信你看' })).toContain(
      '我福不黑',
    );
    expect(activeKeywordRules(settings)).toHaveLength(OFFICIAL_KEYWORD_RULES.length);
  });

  it('首次安装默认订阅全部官方词库，用户仍可按行业关闭', async () => {
    let settings = await getKeywordRuleSettings();
    expect(activeKeywordRules(settings)).toHaveLength(OFFICIAL_KEYWORD_RULES.length);
    expect(isOfficialKeywordCategorySubscribed(settings, 'adult_gray_traffic')).toBe(true);

    await setOfficialKeywordCategorySubscribed('scam_phishing', false);
    settings = await getKeywordRuleSettings();
    expect(isOfficialKeywordCategorySubscribed(settings, 'crypto_scam')).toBe(true);
    expect(isOfficialKeywordCategorySubscribed(settings, 'scam_phishing')).toBe(false);
    expect(activeKeywordRules(settings).some((rule) => rule.category === 'scam_phishing')).toBe(
      false,
    );
  });

  it('旧版订阅状态升级时统一迁移为全部开启', async () => {
    storage.keywordRulesV1 = {
      subscribedCategoryIds: ['adult_gray_traffic'],
      disabledOfficialRuleIds: [],
      customRules: [],
    };
    const settings = await getKeywordRuleSettings();
    expect(settings.subscribedCategoryIds).toHaveLength(
      BUNDLED_KEYWORD_PACK_CATALOG.packs.length,
    );
  });

  it('新版用户明确关闭全部词库后，空订阅不会被重新打开', async () => {
    storage.keywordRulesV1 = {
      subscriptionDefaultsVersion: 1,
      subscribedCategoryIds: [],
      disabledOfficialRuleIds: [],
      customRules: [],
    };
    const settings = await getKeywordRuleSettings();
    expect(settings.subscribedCategoryIds).toEqual([]);
    expect(activeKeywordRules(settings)).toHaveLength(0);
  });

  it('用户移除官方短语后立刻不再生成该规则，但可恢复', async () => {
    await setOfficialKeywordCategorySubscribed('adult_gray_traffic', true);
    await setOfficialKeywordRuleEnabled('adult-fu-not-black', false);
    let settings = await getKeywordRuleSettings();
    expect(createKeywordHeuristics(settings).some((rule) => rule.id.includes('adult-fu-not-black'))).toBe(false);

    await setOfficialKeywordRuleEnabled('adult-fu-not-black', true);
    settings = await getKeywordRuleSettings();
    expect(createKeywordHeuristics(settings).some((rule) => rule.id.includes('adult-fu-not-black'))).toBe(true);
  });

  it('用户可退订整个官方分类，再完整恢复订阅', async () => {
    await setOfficialKeywordCategorySubscribed('adult_gray_traffic', true);
    await setOfficialKeywordCategorySubscribed('adult_gray_traffic', false);
    let settings = await getKeywordRuleSettings();
    expect(activeKeywordRules(settings).some((rule) => rule.category === 'adult_gray_traffic')).toBe(false);

    await setOfficialKeywordCategorySubscribed('adult_gray_traffic', true);
    settings = await getKeywordRuleSettings();
    expect(activeKeywordRules(settings).filter((rule) => rule.category === 'adult_gray_traffic')).toHaveLength(
      OFFICIAL_KEYWORD_RULES.filter((rule) => rule.category === 'adult_gray_traffic').length,
    );
  });

  it('新增反诈话术命中完整短语，而不会把普通“内部群”讨论误标', async () => {
    await setOfficialKeywordCategorySubscribed('scam_phishing', true);
    const settings = await getKeywordRuleSettings();
    const rules = createKeywordHeuristics(settings);
    const insiderTip = rules.find((rule) => rule.id === 'keyword:official:scam-insider-tip');
    const principalHighInterest = rules.find((rule) => rule.id === 'keyword:official:scam-principal-high-interest');

    expect(insiderTip?.check({ handle: 'bait', text: '专家有内幕消息，保证高额返利' })).toContain('内幕消息');
    expect(principalHighInterest?.check({ handle: 'bait', text: '保本 高息，快来上车' })).toContain('保本高息');
    expect(rules.some((rule) => rule.check({ handle: 'team', text: '我们部门的内部群今晚开会' }))).toBe(false);
  });

  it('自定义词只做字面匹配，忽略 X 插入的空白', async () => {
    await addCustomKeywordRule('我的专属屏蔽词');
    const settings = await getKeywordRuleSettings();
    const rule = createKeywordHeuristics(settings).find((candidate) => candidate.id.startsWith('keyword:custom:'));
    expect(rule?.check({ handle: 'spam', text: '这是我的 专属 屏蔽词，请看简介' })).toContain('你设置的关键词');
    expect(rule?.check({ handle: 'normal', text: '这是普通讨论' })).toBeNull();
  });

  it('官方词同时匹配昵称和账号名，正文为空也能标记', async () => {
    const settings = await getKeywordRuleSettings();
    const rule = createKeywordHeuristics(settings).find(
      (candidate) => candidate.id === 'keyword:official:adult-local-door-hookup',
    );
    expect(rule?.check({ handle: 'nearby_date', displayName: '同城上门约炮', text: '' })).toContain(
      '同城上门约炮',
    );
  });
});
