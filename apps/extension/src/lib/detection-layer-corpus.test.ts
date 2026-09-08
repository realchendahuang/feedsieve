// @vitest-environment happy-dom
/**
 * 检测管线分层金标（review 层 vs 批拉层）。
 *
 * detector 包的金标测试只覆盖底层规则命中；分层指标必须走完整管线
 * （detect → 增强 → classifyDetection），才能回答「这个命中进不进批量拉黑候选」。
 * runDetectionPipeline 是 content.ts 同款实现 —— 管线级回归 = 页面行为的可测代理。
 */
import { contentFingerprint, type DetectInput } from '@feedsieve/detector';
import { afterAll, describe, expect, it } from 'vitest';
import { runDetectionPipeline, type DetectionPipelineInput } from './detection-pipeline';
import { BUNDLED_KEYWORD_PACK_CATALOG } from './keyword-packs';
import type { RuntimeCommunity } from './community-store';
import type { CommunityEntry } from '@feedsieve/community-lists';

const ENTRY: CommunityEntry = {
  handle: 'inlist_user',
  x_user_id: null,
  aliases: [],
  category: 'bot_spam',
  sources: ['community'],
  community_score: 0.6,
  report_count: 3,
  rescue_count: 0,
  net_votes: 3,
  first_seen_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-02T00:00:00Z',
  evidence_post_ids: ['1800000000000000001'],
};

function fakeCommunity(overrides: Partial<RuntimeCommunity> = {}): RuntimeCommunity {
  return {
    index: {
      lookup: (handle: string) => (handle.toLowerCase() === 'inlist_user' ? ENTRY : null),
      version: 'test',
      size: 1,
    },
    handleSet: new Set(['inlist_user']),
    verifiedSet: new Set<string>(),
    whitelistSet: new Set<string>(),
    fingerprintSet: new Set<string>(),
    domainSet: new Set<string>(),
    campaignById: new Map(),
    campaignByFingerprint: new Map(),
    version: 'test',
    ...overrides,
  };
}

interface LayerCase {
  id: string;
  input: DetectionPipelineInput;
  expected: { presentation: 'block-candidate' | 'review' | 'ignore'; source?: string; reason?: string };
}

const keywordRule = {
  id: 'keyword:test:giveaway',
  check: (input: DetectInput) =>
    /giveaway/i.test(input.text ?? '') ? 'crypto giveaway phrase' : null,
};

