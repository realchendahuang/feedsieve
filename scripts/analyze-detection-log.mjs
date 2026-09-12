#!/usr/bin/env node
/* global process, console */
/**
 * 本地检测日志分析（规则质量复盘闭环的最后一步；日志本身永不上报）。
 *
 * 数据来源：扩展 browser.storage.local 的 detectionLogV1（最近 200 条命中）
 * 与 detectionRuleStatsV1（按日 ruleId 计数，30 天）。取数方式任选：
 *
 * 1. 在扩展 SW 的 DevTools 里跑下面这行，把输出存成 JSON 文件：
 *      copy(JSON.stringify(await browser.storage.local.get(['detectionLogV1','detectionRuleStatsV1'])))
 * 2. 或 Chrome 扩展存储的 LevelDB 文本里直接抓这两个键。
 *
 * 用法：
 *   node scripts/analyze-detection-log.mjs dump.json [--days 14] [--limit 15]
 *   管道输入也行：cat dump.json | node scripts/analyze-detection-log.mjs
 */

import { readFileSync } from 'node:fs';

function readInput(argv) {
  const file = argv.find((a) => !a.startsWith('--'));
  if (file) return readFileSync(file, 'utf8');
  return readFileSync(0, 'utf8');
}

function argNum(argv, name, fallback) {
  const i = argv.indexOf(`--${name}`);
  if (i < 0 || !argv[i + 1]) return fallback;
  const n = Number.parseInt(argv[i + 1], 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** 按日→ruleId 计数重排成规则→[日期, 次数] 的时间线。 */
export function ruleTimeline(stats) {
  const days = Object.keys(stats).sort();
  const rules = new Map();
  for (const [day, byRule] of Object.entries(stats)) {
    for (const [ruleId, count] of Object.entries(byRule)) {
      const entry = rules.get(ruleId) ?? { total: 0, days: [] };
      entry.total += count;
      entry.days.push([day, count]);
      rules.set(ruleId, entry);
    }
  }
  for (const entry of rules.values()) {
    entry.days.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }
  return { days, rules };
}

/** 最近 N 个本地日的规则热度排行。 */
export function topRules(stats, recentDays) {
  const { days, rules } = ruleTimeline(stats);
  const cutoff = days.slice(-recentDays);
  const recent = new Set(cutoff);
  const rows = [...rules.entries()]
    .map(([ruleId, { total, days: timeline }]) => {
      const recentTotal = timeline
        .filter(([d]) => recent.has(d))
        .reduce((sum, [, c]) => sum + c, 0);
      return { ruleId, total, recent: recentTotal, last: timeline.at(-1) };
    })
    .sort((a, b) => b.recent - a.recent || b.total - a.total)
    .slice(0, 15);
  return { span: cutoff, rows };
}

/** 最近 200 条命中里的手写画像：来源 / 分类 / 高频号。 */
export function entryFacets(log) {
  const bySource = new Map();
  const byCategory = new Map();
  const byHandle = new Map();
  for (const entry of log) {
    bySource.set(entry.source, (bySource.get(entry.source) ?? 0) + 1);
    const cat = entry.category ?? '(未定)';
    byCategory.set(cat, (byCategory.get(cat) ?? 0) + 1);
    byHandle.set(entry.handle, (byHandle.get(entry.handle) ?? 0) + 1);
  }
  const sortDesc = (m) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`);
  return { sources: sortDesc(bySource), categories: sortDesc(byCategory), handles: sortDesc(byHandle).slice(0, 10) };
}

function main() {
  const argv = process.argv.slice(2);
  let parsed;
  try {
    parsed = JSON.parse(readInput(argv));
  } catch (err) {
    console.error('读取/解析日志失败：', err.message);
    console.error('用法：node scripts/analyze-detection-log.mjs dump.json [--days 14]');
    process.exit(1);
  }
  const days = argNum(argv, 'days', 14);
  const { detectionLogV1: log = [], detectionRuleStatsV1: stats = {} } = parsed;

  console.log(`本地检测日志 · 逐条命中 ${log.length} 条 · 按日统计覆盖 ${ruleTimeline(stats).days.length} 天`);
  const { span, rows } = topRules(stats, days);
  console.log(`\n── 规则热度（近 ${span.length} 日 ${span[0] ?? '-'} ~ ${span.at(-1) ?? '-'}）──`);
  for (const { ruleId, total, recent, last } of rows) {
    console.log(`${String(recent).padStart(4)} /${String(total).padStart(5)}  ${ruleId.padEnd(44)} 最近日 ${last?.[0] ?? '-'}`);
  }
  const facets = entryFacets(log);
  console.log(`\n── 最近 ${log.length} 条命中画像 ──`);
  console.log(`来源:   ${facets.sources.join('　') || '-'}`);
  console.log(`分类:   ${facets.categories.join('　') || '-'}`);
  console.log(`高频号: ${facets.handles.join('　') || '-'}`);
}

/* 测试导入时只提供聚合函数，不触发 I/O */
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  main();
}
