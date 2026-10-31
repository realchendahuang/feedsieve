import { describe, expect, it } from 'vitest';
import { build, buildDetectorConfig, hydrateRuleSources, pinyinVariants } from './build-keyword-packs.mjs';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

/**
 * build-keyword-packs.mjs 是签名信任链的输入端（source.json → official.json →
 * manifest 签名）。这里锁定三个不变量：
 * 1. 当前提交的 source.json 永远能干净地 build 出合法目录（发布前置条件）；
 * 2. 规则形状校验拒绝畸形输入（发版门禁不能被脏数据绕过）；
 * 3. detector_config 只接受非负整数段。
 */

const validPack = (overrides = {}) => ({
  id: 'test_pack',
  name: { zh: '测试包', en: 'Test Pack' },
  description: { zh: '测试用', en: 'For tests' },
  source_refs: ['issue#1'],
  rules: [['test-pack-rule-1', '加微信']],
  ...overrides,
});

const validSource = (overrides = {}) => ({
  schema_version: 1,
  pack_version: '2026.09.13.1',
  generated_at: '2026-09-13T00:00:00Z',
  packs: [validPack()],
  ...overrides,
});

describe('build (pack catalog builder)', () => {
  it('当前提交的 source.json 可以无错构建，且产物与上次发布同源（防发布前才发现脏数据）', async () => {
    const sourcePath = new URL('../community/keyword-packs/source.json', import.meta.url);
    const source = await hydrateRuleSources(JSON.parse(await readFile(sourcePath, 'utf8')));
    const catalog = build(source);
    expect(catalog.schema_version).toBe(1);
    expect(catalog.packs.length).toBeGreaterThan(0);
    for (const pack of catalog.packs) {
      expect(pack.rules.length).toBeGreaterThan(0);
      for (const rule of pack.rules) {
        expect(rule.id).toMatch(/^[a-z][a-z0-9-]{2,95}$/);
        expect(rule.phrase.length).toBeGreaterThan(0);
        expect(rule.phrase.length).toBeLessThanOrEqual(80);
      }
    }
  });

  it('拒绝 schema_version / pack_version / packs 异常', () => {
    expect(() => build({ ...validSource(), schema_version: 2 })).toThrow();
    expect(() => build({ ...validSource(), pack_version: '2026-09-13' })).toThrow();
    expect(() => build({ ...validSource(), packs: [] })).toThrow();
  });

  it('拒绝重复 pack id 与重复 rule id（客户端按 id 去重，重复会让名单塌缩）', () => {
    expect(() =>
      build({ ...validSource(), packs: [validPack(), validPack()] }),
    ).toThrow(/duplicate pack id/);
    expect(() =>
      build(validSource({ packs: [validPack({ rules: [['dup-rule', 'a'], ['dup-rule', 'b']] })] })),
    ).toThrow(/duplicate or invalid rule id/);
  });

  it('拒绝首尾空白 / 超长 phrase 与畸形 id', () => {
    expect(() => build(validSource({ packs: [validPack({ rules: [['ok-rule', ' 加微信 ']] })] }))).toThrow();
    expect(() => build(validSource({ packs: [validPack({ rules: [['ok-rule', 'x'.repeat(81)]] })] }))).toThrow();
    expect(() => build(validSource({ packs: [validPack({ rules: [['Bad_ID', '加微信']] })] }))).toThrow();
  });

  it('source_refs 排序稳定（同内容不同顺序产出同一 sha256）', () => {
    const a = build(validSource({ packs: [validPack({ source_refs: ['b.yaml', 'a.yaml'] })] }));
    const b = build(validSource({ packs: [validPack({ source_refs: ['a.yaml', 'b.yaml'] })] }));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('pinyinVariants (拼音代字家族展开)', () => {
  it('含风险字的短语生成裸拼音/带调/leet 三形态变体，id 跨字连续编号', () => {
    const variants = pinyinVariants([['adult-gray-traffic-x', '骚货']]);
    expect(variants).toEqual([
      ['adult-gray-traffic-x-py1', 'sao货'],
      ['adult-gray-traffic-x-py2', 'sǎo货'],
      ['adult-gray-traffic-x-py3', 'sa0货'],
    ]);
  });

  it('多风险字短语逐字独立展开且 id 唯一；无风险字与 terms 规则不展开', () => {
    const two = pinyinVariants([['adult-gray-traffic-y', '约炮']]);
    // 炮（3 形态，含 o 产 leet）+ 约（2 形态，无 o 不产 leet），按替换表顺序连续编号
    expect(two).toEqual([
      ['adult-gray-traffic-y-py1', '约pao'],
      ['adult-gray-traffic-y-py2', '约pào'],
      ['adult-gray-traffic-y-py3', '约pa0'],
      ['adult-gray-traffic-y-py4', 'yue炮'],
      ['adult-gray-traffic-y-py5', 'yuē炮'],
    ]);
    expect(pinyinVariants([['adult-gray-traffic-z', 'Sao Paulo 旅行']])).toEqual([]);
    const terms = [{ id: 'adult-terms-local-door', phrase: '同城 + 上门', terms: ['同城', '上门'] }];
    expect(pinyinVariants(terms)).toEqual([]);
  });

  it('展开进 build() 后走同一套校验：当前 source.json 产物里变体 id 全部合法且唯一', async () => {
    const sourcePath = new URL('../community/keyword-packs/source.json', import.meta.url);
    const source = await hydrateRuleSources(JSON.parse(await readFile(sourcePath, 'utf8')));
    const catalog = build(source);
    const ids = catalog.packs.flatMap((p) => p.rules.map((r) => r.id));
    const variantIds = ids.filter((id) => /-py\d+$/.test(id));
    expect(variantIds.length).toBeGreaterThan(100);
    expect(new Set(ids).size).toBe(ids.length);
    // 骚货 的三形态变体在产物里（sao货 / sǎo货 / sa0货）
    for (const phrase of ['sao货', 'sǎo货', 'sa0货']) {
      expect(catalog.packs.some((p) => p.rules.some((r) => r.phrase === phrase))).toBe(true);
    }
  });
});

describe('buildDetectorConfig', () => {
  it('缺省返回 null（产物不带 detector_config 键）', () => {
    expect(buildDetectorConfig(validSource())).toBeNull();
    expect(build(validSource())).not.toHaveProperty('detector_config');
  });

  it('非负整数段原样透传', () => {
    const config = { gibberish: { min_len: 6, max_ratio_pct: 60 }, combos: { min_hits: 2 } };
    expect(buildDetectorConfig({ ...validSource(), detector_config: config })).toEqual(config);
    expect(build({ ...validSource(), detector_config: config }).detector_config).toEqual(config);
  });

  it('拒绝负数 / 非整数 / 非对象段（阈值必须是随包可签名分发的干净数据）', () => {
    const bad = (cfg) => () => buildDetectorConfig({ ...validSource(), detector_config: cfg });
    expect(bad({ gibberish: { min_len: -1 } })).toThrow();
    expect(bad({ gibberish: { min_len: 1.5 } })).toThrow();
    expect(bad({ gibberish: 'high' })).toThrow();
    expect(bad(null)).toThrow();
  });
});

describe('hydrateRuleSources', () => {
  it('无 rules_source 的包原样深拷贝返回（不吞已内联的 rules）', async () => {
    const source = validSource();
    const out = await hydrateRuleSources(source);
    expect(out).toEqual(source);
    expect(out).not.toBe(source);
  });

  it('rules_source 白名单外路径直接拒绝（路径穿越进不了发布链）', async () => {
    const source = validSource({ packs: [validPack({ rules_source: '../.secrets/key.json' })] });
    await expect(hydrateRuleSources(source)).rejects.toThrow();
  });

  it('合法 rules_source 展开为 sha256 派生 id 且与既有 phrase 去重', async () => {
    // fixture 文件放在 community/keyword-packs/ 下（脚本只允许该目录读 *.json）
    const fixtureName = '.test-hydrate-fixture.json';
    const fixturePath = new URL(`../community/keyword-packs/${fixtureName}`, import.meta.url);
    const { writeFile, rm } = await import('node:fs/promises');
    await writeFile(fixturePath, JSON.stringify(['加微信 ', '加微信', '  ', '看主页']));
    try {
      const source = validSource({
        packs: [
          validPack({
            id: 'hydrate_test',
            rules: [['hydrate-test-manual', '加微信']],
            rules_source: fixtureName,
          }),
        ],
      });
      const out = await hydrateRuleSources(source);
      const rules = out.packs[0].rules;
      // 「加微信 」trim 后与既有 rule 重复被去重；空白项被丢弃
      expect(rules.map((r) => r[1])).toEqual(['加微信', '看主页']);
      const derived = rules.find((r) => r[1] === '看主页');
      expect(derived[0]).toBe(
        `hydrate-test-${createHash('sha256').update('看主页').digest('hex').slice(0, 16)}`,
      );
    } finally {
      await rm(fixturePath);
    }
  });
});