const cases: LayerCase[] = [
  {
    id: '社区白名单（verified）→ ignore（一票豁免，先于一切识别；深度档也不标）',
    input: {
      input: { handle: 'verified_handle', text: 'dm me for crypto signals 福利在主页' },
      community: fakeCommunity({ verifiedSet: new Set(['verified_handle']) }),
      builtinList: new Set(['verified_handle']),
      keywordHeuristics: [keywordRule],
      catalog: BUNDLED_KEYWORD_PACK_CATALOG,
      strength: 'deep_clean',
      uiLanguage: 'zh',
    },
    expected: { presentation: 'ignore' },
  },
  {
    id: '公开白名单（whitelist）→ ignore（维护者一票豁免，优先级最高）',
    input: {
      input: { handle: 'maintainer_vouched', text: 'dm me for crypto signals 福利在主页' },
      community: fakeCommunity({ whitelistSet: new Set(['maintainer_vouched']) }),
      builtinList: new Set(['maintainer_vouched']),
      keywordHeuristics: [keywordRule],
      catalog: BUNDLED_KEYWORD_PACK_CATALOG,
      strength: 'deep_clean',
      uiLanguage: 'zh',
    },
    expected: { presentation: 'ignore' },
  },
  {
    id: 'community-list → block-candidate（可批量）',
    input: {
      input: { handle: 'inlist_user', text: '清洗管道' },
      community: fakeCommunity(),
      builtinList: new Set(),
      keywordHeuristics: [keywordRule],
      catalog: BUNDLED_KEYWORD_PACK_CATALOG,
      strength: 'standard',
      uiLanguage: 'zh',
    },
    expected: { presentation: 'block-candidate', source: 'community-list' },
  },
  {
    id: 'builtin-list → block-candidate',
    input: {
      input: { handle: 'archived_spam', text: '清洗管道' },
      community: fakeCommunity(),
      builtinList: new Set(['archived_spam']),
      keywordHeuristics: [keywordRule],
      catalog: BUNDLED_KEYWORD_PACK_CATALOG,
      strength: 'standard',
      uiLanguage: 'zh',
    },
    expected: { presentation: 'block-candidate', source: 'builtin-list' },
  },
  {
    id: '关键词命中 → review（只进人工确认，不进批量）',
    input: {
      input: { handle: 'kw_hit', text: '500 usdt giveaway' },
      community: fakeCommunity(),
      builtinList: new Set(),
      keywordHeuristics: [keywordRule],
      catalog: BUNDLED_KEYWORD_PACK_CATALOG,
      strength: 'standard',
      uiLanguage: 'zh',
    },
    expected: { presentation: 'review', source: 'heuristic' },
  },
  {
    id: '指纹命中 · 标准档 → ignore（间接证据，仅大扫除档给 review）',
    input: {
      input: { handle: 'fp_user_1', text: '同一话术模板的第 1 号账号' },
      community: fakeCommunity({
        fingerprintSet: new Set([
          contentFingerprint({ text: '同一话术模板的第 1 号账号' }) ?? '',
        ]),
      }),
      builtinList: new Set(),
      keywordHeuristics: [keywordRule],
      catalog: BUNDLED_KEYWORD_PACK_CATALOG,
      strength: 'standard',
      uiLanguage: 'zh',
    },
    expected: { presentation: 'ignore' },
  },
  {
    id: '指纹命中 · 大扫除档 → review（间接证据可人工复核）',
    input: {
      input: { handle: 'fp_user_2', text: '同一话术模板的第 2 号账号' },
      community: fakeCommunity({
        fingerprintSet: new Set([
          contentFingerprint({ text: '同一话术模板的第 2 号账号' }) ?? '',
        ]),
      }),
      builtinList: new Set(),
      keywordHeuristics: [keywordRule],
      catalog: BUNDLED_KEYWORD_PACK_CATALOG,
      strength: 'deep_clean',
      uiLanguage: 'zh',
    },
    expected: { presentation: 'review', source: 'fingerprint' },
  },
  {
    id: '域名命中 · 标准档 → ignore；大扫除档 → review',
    input: {
      input: {
        handle: 'dm_user',
        links: [{ href: 'https://myfreecrypto.example', hostname: 'myfreecrypto.example' }],
      },
      community: fakeCommunity({ domainSet: new Set(['myfreecrypto.example']) }),
      builtinList: new Set(),
      keywordHeuristics: [keywordRule],
      catalog: BUNDLED_KEYWORD_PACK_CATALOG,
      strength: 'standard',
      uiLanguage: 'zh',
    },
    expected: { presentation: 'ignore' },
  },
  {
    id: '干净账号 → ignore（无标注）',
    input: {
      input: { handle: 'normal_user', text: '今天天气不错' },
      community: fakeCommunity(),
      builtinList: new Set(['archived_spam']),
      keywordHeuristics: [keywordRule],
      catalog: BUNDLED_KEYWORD_PACK_CATALOG,
      strength: 'deep_clean',
      uiLanguage: 'zh',
    },
    expected: { presentation: 'ignore' },
  },
];

const counts = { batch: 0, review: 0, ignore: 0 };

describe('检测管线分层金标', () => {
  it.each(cases)('$id', (c) => {
    const result = runDetectionPipeline(c.input);
    counts[result.presentation === 'block-candidate' ? 'batch' : result.presentation === 'review' ? 'review' : 'ignore'] += 1;
    expect(result.presentation, c.id).toBe(c.expected.presentation);
    if (c.expected.source) {
      expect(result.detection?.source).toBe(c.expected.source);
    }
  });

  it('社区名单命中带可解释理由（票数 + 分类）', () => {
    const result = runDetectionPipeline({
      input: { handle: 'inlist_user', text: '清洗管道' },
      community: fakeCommunity(),
      builtinList: new Set(),
      keywordHeuristics: [keywordRule],
      catalog: BUNDLED_KEYWORD_PACK_CATALOG,
      strength: 'standard',
      uiLanguage: 'zh',
    });
    expect(result.detection?.reason).toContain('3 人标记');
    expect(result.communityEntry?.handle).toBe('inlist_user');
    expect(result.category).toBe('bot_spam');
  });
});

afterAll(() => {
  console.log(
    `[layer-corpus] batch=${counts.batch} review=${counts.review} ignore=${counts.ignore}（共 ${cases.length} 例）`,
  );
});