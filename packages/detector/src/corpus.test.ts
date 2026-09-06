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
import { DEFAULT_HEURISTICS } from './heuristics';

interface CorpusCase {
  id: string;
  input: {
    handle: string;
    displayName?: string;
    text?: string;
    bio?: string;
    links?: Array<{ href: string; hostname?: string; display?: string }>;
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

describe(`detector golden corpus v${corpus.corpus_version}`, () => {
  it.each(corpus.cases)('$id', (c) => {
    if (c.known_limitation) counts.known_limitation += 1;
    const detection = detect(c.input, { heuristics: DEFAULT_HEURISTICS });
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
  };
  console.log(`[corpus] precision=${summary.precision} recall=${summary.recall} fpr=${summary.fpr} (tp=${tp} fp=${fp} fn=${fn} tn=${tn})`);
  if (process.env.CORPUS_REPORT === '1') {
    writeFileSync(metricsPath, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(`[corpus] metrics written to ${metricsPath}`);
  }
});