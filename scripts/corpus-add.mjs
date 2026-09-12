#!/usr/bin/env node
/* global process, console */
/**
 * golden corpus 用例添加：替代手工改 cases.json（误伤修复 / 规则新增都要先落 corpus）。
 *
 * 用法：
 *   node scripts/corpus-add.mjs --id zh-fu-variant --expected porn-bait-zh \
 *     --note '「福」同音变体' --input '{"handle":"fu_02","text":"偶禽富不曉"}'
 *
 *   --expected   期望命中的 ruleId；干净账号传 null
 *   --input      内联 JSON，或 @path 指向文件（对象含 handle / displayName /
 *                text / bio / links，与 detect 输入一致）
 *   --json       只输出插入后的 JSON 摘要（供脚本串联）
 *
 * 校验：id 唯一、input.handle 必填、expected 必须能被主语源/detector 识别后
 * 再人工核对——本脚本只做结构校验，不跑规则（跑规则是 corpus.test.ts 的事，
 * 添加完请 `pnpm test` 确认金标用例通过）。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const casesPath = resolve(ROOT, 'packages/detector/corpus/cases.json');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (!flag.startsWith('--')) throw new Error(`意外参数：${flag}（请用 --key value 形式）`);
    const key = flag.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) throw new Error(`--${key} 缺少取值`);
    out[key] = next;
    i += 1;
  }
  return out;
}

function parseJsonOrFile(value) {
  if (!value.startsWith('@')) return JSON.parse(value);
  return JSON.parse(readFileSync(resolve(value.slice(1)), 'utf8'));
}

const { id, expected, note, input, json } = parseArgs(process.argv.slice(2));
if (!id) {
  console.error('缺少 --id');
  process.exit(1);
}
if (expected === undefined) {
  console.error('缺少 --expected（命中 ruleId；干净账号传 null）');
  process.exit(1);
}

const testCase = {
  id,
  ...(note ? { note } : {}),
  input: parseJsonOrFile(input),
  expected: expected === 'null' ? null : expected,
};

if (!testCase.input || typeof testCase.input !== 'object' || !testCase.input.handle) {
  console.error('--input 缺少 handle（corpus 输入必含 handle）');
  process.exit(1);
}
if (typeof testCase.expected !== 'string' && testCase.expected !== null) {
  console.error('--expected 必须是 ruleId 或 null');
  process.exit(1);
}

const corpus = JSON.parse(readFileSync(casesPath, 'utf8'));
const existing = corpus.cases.find((c) => c.id === testCase.id);
if (existing) {
  console.error(`用例 id 已存在：${id}（请换 id 或先删除旧用例）`);
  process.exit(1);
}
corpus.cases.push(testCase);

writeFileSync(casesPath, `${JSON.stringify(corpus, null, 2)}\n`);
console.log(`已添加用例 ${id} → ${testCase.expected ?? 'null'}（cases.json 共 ${corpus.cases.length} 条）`);
if (!json) {
  console.log('下一步：跑 `pnpm test` 确认金标用例通过后一并提交');
}
