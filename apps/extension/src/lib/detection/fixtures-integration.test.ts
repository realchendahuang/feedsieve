// @vitest-environment happy-dom
// fixtures/x 脱敏样本 → 生产检测管线联动：
// 必须走 runDetectionPipeline（生产装配 = keyword 词库 + weakSignalCombo），
// 不能直接调 detect 走 DEFAULT_HEURISTICS——那会让集成测试在一个
// 生产页面上根本不运行的规则集上给出假信心（2026-09-12 修复）。
// bio 由 XHR 桥注入 DOM 之外，fixtures 里用显式 bio 表模拟该通道。
import { describe, expect, it } from 'vitest';
import { extractFeedItem } from '@feedsieve/x-adapter';
import { HOME_TIMELINE_HTML } from '../../../../../fixtures/x/timeline/home-timeline';
import { SEARCH_F_LIVE_HTML } from '../../../../../fixtures/x/timeline/search-f-live';
import { PROFILE_TIMELINE_HTML } from '../../../../../fixtures/x/profile/profile';
import { THREAD_HTML } from '../../../../../fixtures/x/replies/thread';
import { runDetectionPipeline } from './detection-pipeline';
import {
  BUNDLED_KEYWORD_PACK_CATALOG,
  type KeywordPackCatalog,
} from './keyword-packs';
import { createKeywordHeuristics, DEFAULT_KEYWORD_RULE_SETTINGS } from './keyword-rules';

const keywordHeuristics = createKeywordHeuristics(DEFAULT_KEYWORD_RULE_SETTINGS);

function runPipeline(input: {
  handle: string;
  displayName?: string;
  text?: string;
  bio?: string;
  links?: Array<{ href: string }>;
}) {
  return runDetectionPipeline({
    input,
    community: null,
    builtinList: new Set(),
    keywordHeuristics,
    catalog: BUNDLED_KEYWORD_PACK_CATALOG as KeywordPackCatalog,
    strength: 'standard',
    uiLanguage: 'zh',
  });
}

function scanFixture(html: string, bios: Map<string, string> = new Map()) {
  document.body.innerHTML = html;
  const articles = [...document.querySelectorAll('article[data-testid="tweet"]')];
  return articles.map((article) => {
    const item = extractFeedItem(article);
    const handle = item?.author.handle ?? '';
    const result = runPipeline({
      handle,
      displayName: item?.author.displayName,
      text: item?.text ?? '',
      bio: bios.get(handle.toLowerCase()),
      links: item?.links ?? [],
    });
    return { handle, item, result };
  });
}

describe('fixtures/x 生产管线联动（runDetectionPipeline）', () => {
  it('home-timeline: 保持干净样本干净；垃圾样本的命中必须显式钉住生产路径', () => {
    const results = scanFixture(HOME_TIMELINE_HTML);

    expect(results[0]?.result.detection).toBeNull(); // normaluser：干净
    // 生产装配下不再运行 templated-text（crypto 词包 2026-09-11 移除后，giveaway
    // 话术需要词库或未来恢复行业包），这里只断言「不产生 Ignore 层之外的动作」，
    // 并把 clean/脏样本集合钉死为一个回归快照。
    expect(
      results.map((r) => ({
        handle: r.handle,
        ruleId: r.result.detection?.ruleId ?? null,
        presentation: r.result.presentation,
      })),
    ).toMatchInlineSnapshot(`
      [
        {
          "handle": "normaluser",
          "presentation": "ignore",
          "ruleId": null,
        },
        {
          "handle": "spamking88",
          "presentation": "review",
          "ruleId": "keyword:official:crypto-scam-usdt-giveaway",
        },
        {
          "handle": "cndon91",
          "presentation": "review",
          "ruleId": "keyword:official:adult-fu-not-black",
        },
      ]
    `);
  });

  it('search-f-live: 干净样本干净；垃圾样本命中随词库变化（快照钉住）', () => {
    const results = scanFixture(SEARCH_F_LIVE_HTML);
    expect(
      results.map((r) => ({
        handle: r.handle,
        ruleId: r.result.detection?.ruleId ?? null,
        presentation: r.result.presentation,
      })),
    ).toMatchInlineSnapshot(`
      [
        {
          "handle": "trxminer07",
          "presentation": "review",
          "ruleId": "keyword:official:crypto-scam-giweaway",
        },
        {
          "handle": "reallife42",
          "presentation": "ignore",
          "ruleId": null,
        },
      ]
    `);
  });

  it('profile: 全干净账号在标准档零标注（生产档位下 pinned 普通内容不标）', () => {
    const results = scanFixture(PROFILE_TIMELINE_HTML);
    for (const r of results) {
      expect(r.result.detection).toBeNull();
      expect(r.result.presentation).toBe('ignore');
    }
  });

  it('thread: 回复流普通账号不标注，站内 @mention 不被当成外链', () => {
    const results = scanFixture(THREAD_HTML);
    for (const r of results) {
      expect(r.result.detection).toBeNull();
    }
  });

  it('bio 通道：bio 埋官方词库短语时命中（DOM 无法提供 bio，XHR 桥独有路径）', () => {
    const bios = new Map([['pinnedauthor', '我福不黑不信你看']]);
    const results = scanFixture(PROFILE_TIMELINE_HTML, bios);
    const hit = results.filter((r) => r.result.detection !== null);
    expect(hit.length).toBeGreaterThan(0);
    for (const r of hit) {
      expect(r.result.detection?.source).toBe('heuristic');
      expect(r.result.detection?.ruleId).toMatch(/^keyword:official:/);
    }
  });

  it('白名单一票豁免在生产管线最前：即使词库命中也放行', () => {
    const result = runPipeline({
      handle: 'pinnedauthor',
      bio: '我福不黑不信你看',
    });
    // 未接 community 时无豁免；接上后必须豁免——锁生产顺序
    // 未接 community 时无豁免；接上后必须豁免——锁生产顺序
    const community = {
      index: {
        version: 'test',
        size: 0,
        lookup: () => null,
      },
      handleSet: new Set<string>(),
      whitelistSet: new Set(['pinnedauthor']),
      verifiedSet: new Set<string>(),
      fingerprintSet: new Set<string>(),
      domainSet: new Set<string>(),
      campaignById: new Map(),
      campaignByFingerprint: new Map<string, string>(),
      version: 'test',
    };
    const exempt = runDetectionPipeline({
      input: { handle: 'pinnedauthor', bio: '我福不黑不信你看' },
      community,
      builtinList: new Set(),
      keywordHeuristics,
      catalog: BUNDLED_KEYWORD_PACK_CATALOG as KeywordPackCatalog,
      strength: 'standard',
      uiLanguage: 'zh',
    });
    expect(exempt.detection).toBeNull();
    expect(exempt.presentation).toBe('ignore');
    expect(result.detection).not.toBeNull();
  });
});
