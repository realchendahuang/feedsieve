import { describe, expect, it } from 'vitest';
import { entryFacets, ruleTimeline, topRules } from './analyze-detection-log.mjs';

const stats = {
  '2026-09-11': { 'keyword:official:adult-terms-local-door': 3 },
  '2026-09-12': {
    'keyword:official:adult-terms-local-door': 5,
    'builtin:default-name-digits': 2,
  },
};

describe('detect看一看 detection 日志聚合', () => {
  it('按日计数重排为规则时间线并累计总量', () => {
    const { days, rules } = ruleTimeline(stats);
    expect(days).toEqual(['2026-09-11', '2026-09-12']);
    expect(rules.get('keyword:official:adult-terms-local-door')).toEqual({
      total: 8,
      days: [
        ['2026-09-11', 3],
        ['2026-09-12', 5],
      ],
    });
  });

  it('topRules 只统计最近 N 日并按热度排序', () => {
    const { span, rows } = topRules(stats, 1);
    expect(span).toEqual(['2026-09-12']);
    expect(rows[0]).toEqual({
      ruleId: 'keyword:official:adult-terms-local-door',
      total: 8,
      recent: 5,
      last: ['2026-09-12', 5],
    });
    expect(rows[1].ruleId).toBe('builtin:default-name-digits');
  });

  it('entryFacets 输出来源/分类/高频号画像', () => {
    const facets = entryFacets([
      { at: 1, handle: 'a', ruleId: 'r', source: 'builtin-list', category: 'scam_phishing' },
      { at: 2, handle: 'a', ruleId: 'r', source: 'builtin-list' },
    ]);
    expect(facets.sources).toEqual(['builtin-list=2']);
    expect(facets.categories).toEqual(['scam_phishing=1', '(未定)=1']);
    expect(facets.handles).toEqual(['a=2']);
  });
});
