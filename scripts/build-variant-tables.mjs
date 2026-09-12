#!/usr/bin/env node
/* global process, console, URL, fetch */
// 生成规避变体归一化映射表（apps/extension/src/lib/detection/variant-tables.json）。
// 三个来源全部是权威数据，禁止手搓条目：
//   1. trad_simp   —— opencc-js 全字简繁映射（跑全 BMP CJK 统一区，差异字进表）。
//      取全字表而非词库字符子集：后台热更加中文词条不需要随发版重建本表。
//   2. radicals    —— Unicode 官方 CJKRadicals.txt：部首/兼容部首（U+2E80-2FDF）→ 正字。
//      NFKC 只能覆盖康熙部首块；CJK Radicals Supplement（⻔/⻓类）必须靠这张表。
//   3. confusables —— Unicode 官方 confusables.txt：同形异源字 → ASCII 目标。
//      只收 target 为 ASCII 字母数字的条目（中文无 confusable 表可依，避免误伤面）。
// 输出 submit 进仓库；映射只在 normalizeKeywordPhrase 两侧统一应用，幂等由收敛循环保证。

import { writeFile, readFile } from 'node:fs/promises';
import OpenCC from 'opencc-js';

const OUTPUT = new URL('../apps/extension/src/lib/detection/variant-tables.json', import.meta.url);
const CJK_RADICALS_URL = 'https://www.unicode.org/Public/UCD/latest/ucd/CJKRadicals.txt';
const CONFUSABLES_URL = 'https://www.unicode.org/Public/security/latest/confusables.txt';

async function fetchText(url) {
  const cache = process.env.FEEDSIEVE_VARIANT_CACHE_DIR;
  if (cache) {
    try {
      const cached = await readFile(`${cache}/${url.split('/').pop()}`, 'utf8');
      return cached;
    } catch {
      /* fallthrough to network */
    }
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`download failed: ${url} (${response.status})`);
  const text = await response.text();
  if (cache) {
    await writeFile(`${cache}/${url.split('/').pop()}`, text);
  }
  return text;
}

function parseRadicals(text) {
  const map = {};
  for (const line of text.split('\n')) {
    if (line.startsWith('#') || line.trim() === '') continue;
    const [, radical, ideograph] = line.split(';').map((field) => field.trim());
    if (!/^[0-9A-F]{4,5}$/.test(radical) || !/^[0-9A-F]{4,6}$/.test(ideograph)) continue;
    const key = String.fromCodePoint(parseInt(radical, 16));
    const value = String.fromCodePoint(parseInt(ideograph, 16));
    // 同一部首多行（含 ' 简化变体）取后写覆盖前的策略不可靠；同一 key 直接并集会丢语义，
    // 这里以行序保留首见（文件按部首号排序，简化变体 ' 行更靠后、更贴近简体）。
    map[key] = value;
  }
  return map;
}

function parseConfusables(text) {
  const map = {};
  for (const line of text.split('\n')) {
    if (line.startsWith('#') || line.startsWith('-----') || line.trim() === '') continue;
    const [sourceField, targetField] = line.split(';').map((field) => field.trim());
    const source = parseInt(sourceField, 16);
    if (!Number.isFinite(source)) continue;
    const target = String.fromCodePoint(
      ...targetField.split(/\s+/).map((code) => parseInt(code, 16)).filter(Number.isFinite),
    );
    if (!/^[0-9a-z]+$/.test(target)) continue;
    map[String.fromCodePoint(source)] = target;
  }
  return map;
}

const toSimplified = OpenCC.Converter({ from: 't', to: 'cn' });
const tradSimp = {};
// 统一表意主区 + 扩展 A 的常用段；兼容区（F900）由 NFKC 先行归并，不入本表。
for (let cp = 0x3400; cp <= 0x9fff; cp += 1) {
  // 跳过未分配的 0x4DB6-0x4DFF 空洞也无妨：converter 对未分配字符照原样返回。
  const ch = String.fromCodePoint(cp);
  const simplified = toSimplified(ch);
  if (simplified && simplified !== ch) tradSimp[ch] = simplified;
}

const radicals = parseRadicals(await fetchText(CJK_RADICALS_URL));
const confusables = parseConfusables(await fetchText(CONFUSABLES_URL));

const tables = { trad_simp: tradSimp, radicals, confusables };
await writeFile(OUTPUT, `${JSON.stringify(tables)}\n`);
console.log(
  `variant-tables: trad_simp=${Object.keys(tradSimp).length} radicals=${Object.keys(radicals).length} confusables=${Object.keys(confusables).length}`,
);
