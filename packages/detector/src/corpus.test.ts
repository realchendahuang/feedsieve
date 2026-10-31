/**
 * Golden corpus 回归 + 分层指标。
 *
 * 每个规则/词库变更都必须跑通本测试：任何金标用例的预期命中改变都会让
 * 测试失败（宁可让 PR 停下来说明，也不让误报率悄悄变差）。
 *
 * CORPUS_REPORT=1 时把聚合指标写回 corpus/metrics.json —— 提交该文件后，
 * PR diff 即可看到精度/召回/误报率的变化。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { detect } from './detect';
import { DEFAULT_HEURISTICS, RUNTIME_HEURISTICS } from './heuristics';
import type { DetectAuthor } from './detect';

interface CorpusCase {
  id: string;
  input: {
    handle: string;
    displayName?: string;
    text?: string;
    bio?: string;
    links?: Array<{ href: string; hostname?: string; display?: string }>;
    author?: DetectAuthor;
    observedAt?: number;
  };
  expected: string | null;
  note?: string;
  known_limitation?: boolean;
}

const corpusPath = fileURLToPath(new URL('../corpus/cases.json', import.meta.url));
const metricsPath = fileURLToPath(new URL('../corpus/metrics.json', import.meta.url));
const corpus = JSON.parse(readFileSync(corpusPath, 'utf8')) as {
  corpus_version: number;
  cases: CorpusCase[];
};

const counts = { tp: 0, fp: 0, fn: 0, tn: 0, known_limitation: 0 };
/**
 * 扩展运行时真正装配的内置启发式（RUNTIME_HEURISTICS，不含关键词词库）在同一批用例上的指标：
 * 评测层与线上口径对齐。只统计、不逐条断言——单信号规则的用例在运行时本来就该漏（交给词库与名单）。
 */
const runtimeCounts = { tp: 0, fp: 0, fn: 0, tn: 0 };

describe(`detector golden corpus v${corpus.corpus_version}`, () => {
  it.each(corpus.cases)('$id', (c) => {
    if (c.known_limitation) counts.known_limitation += 1;
    const detection = detect(c.input, { heuristics: DEFAULT_HEURISTICS });
    const runtime = detect(c.input, { heuristics: RUNTIME_HEURISTICS });
    if (c.expected === null) runtimeCounts[runtime ? 'fp' : 'tn'] += 1;
    else runtimeCounts[runtime ? 'tp' : 'fn'] += 1;
    const actual = detection?.ruleId ?? null;
    if (c.expected === null) {
      if (actual === null) counts.tn += 1;
      else counts.fp += 1;
    } else if (actual === c.expected) {
      counts.tp += 1;
    } else {
      counts.fn += 1;
    }
    expect(actual, `${c.id}: ${c.note ?? ''}（期望 ${c.expected}）`).toBe(c.expected);
  });
});

function rates(c: { tp: number; fp: number; fn: number; tn: number }) {
  return {
    precision: Number((c.tp + c.fp === 0 ? 1 : c.tp / (c.tp + c.fp)).toFixed(4)),
    recall: Number((c.tp + c.fn === 0 ? 1 : c.tp / (c.tp + c.fn)).toFixed(4)),
    fpr: Number((c.fp + c.tn === 0 ? 0 : c.fp / (c.fp + c.tn)).toFixed(4)),
  };
}

it('runtime heuristics never mark a clean corpus case', () => {
  // 运行时直接面对用户：误标率必须为 0（漏判由词库、名单与社区佐证兜底）
  expect(runtimeCounts.fp).toBe(0);
});

afterAll(() => {
  const { tp, fp, fn, tn } = counts;
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  const fpr = fp + tn === 0 ? 0 : fp / (fp + tn);
  const summary = {
    corpus_version: corpus.corpus_version,
    generated_at: new Date().toISOString(),
    total: tp + fp + fn + tn,
    tp,
    fp,
    fn,
    tn,
    known_limitation: counts.known_limitation,
    precision: Number(precision.toFixed(4)),
    recall: Number(recall.toFixed(4)),
    fpr: Number(fpr.toFixed(4)),
    runtime: { ...runtimeCounts, ...rates(runtimeCounts) },
  };
  console.log(
    `[corpus] precision=${summary.precision} recall=${summary.recall} fpr=${summary.fpr} (tp=${tp} fp=${fp} fn=${fn} tn=${tn})`,
  );
  if (process.env.CORPUS_REPORT === '1') {
    writeFileSync(metricsPath, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(`[corpus] metrics written to ${metricsPath}`);
  }
});
