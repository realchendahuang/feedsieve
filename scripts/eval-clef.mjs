#!/usr/bin/env node
/**
 * clef-flash 接入评测脚本。
 *
 * 读 jsonl 测试集 → 以固定并发调用 Worker AI 上的 @cf/cloudflare/clef-flash
 * → 输出逐条概率、P/R/F1、平均延迟、token 与费用，并可选与
 * @feedsieve/detector 的 L1 规则做同集对比。
 *
 * 测试集每行一条：
 *   { id, category, label: "spam"|"ham", ai: true|false|null,
 *     input: { handle, displayName?, bio?, text?, links? }, images?: string[] }
 *
 * 用法：
 *   node scripts/eval-clef.mjs \
 *     --cases scripts/eval-clef.cases.jsonl \
 *     --concurrency 8 \
 *     --out /tmp/eval/clef
 *
 *   # 追加 AI 生成探测（只跑 ai 字段非 null 的样本，单独计费）
 *   node scripts/eval-clef.mjs --cases ... --probe ai
 *
 * token 来源：环境变量 CLEF_TOKEN / CLOUDFLARE_API_TOKEN，缺省读
 * ~/Library/Preferences/.wrangler/config/default.toml 的 oauth_token。
 *
 * 本脚本只读仓库源码，不改任何业务代码。
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerHooks } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));

const ACCOUNT_ID = '4637564ffe56fa1147f68c2c3a7d4772';
const ENDPOINT = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/@cf/cloudflare/clef-flash`;
/** 2026-10 实测价：$0.038 / 1M input tokens，output 不计费。 */
const INPUT_USD_PER_TOKEN = 0.038 / 1_000_000;

// ---------------------------------------------------------------- CLI

const USAGE = `用法：node scripts/eval-clef.mjs [选项]

  --cases <path>        测试集 jsonl（默认 scripts/eval-clef.cases.jsonl）
  --concurrency <n>     并发数（默认 8）
  --out <dir>           输出目录（默认 /tmp/eval/clef）
  --threshold <0-1>     判定阈值（默认 0.5）
  --limit <n>           只跑前 n 条（冒烟用）
  --probe ai            追加一轮「是否 AI 生成」探测（ai 字段非 null 的样本）
  --dry-run             不调 API，只跑本地规则
  -h, --help            显示本帮助
`;

function parseArgs(argv) {
  const args = {
    cases: join(HERE, 'eval-clef.cases.jsonl'),
    concurrency: 8,
    out: '/tmp/eval/clef',
    probe: null,
    threshold: 0.5,
    limit: 0,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = () => argv[++i];
    switch (flag) {
      case '--cases':
        args.cases = resolve(next());
        break;
      case '--concurrency':
        args.concurrency = Math.max(1, Number(next()) || 8);
        break;
      case '--out':
        args.out = resolve(next());
        break;
      case '--probe':
        args.probe = next();
        break;
      case '--threshold':
        args.threshold = Number(next());
        break;
      case '--limit':
        args.limit = Math.max(0, Number(next()) || 0);
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '-h':
      case '--help':
        console.log(USAGE);
        process.exit(0);
        break;
      default:
        if (flag.startsWith('--')) throw new Error(`未知参数：${flag}`);
    }
  }
  return args;
}

// ---------------------------------------------------------------- 数据

function readCases(path) {
  const rows = [];
  const text = readFileSync(path, 'utf8');
  for (const [index, line] of text.split('\n').entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;
    let row;
    try {
      row = JSON.parse(trimmed);
    } catch (error) {
      throw new Error(`${path}:${index + 1} JSON 解析失败：${error.message}`, { cause: error });
    }
    if (!row.id || !row.input?.handle) throw new Error(`${path}:${index + 1} 缺少 id 或 input.handle`);
    if (row.label !== 'spam' && row.label !== 'ham') {
      throw new Error(`${path}:${index + 1} label 必须是 spam/ham`);
    }
    rows.push(row);
  }
  return rows;
}

