// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activeKeywordRules,
  addCustomKeywordRule,
  createKeywordHeuristics,
  DEFAULT_KEYWORD_RULE_SETTINGS,
  getKeywordRuleSettings,
  isValidPhrase,
  isOfficialKeywordCategorySubscribed,
  setOfficialKeywordCategorySubscribed,
  setOfficialKeywordRuleEnabled,
  type KeywordRuleSettings,
} from './keyword-rules';
import { BUNDLED_KEYWORD_PACK_CATALOG, type KeywordPackCatalog } from './keyword-packs';

/** 全量官方规则数（从随包目录直接算，测试里 Node 态已同步装入） */
const OFFICIAL_RULE_COUNT = BUNDLED_KEYWORD_PACK_CATALOG.packs.reduce(
  (count, pack) => count + pack.rules.length,
  0,
) as number;
const ADULT_OFFICIAL_RULE_COUNT = (BUNDLED_KEYWORD_PACK_CATALOG.packs.find(
  (pack) => pack.id === 'adult_gray_traffic',
)?.rules.length ?? 0) as number;

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
      (candidate) => candidate.id === 'keyword:official:adult-profile-collect-benefits',
    );
    expect(
      rule?.check({ handle: 'bait', text: '应该没人比我玩的开了吧 🤚 😊 主页自取福利' }),
    ).toContain('主页自取福利');
    expect(activeKeywordRules(settings)).toHaveLength(OFFICIAL_RULE_COUNT);
  });

  it('首次安装默认订阅黄推 + crypto 假抽奖两个默认包，旧分类是宽容空操作', async () => {
    let settings = await getKeywordRuleSettings();
    expect(isOfficialKeywordCategorySubscribed(settings, 'adult_gray_traffic')).toBe(true);
    expect(isOfficialKeywordCategorySubscribed(settings, 'crypto_giveaway_scams')).toBe(true);
    expect(isOfficialKeywordCategorySubscribed(settings, 'crypto_scam')).toBe(false);
    expect(activeKeywordRules(settings)).toHaveLength(OFFICIAL_RULE_COUNT);

    // 2026-09-11 起词库只保留黄推包；老版本备份把 crypto_scam 标成订阅时，
    // 该分类没有任何官方规则，不产出条目也不报错（迁移兼容面）
    await setOfficialKeywordCategorySubscribed('crypto_scam', true);
    settings = await getKeywordRuleSettings();
    expect(activeKeywordRules(settings).some((rule) => rule.category === 'crypto_scam')).toBe(
      false,
    );
  });

  it('旧版订阅状态升级时迁移为默认订阅（v4 起含 crypto 假抽奖包）', async () => {
    storage.keywordRulesV1 = {
      subscribedCategoryIds: ['adult_gray_traffic', 'crypto_scam'],
      disabledOfficialRuleIds: [],
      customRules: [],
    };
    const settings = await getKeywordRuleSettings();
    // 无迁移标记的存量（v0.7.6 前）一律套最新默认；crypto_scam 不在词库被滤掉
    expect(settings.subscribedCategoryIds).toEqual(['adult_gray_traffic', 'crypto_giveaway_scams']);
  });

  it('v3 存量升级：保留明确订阅并合并 crypto 新默认包（v0.7.6 语义不变）', async () => {
    storage.keywordRulesV1 = {
      subscriptionDefaultsVersion: 3,
      subscribedCategoryIds: ['adult_gray_traffic'],
      disabledOfficialRuleIds: [],
      customRules: [],
    };
    const settings = await getKeywordRuleSettings();
    expect(settings.subscribedCategoryIds).toEqual(['adult_gray_traffic', 'crypto_giveaway_scams']);
  });

  it('新版用户明确关闭全部词库后，空订阅不会被重新打开', async () => {
    storage.keywordRulesV1 = {
      subscriptionDefaultsVersion: 3,
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
    await setOfficialKeywordRuleEnabled('adult-profile-collect-benefits', false);
    let settings = await getKeywordRuleSettings();
    expect(
      createKeywordHeuristics(settings).some((rule) => rule.id.includes('adult-profile-collect-benefits')),
    ).toBe(false);

    await setOfficialKeywordRuleEnabled('adult-profile-collect-benefits', true);
    settings = await getKeywordRuleSettings();
    expect(
      createKeywordHeuristics(settings).some((rule) => rule.id.includes('adult-profile-collect-benefits')),
    ).toBe(true);
  });

  it('用户可退订整个官方分类，再完整恢复订阅', async () => {
    await setOfficialKeywordCategorySubscribed('adult_gray_traffic', true);
    await setOfficialKeywordCategorySubscribed('adult_gray_traffic', false);
    let settings = await getKeywordRuleSettings();
    expect(
      activeKeywordRules(settings).some((rule) => rule.category === 'adult_gray_traffic'),
    ).toBe(false);

    await setOfficialKeywordCategorySubscribed('adult_gray_traffic', true);
    settings = await getKeywordRuleSettings();
    expect(
      activeKeywordRules(settings).filter((rule) => rule.category === 'adult_gray_traffic'),
    ).toHaveLength(ADULT_OFFICIAL_RULE_COUNT);
  });

  it('分词组合规则命中完整短语，而不会把普通“内部群”讨论误标', async () => {
    const settings = await getKeywordRuleSettings();
    if (!isOfficialKeywordCategorySubscribed(settings, 'adult_gray_traffic')) {
      await setOfficialKeywordCategorySubscribed('adult_gray_traffic', true);
    }
    const rules = createKeywordHeuristics(await getKeywordRuleSettings());
    // 成人包的分词组合示例（同城 + 上门），替代已移除的反诈包规则
    const comboRule = rules.find((rule) => rule.id === 'keyword:official:adult-terms-local-door');

    expect(
      comboRule?.check({ handle: 'bait', text: '同城有派对，秒到车上即可安排上门' }),
    ).toContain('同城');
    // 分词顺序/gap 之外：正常生活讨论既不命中该组合，也不命中其它官方规则
    expect(
      rules.some((rule) => rule.check({ handle: 'team', text: '我们部门的内部群今晚开会' })),
    ).toBe(false);
  });

  it('自定义词只做字面匹配，忽略 X 插入的空白', async () => {
    await addCustomKeywordRule('我的专属屏蔽词');
    const settings = await getKeywordRuleSettings();
    const rule = createKeywordHeuristics(settings).find((candidate) =>
      candidate.id.startsWith('keyword:custom:'),
    );
    expect(rule?.check({ handle: 'spam', text: '这是我的 专属 屏蔽词，请看简介' })).toContain(
      '命中你的关键词',
    );
    expect(rule?.check({ handle: 'normal', text: '这是普通讨论' })).toBeNull();
  });

  it('拒绝归一化后为空的纯标点/符号自定义词，避免所有文本都被误标', () => {
    expect(isValidPhrase('...')).toBe(false);
    expect(isValidPhrase('🔥')).toBe(false);
    expect(isValidPhrase('同城🔥')).toBe(true);
  });

  it('批量索引保留重叠短语，不会因较短词先出现而漏掉较长规则', () => {
    const settings: KeywordRuleSettings = {
      ...DEFAULT_KEYWORD_RULE_SETTINGS,
      subscribedCategoryIds: [],
      customRules: [
        { id: 'short', phrase: '同城上门', createdAt: 1 },
        { id: 'long', phrase: '同城上门可约', createdAt: 2 },
      ],
    };
    const rules = createKeywordHeuristics(settings);
    const input = { handle: 'bait', text: '今晚同城上门可约' };
    expect(rules[0]?.check(input)).toContain('同城上门');
    expect(rules[1]?.check(input)).toContain('同城上门可约');
  });

  it('英文短语按整词命中：bio 里的 Adulthood 不误标 adult，正文广告仍命中（issue #4）', () => {
    // 「adult」已在 2026-11-08 第二批词库收敛中下线：改用合成词库锁定整词匹配语义，
    // 不再让回归用例依赖真实词库的收录内容（issue #4 的真实样本仍原样保留）。
    const catalog: KeywordPackCatalog = {
      schema_version: 1,
      pack_version: '2026.11.08.1',
      generated_at: null,
      packs: [
        {
          id: 'adult_gray_traffic',
          name: { zh: '黄推 / 成人引流', en: 'Adult bait' },
          description: { zh: '测试词库', en: 'test pack' },
          source_refs: [],
          rules: [{ id: 'test-adult', phrase: 'adult', name: { zh: 'adult', en: 'adult' } }],
        },
      ],
    };
    const settings: KeywordRuleSettings = {
      ...DEFAULT_KEYWORD_RULE_SETTINGS,
      subscribedCategoryIds: ['adult_gray_traffic'],
    };
    const rule = createKeywordHeuristics(settings, catalog).find(
      (candidate) => candidate.id === 'keyword:official:test-adult',
    );
    expect(rule).toBeDefined();
    // @MarcosBL 的真实 bio：Adulthood 含 adult 子串但语义无关
    expect(
      rule?.check({
        handle: 'MarcosBL',
        displayName: 'Marcos Besteiro',
        text: 'Lo bueno de comprar un coche Chino es que todos los repuestos son originales',
        bio: "Adulthood is saying 'after this week things will slow down a bit' over and over",
      }),
    ).toBeNull();
    expect(rule?.check({ handle: 'bait', text: 'hot amateur adult content daily' })).toContain(
      '命中官方规则：adult',
    );
  });

  it('官方短词命中简介不再标黄，正文命中仍保留；长短语和自定义词不受限', () => {
    // 2026-11-08 线上误标：「自拍」这类 2 字官方词出现在简介的自我描述里被大量点误标。
    // 用合成词库测试，避免测试依赖真实词库的收录内容。
    const catalog: KeywordPackCatalog = {
      schema_version: 1,
      pack_version: '2026.11.08.1',
      generated_at: null,
      packs: [
        {
          id: 'adult_gray_traffic',
          name: { zh: '黄推 / 成人引流', en: 'Adult bait' },
          description: { zh: '测试词库', en: 'test pack' },
          source_refs: [],
          rules: [
            { id: 'test-short', phrase: '自拍', name: { zh: '自拍', en: '自拍' } },
            {
              id: 'test-long',
              phrase: '主页自取福利',
              name: { zh: '主页自取福利', en: '主页自取福利' },
            },
          ],
        },
      ],
    };
    const settings: KeywordRuleSettings = {
      ...DEFAULT_KEYWORD_RULE_SETTINGS,
      subscribedCategoryIds: ['adult_gray_traffic'],
      disabledOfficialRuleIds: [],
      customRules: [{ id: 'custom-selfie', phrase: '自拍', createdAt: 1 }],
    };
    const rules = createKeywordHeuristics(settings, catalog);
    const short = rules.find((rule) => rule.id === 'keyword:official:test-short');
    const long = rules.find((rule) => rule.id === 'keyword:official:test-long');
    const custom = rules.find((rule) => rule.id.startsWith('keyword:custom:'));

    // 简介里的短词是普通自我描述：不标
    expect(short?.check({ handle: 'ball2baby', bio: '喜歡自拍，記錄生活' })).toBeNull();
    // 正文命中同一短词：保留提示，并透出字段
    expect(short?.check({ handle: 'bait', text: '今晚发点自拍' })).toContain('自拍 · 正文');
    // 更长的短语在简介里仍可命中（成句话术的误伤面小）
    expect(long?.check({ handle: 'bait', bio: '主页自取福利，懂的都懂' })).toContain('· 简介');
    // 自定义词是用户自己的选择，简介命中照常显示
    expect(custom?.check({ handle: 'spam', bio: '喜欢自拍' })).toContain('命中你的关键词');
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

  it('有序分词规则允许插字、标点和表情，但不接受倒序或缺词', async () => {
    const settings = await getKeywordRuleSettings();
    const rule = createKeywordHeuristics(settings).find(
      (candidate) => candidate.id === 'keyword:official:adult-terms-local-door',
    );
    expect(rule?.check({ handle: 'bait', text: '同城今天可以安排上门' })).toContain('同城 + 上门');
    expect(rule?.check({ handle: 'bait', text: '同·城🔥可上门' })).toContain('同城 + 上门');
    expect(rule?.check({ handle: 'bait', text: '同城上跟上门' })).toContain('同城 + 上门');
    expect(rule?.check({ handle: 'bait', text: `同城${'甲'.repeat(13)}同城上门` })).toContain(
      '同城 + 上门',
    );
    expect(rule?.check({ handle: 'normal', text: '上门服务就在同城' })).toBeNull();
    expect(rule?.check({ handle: 'normal', text: '同城生活资讯' })).toBeNull();
  });

  it('精确短语也会忽略用于规避的标点、符号和空格', async () => {
    const settings = await getKeywordRuleSettings();
    const rule = createKeywordHeuristics(settings).find(
      (candidate) => candidate.id === 'keyword:official:adult-profile-collect-benefits',
    );
    expect(rule?.check({ handle: 'bait', text: '主·页 🔥 自 取 福 利' })).toContain('主页自取福利');
  });

  it('字间拆入不可见格式字符（U+2060 词连接符等）仍命中（真机样本）', async () => {
    const settings = await getKeywordRuleSettings();
    const rule = createKeywordHeuristics(settings).find(
      (candidate) => candidate.id === 'keyword:official:adult-profile-collect-benefits',
    );
    expect(rule).toBeDefined();
    const sample = [
      '应没没人比我玩的开了吧🍀🙉',
      '主\u2060\u200C\u200D页\u200C\u2060自\u2060取\u200D福利',
    ].join('');
    expect(rule?.check({ handle: 'bait', text: sample })).toContain('主页自取福利');
  });

  it('变体矩阵：不可见附加符/填充符/繁体/部首/同形异源字均可命中', async () => {
    const settings = await getKeywordRuleSettings();
    const heuristics = createKeywordHeuristics(settings);
    const benefitRule = heuristics.find(
      (candidate) => candidate.id === 'keyword:official:adult-profile-collect-benefits',
    );
    const cityRule = heuristics.find((candidate) =>
      candidate.id.includes('adult-terms-local-door'),
    );

    // Zalgo 组合附加符（Mn 类，NFKC 消不掉）
    expect(benefitRule?.check({ handle: 'bait', text: '主\u0301\u0316页自取福利' })).toContain(
      '主页自取福利',
    );
    // 韩文填充符（U+3164/115F/1160，Lo 类空白）
    expect(benefitRule?.check({ handle: 'bait', text: '主\u3164页\u115F自取福利' })).toContain(
      '主页自取福利',
    );
    // 繁体写法：官方简体词条要能在繁体样本上命中（opencc 映射）
    expect(
      benefitRule?.check({ handle: 'bait', text: '同城裏面誰都不信，快看我主頁自取福利' }),
    ).toContain('主页自取福利');
    expect(cityRule?.check({ handle: 'bait', text: '同城上門服務' })).toContain('同城 + 上门');
    // CJK 补充部首替字（⻔→门 等，CJKRadicals.txt 映射）
    expect(cityRule?.check({ handle: 'bait', text: '同城上\u2ED4服務' })).toContain('同城 + 上门');
    // 同形异源字（confusables 映射：西里尔 х→x）。「adult」已下线，改用仍在线的
    // xiao77 锁定同一条归一化路径，避免测试绑定已删词条。
    const siteRule = heuristics.find(
      (candidate) => candidate.id === 'keyword:official:adult-gray-traffic-58c2e555821225d3',
    );
    expect(siteRule?.check({ handle: 'bait', text: '\u0445iao77 看过来' })).toContain('xiao77');
  });
});
