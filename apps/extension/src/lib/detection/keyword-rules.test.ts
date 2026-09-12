// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activeKeywordRules,
  addCustomKeywordRule,
  createKeywordHeuristics,
  getKeywordRuleSettings,
  isOfficialKeywordCategorySubscribed,
  setOfficialKeywordCategorySubscribed,
  setOfficialKeywordRuleEnabled,
} from './keyword-rules';
import { BUNDLED_KEYWORD_PACK_CATALOG } from './keyword-packs';

/** 全量官方规则数（从随包目录直接算，测试里 Node 态已同步装入） */
const OFFICIAL_RULE_COUNT = BUNDLED_KEYWORD_PACK_CATALOG.packs.reduce(
  (count, pack) => count + pack.rules.length,
  0,
) as number;
const ADULT_OFFICIAL_RULE_COUNT = (BUNDLED_KEYWORD_PACK_CATALOG.packs
  .find((pack) => pack.id === 'adult_gray_traffic')
  ?.rules.length ?? 0) as number;

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
    expect(
      rule?.check({ handle: 'bait', text: '应该没人比我玩的开了吧 🤚 😊 我福不黑不信你看' }),
    ).toContain('我福不黑');
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
    expect(settings.subscribedCategoryIds).toEqual([
      'adult_gray_traffic',
      'crypto_giveaway_scams',
    ]);
  });

  it('v3 存量升级：保留明确订阅并合并 crypto 新默认包（v0.7.6 语义不变）', async () => {
    storage.keywordRulesV1 = {
      subscriptionDefaultsVersion: 3,
      subscribedCategoryIds: ['adult_gray_traffic'],
      disabledOfficialRuleIds: [],
      customRules: [],
    };
    const settings = await getKeywordRuleSettings();
    expect(settings.subscribedCategoryIds).toEqual([
      'adult_gray_traffic',
      'crypto_giveaway_scams',
    ]);
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
    await setOfficialKeywordRuleEnabled('adult-fu-not-black', false);
    let settings = await getKeywordRuleSettings();
    expect(
      createKeywordHeuristics(settings).some((rule) => rule.id.includes('adult-fu-not-black')),
    ).toBe(false);

    await setOfficialKeywordRuleEnabled('adult-fu-not-black', true);
    settings = await getKeywordRuleSettings();
    expect(
      createKeywordHeuristics(settings).some((rule) => rule.id.includes('adult-fu-not-black')),
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
    ).toHaveLength(
      ADULT_OFFICIAL_RULE_COUNT,
    );
  });

  it('分词组合规则命中完整短语，而不会把普通“内部群”讨论误标', async () => {
    const settings = await getKeywordRuleSettings();
    if (!isOfficialKeywordCategorySubscribed(settings, 'adult_gray_traffic')) {
      await setOfficialKeywordCategorySubscribed('adult_gray_traffic', true);
    }
    const rules = createKeywordHeuristics(await getKeywordRuleSettings());
    // 成人包的分词组合示例（同城 + 上门），替代已移除的反诈包规则
    const comboRule = rules.find((rule) => rule.id === 'keyword:official:adult-terms-local-door');

    expect(comboRule?.check({ handle: 'bait', text: '同城有派对，秒到车上即可安排上门' })).toContain(
      '同城',
    );
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

  it('英文短语按整词命中：bio 里的 Adulthood 不误标 adult，正文广告仍命中（issue #4）', async () => {
    const settings = await getKeywordRuleSettings();
    const rule = createKeywordHeuristics(settings).find(
      (candidate) => candidate.id === 'keyword:official:adult-gray-traffic-7fdc3e8038e87ff5',
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
    expect(rule?.check({ handle: 'normal', text: '上门服务就在同城' })).toBeNull();
    expect(rule?.check({ handle: 'normal', text: '同城生活资讯' })).toBeNull();
  });

  it('精确短语也会忽略用于规避的标点、符号和空格', async () => {
    const settings = await getKeywordRuleSettings();
    const rule = createKeywordHeuristics(settings).find(
      (candidate) => candidate.id === 'keyword:official:adult-fu-not-black',
    );
    expect(rule?.check({ handle: 'bait', text: '我·福 🔥 不 黑，不信你看' })).toContain('我福不黑');
  });

  it('字间拆入不可见格式字符（U+2060 词连接符等）仍命中（真机样本）', async () => {
    const settings = await getKeywordRuleSettings();
    const rule = createKeywordHeuristics(settings).find(
      (candidate) => candidate.id === 'keyword:official:adult-fu-not-black',
    );
    expect(rule).toBeDefined();
    const sample = [
      '应没没人比我玩的开了吧🍀🙉',
      '我\u2060\u200C\u200D福\u200C\u2060不\u2060黑\u200D不信\u200C你看',
    ].join('');
    expect(rule?.check({ handle: 'bait', text: sample })).toContain('我福不黑');
  });

  it('变体矩阵：不可见附加符/填充符/繁体/部首/同形异源字均可命中', async () => {
    const settings = await getKeywordRuleSettings();
    const heuristics = createKeywordHeuristics(settings);
    const fuRule = heuristics.find(
      (candidate) => candidate.id === 'keyword:official:adult-fu-not-black',
    );
    const cityRule = heuristics.find((candidate) => candidate.id.includes('adult-terms-local-door'));

    // Zalgo 组合附加符（Mn 类，NFKC 消不掉）
    expect(fuRule?.check({ handle: 'bait', text: '我\u0301\u0316福不黑不信你看' })).toContain(
      '我福不黑',
    );
    // 韩文填充符（U+3164/115F/1160，Lo 类空白）
    expect(fuRule?.check({ handle: 'bait', text: '我\u3164福\u115F不黑不信你看' })).toContain(
      '我福不黑',
    );
    // 繁体写法：官方简体词条要能在繁体样本上命中（opencc 映射）
    expect(fuRule?.check({ handle: 'bait', text: '同城裏面誰都不信，快看我福不黑不信你看' })).toContain(
      '我福不黑',
    );
    expect(cityRule?.check({ handle: 'bait', text: '同城上門服務' })).toContain('同城 + 上门');
    // CJK 补充部首替字（⻔→门 等，CJKRadicals.txt 映射）
    expect(cityRule?.check({ handle: 'bait', text: '同城上\u2ED4服務' })).toContain('同城 + 上门');
    // 同形异源字（confusables 映射：西里尔 а）
    const adultRule = heuristics.find(
      (candidate) => candidate.id === 'keyword:official:adult-gray-traffic-7fdc3e8038e87ff5',
    );
    expect(adultRule?.check({ handle: 'bait', text: '\u0430dult 看过来' })).toContain('adult');
  });
});