/** 决议模型只看一段文本；这里把账号快照压成生产里会喂给它的同一形状。 */
function buildState(input) {
  const lines = [];
  if (input.handle) lines.push(`账号：@${String(input.handle).replace(/^@+/, '')}`);
  if (input.displayName) lines.push(`昵称：${input.displayName}`);
  if (input.bio) lines.push(`简介：${input.bio}`);
  if (input.text) lines.push(`最近推文：${input.text}`);
  const hosts = (input.links ?? []).map((link) => link.hostname).filter(Boolean);
  if (hosts.length) lines.push(`外链域名：${hosts.join('、')}`);
  return lines.join('\n').slice(0, 4000);
}

/** AI 探测只看文本本身：剥掉 handle / 昵称，避免把账号线索混进「像不像 AI」。 */
function buildTextState(row) {
  return [row.input.bio, row.input.text].filter(Boolean).join('\n').slice(0, 4000);
}

const SPAM_QUESTION = {
  spam: {
    type: 'noul',
    instructions:
      '这是一条 X（Twitter）账号快照。判断该账号/该条内容是否属于垃圾推广、色情引流、诈骗引流或批量运营号。正常的个人表达、吐槽、争论、带脏话的情绪发言都不算垃圾。',
    criteria: {},
  },
};

const AI_QUESTION = {
  ai: {
    type: 'noul',
    instructions:
      '判断这段文本是否由大语言模型（AI）自动生成或大幅改写。真人随手写的口语、错别字、网络梗都应判为非 AI。',
    criteria: {},
  },
};

// ---------------------------------------------------------------- 调用

function loadToken() {
  if (process.env.CLEF_TOKEN) return process.env.CLEF_TOKEN;
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  const path = join(homedir(), 'Library/Preferences/.wrangler/config/default.toml');
  try {
    const token = readFileSync(path, 'utf8').match(/oauth_token\s*=\s*"([^"]+)"/)?.[1];
    if (token) return token;
  } catch {
    /* 下面统一报错 */
  }
  throw new Error('找不到凭据：设置 CLEF_TOKEN / CLOUDFLARE_API_TOKEN，或先 wrangler login');
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function callClef(token, { state, questions, images }) {
  const body = { model: 'clef-flash', state, questions };
  if (images?.length) body.images = images;
  const started = performance.now();
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        const message =
          payload?.errors?.map((error) => error.message).join('; ') ?? `HTTP ${response.status}`;
        // 4xx 里只有 429 值得重试，其余是请求体问题，重试只会烧额度。
        if (response.status !== 429 && response.status < 500) {
          const fatal = new Error(message);
          fatal.fatal = true;
          throw fatal;
        }
        lastError = new Error(message);
      } else {
        return {
          answers: payload.result.answers,
          tokens: payload.result.usage?.input_tokens ?? 0,
          latencyMs: performance.now() - started,
          attempts: attempt,
        };
      }
    } catch (error) {
      if (error.fatal) throw error;
      lastError = error;
    }
    if (attempt < 3) await sleep(400 * attempt + Math.random() * 300);
  }
  throw lastError;
}

/** 固定并发池：顺序稳定，单条失败不拖垮整批。 */
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------- 指标

function prf(tp, fp, fn, tn) {
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  const accuracy = tp + tn + fp + fn ? (tp + tn) / (tp + tn + fp + fn) : 0;
  const fpr = fp + tn ? fp / (fp + tn) : 0;
  return { tp, fp, fn, tn, precision, recall, f1, accuracy, fpr };
}

/** scoreFn 给 0–1 分数，>= threshold 即判 spam。 */
function tally(rows, scoreFn, threshold) {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  for (const row of rows) {
    if (row.error) continue;
    const truth = row.label === 'spam';
    const guess = scoreFn(row) >= threshold;
    if (truth && guess) tp += 1;
    else if (!truth && guess) fp += 1;
    else if (truth && !guess) fn += 1;
    else tn += 1;
  }
  return prf(tp, fp, fn, tn);
}

const clefScore = (row) => row.score;
const rulesScore = (row) => (row.rules.marked ? 1 : 0);

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

/** Mann-Whitney AUC：样本只有几十条时，比「准确率」更能说明可分性。 */
function auc(positives, negatives) {
  if (!positives.length || !negatives.length) return null;
  let wins = 0;
  for (const p of positives) {
    for (const n of negatives) {
      if (p > n) wins += 1;
      else if (p === n) wins += 0.5;
    }
  }
  return wins / (positives.length * negatives.length);
}

function bestThreshold(rows) {
  let best = { threshold: 0.5, f1: -1, precision: 0, recall: 0 };
  for (let t = 0.05; t <= 0.96; t += 0.05) {
    const rounded = Math.round(t * 100) / 100;
    const m = tally(rows, clefScore, rounded);
    if (m.f1 > best.f1) {
      best = { threshold: rounded, f1: m.f1, precision: m.precision, recall: m.recall };
    }
  }
  return best;
}

const pct = (value) => `${(value * 100).toFixed(1)}%`;

// ---------------------------------------------------------------- 规则层

async function loadDetector() {
  // detector 源码是 TS 且内部 import 不带扩展名；Node 类型剥离要求显式 .ts。
  // 用同步 resolve 钩子补齐，避免把源码复制到仓库外。
  registerHooks({
    resolve(specifier, context, next) {
      try {
        return next(specifier, context);
      } catch (error) {
        if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/.test(specifier)) {
          return next(`${specifier}.ts`, context);
        }
        throw error;
      }
    },
  });
  const module = await import(new URL('../packages/detector/src/index.ts', import.meta.url));
  return module.detect;
}

// ---------------------------------------------------------------- 输出

function metricsRow(name, m) {
  return `| ${name} | ${m.tp} | ${m.fp} | ${m.fn} | ${m.tn} | ${pct(m.precision)} | ${pct(m.recall)} | ${pct(m.f1)} | ${pct(m.fpr)} |`;
}

function renderMarkdown(summary) {
  const lines = [];
  lines.push(`# clef-flash 评测（${summary.generatedAt.slice(0, 19)}）`);
  lines.push('');
  lines.push(`- 样本：${summary.total} 条（成功 ${summary.scored}，失败 ${summary.failed}）`);
  lines.push(`- 阈值：${summary.threshold}`);
  lines.push(
    `- 延迟：均值 ${summary.latency.meanMs.toFixed(0)}ms · p50 ${summary.latency.p50Ms.toFixed(0)}ms · p95 ${summary.latency.p95Ms.toFixed(0)}ms · max ${summary.latency.maxMs.toFixed(0)}ms`,
  );
  lines.push(
    `- token：合计 ${summary.tokens.total}，均值 ${summary.tokens.meanPerCall.toFixed(1)}/次，` +
      `本次费用 $${summary.tokens.costUsd.toFixed(4)}（$0.038/M input）`,
  );
  lines.push('');
  lines.push('| 判定器 | TP | FP | FN | TN | P | R | F1 | FPR |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  lines.push(metricsRow('clef-flash', summary.clef));
  lines.push(metricsRow('L1 规则', summary.rules));
  lines.push(metricsRow('并集（规则∪clef）', summary.union));
  lines.push('');
  lines.push(
    `clef 最佳阈值 ${summary.bestClefThreshold.threshold}：P ${pct(summary.bestClefThreshold.precision)} / R ${pct(summary.bestClefThreshold.recall)} / F1 ${pct(summary.bestClefThreshold.f1)}`,
  );
  lines.push('');
  lines.push('## 阈值扫描');
  lines.push('');
  lines.push('| 阈值 | P | R | F1 | FPR |');
  lines.push('| ---: | ---: | ---: | ---: | ---: |');
  for (const point of summary.sweep) {
    lines.push(
      `| ${point.threshold.toFixed(2)} | ${pct(point.precision)} | ${pct(point.recall)} | ${pct(point.f1)} | ${pct(point.fpr)} |`,
    );
  }
  lines.push('');
  lines.push('## 分类别');
  lines.push('');
  lines.push(
    '| 类别 | 条数 | clef 均分 | clef P | clef R | clef F1 | 规则 P | 规则 R | 规则 F1 |',
  );
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const row of summary.perCategory) {
    lines.push(
      `| ${row.category} | ${row.total} | ${row.clefMean.toFixed(2)} | ${pct(row.clef.precision)} | ${pct(row.clef.recall)} | ${pct(row.clef.f1)} | ${pct(row.rules.precision)} | ${pct(row.rules.recall)} | ${pct(row.rules.f1)} |`,
    );
  }
  if (summary.probe) {
    const probe = summary.probe;
    lines.push('');
    lines.push('## AI 生成探测（单条文本）');
    lines.push('');
    lines.push(`- 正样本（AI 拟定）均值 ${probe.positives.mean.toFixed(3)}，范围 ${probe.positives.range}`);
    lines.push(`- 负样本（真人）均值 ${probe.negatives.mean.toFixed(3)}，范围 ${probe.negatives.range}`);
    lines.push(`- AUC ${probe.auc == null ? 'n/a' : probe.auc.toFixed(3)}（0.5 = 随机）`);
    lines.push(`- 额外 token ${probe.tokens}，失败 ${probe.failed}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------- 主流程

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let rows = readCases(args.cases);
  if (args.limit) rows = rows.slice(0, args.limit);
  if (!rows.length) throw new Error('测试集为空');

  mkdirSync(args.out, { recursive: true });
  const detectorDetect = await loadDetector();

  console.log(
    `clef-flash 评测：${rows.length} 条，并发 ${args.concurrency}${args.dryRun ? '（dry-run）' : ''}`,
  );

  // 规则层先跑：纯本地，不花钱。
  for (const row of rows) {
    try {
      const detection = detectorDetect(row.input);
      row.rules = {
        marked: Boolean(detection),
        ruleId: detection?.ruleId ?? null,
        reason: detection?.reason ?? null,
      };
    } catch (error) {
      row.rules = { marked: false, ruleId: null, reason: `规则异常：${error.message}` };
    }
  }

  const token = args.dryRun ? null : loadToken();
  const startedAt = performance.now();
  let order = 0;

  const results = await mapLimit(rows, args.concurrency, async (row) => {
    order += 1;
    const position = String(order).padStart(2);
    if (args.dryRun) {
      return { ...row, score: null, latencyMs: 0, tokens: 0, error: 'dry-run' };
    }
    try {
      const answer = await callClef(token, {
        state: buildState(row.input),
        questions: SPAM_QUESTION,
        images: row.images,
      });
      const score = answer.answers.spam?.noul ?? null;
      console.log(
        `  [${position}/${rows.length}] ${row.id.padEnd(6)} ${row.category.padEnd(5)} ` +
          `spam=${score?.toFixed(3) ?? '—'} ${String(Math.round(answer.latencyMs)).padStart(4)}ms ${String(answer.tokens).padStart(4)}tk`,
      );
      return { ...row, score, latencyMs: answer.latencyMs, tokens: answer.tokens };
    } catch (error) {
      console.log(`  [${position}/${rows.length}] ${row.id.padEnd(6)} 失败：${error.message}`);
      return { ...row, score: null, latencyMs: 0, tokens: 0, error: error.message };
    }
  });
  const wallMs = performance.now() - startedAt;

  const ok = results.filter((row) => !row.error);
  const threshold = args.threshold;

  const clefMetrics = tally(ok, clefScore, threshold);
  const ruleMetrics = tally(ok, rulesScore, 0.5);
  const unionMetrics = tally(
    ok,
    (row) => (row.rules.marked || row.score >= threshold ? 1 : 0),
    0.5,
  );

  const categories = [...new Set(results.map((row) => row.category))];
  const perCategory = categories.map((category) => {
    const subset = ok.filter((row) => row.category === category);
    return {
      category,
      total: subset.length,
      spam: subset.filter((row) => row.label === 'spam').length,
      clef: tally(subset, clefScore, threshold),
      rules: tally(subset, rulesScore, 0.5),
      clefMean: subset.length ? subset.reduce((sum, row) => sum + row.score, 0) / subset.length : 0,
    };
  });

  const latencies = ok.map((row) => row.latencyMs);
  const totalTokens = ok.reduce((sum, row) => sum + row.tokens, 0);

  const sweep = [];
  for (let t = 0.3; t <= 0.81; t += 0.05) {
    const rounded = Math.round(t * 100) / 100;
    sweep.push({ threshold: rounded, ...tally(ok, clefScore, rounded) });
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    cases: args.cases,
    model: 'clef-flash',
    threshold,
    total: results.length,
    scored: ok.length,
    failed: results.length - ok.length,
    latency: {
      meanMs: latencies.reduce((a, b) => a + b, 0) / (latencies.length || 1),
      p50Ms: percentile(latencies, 50),
      p95Ms: percentile(latencies, 95),
      maxMs: Math.max(...latencies, 0),
      wallMs,
    },
    tokens: {
      total: totalTokens,
      meanPerCall: totalTokens / (ok.length || 1),
      costUsd: totalTokens * INPUT_USD_PER_TOKEN,
      costPer1kUsd: (totalTokens / (ok.length || 1)) * 1000 * INPUT_USD_PER_TOKEN,
    },
    clef: clefMetrics,
    rules: ruleMetrics,
    union: unionMetrics,
    bestClefThreshold: bestThreshold(ok),
    sweep,
    perCategory,
  };

  // ---- AI 生成探测（可选；dry-run 不发真实请求）
  if (args.probe === 'ai' && !args.dryRun) {
    const probeRows = ok.filter((row) => row.ai === true || row.ai === false);
    console.log(
      `\nAI 生成探测：${probeRows.length} 条（正 ${probeRows.filter((row) => row.ai).length} / 负 ${probeRows.filter((row) => !row.ai).length}）`,
    );
    const probed = await mapLimit(probeRows, args.concurrency, async (row) => {
      try {
        const answer = await callClef(token, {
          state: buildTextState(row),
          questions: AI_QUESTION,
          images: row.images,
        });
        const score = answer.answers.ai?.noul ?? null;
        console.log(
          `  ${row.id.padEnd(6)} ai=${score?.toFixed(3)} ${String(Math.round(answer.latencyMs)).padStart(4)}ms`,
        );
        return {
          id: row.id,
          category: row.category,
          ai: row.ai,
          score,
          tokens: answer.tokens,
          latencyMs: answer.latencyMs,
        };
      } catch (error) {
        return { id: row.id, category: row.category, ai: row.ai, score: null, error: error.message, tokens: 0, latencyMs: 0 };
      }
    });
    const good = probed.filter((row) => typeof row.score === 'number');
    const positives = good.filter((row) => row.ai).map((row) => row.score);
    const negatives = good.filter((row) => !row.ai).map((row) => row.score);
    const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
    const span = (values) =>
      values.length ? `${Math.min(...values).toFixed(3)}–${Math.max(...values).toFixed(3)}` : 'n/a';
    summary.probe = {
      question: AI_QUESTION.ai.instructions,
      total: probed.length,
      failed: probed.length - good.length,
      positives: { n: positives.length, mean: mean(positives), range: span(positives) },
      negatives: { n: negatives.length, mean: mean(negatives), range: span(negatives) },
      auc: auc(positives, negatives),
      tokens: good.reduce((sum, row) => sum + row.tokens, 0),
      rows: probed,
    };
  }

  writeFileSync(join(args.out, 'results.json'), JSON.stringify({ summary, results }, null, 2));
  const markdown = renderMarkdown(summary);
  writeFileSync(join(args.out, 'summary.md'), markdown);

  console.log(`\n${markdown}`);
  console.log(`\n结果已写入 ${args.out}`);
}

main().catch((error) => {
  console.error(`\n失败：${error.message}`);
  process.exit(1);
});
