#!/usr/bin/env node
/* global process, console */
/**
 * 维护者挑词辅助：从垃圾话术文本里提取候选短语（特征帖入库工作流的前置步骤）。
 *
 * 用法：
 *   node scripts/extract-keyword-candidates.mjs posts.txt [--top 30] [--json]
 *   cat posts.txt | node scripts/extract-keyword-candidates.mjs
 *
 * 输出按出现次数排序的候选清单——只做机械提取，是否入库由维护者复核后走
 * keyword-admin 通道。同一批垃圾号的帖子一起喂进来，共用话术会浮到顶部。
 *
 * 提取规则：Intl.Segmenter 分词（回退：按空白/标点切）→ 滤掉 URL、@handle、
 * 纯 emoji/符号/标点/数字 → 中文词保留 ≥2 字、拉丁词 ≥3 字母；
 * 相邻且原文中无间隔的中文词对合并成候选短语（「福利|在|主页」→ 福利在/在主页）。
 */

import { readFileSync } from 'node:fs';

const URL_RE = /^(?:https?:\/\/|www\.|t\.co\/)/i;
const HANDLE_RE = /^@[a-z0-9_]{1,15}$/i;
const NOISE_RE = /^(?:[\p{P}\p{S}\p{C}\s]|\d+)+$/u;
const HAN_RE = /\p{Script=Han}/u;
/** 分词前整段剥 URL（含无协议域名/短链），避免 https / t.co 被切成词条漏进来。 */
const URL_SPAN_RE = /https?:\/\/\S+|www\.\S+|\b[\w-]+(?:\.[\w-]+)+(?:\/\S*)?/gi;

function segment(text) {
  try {
    const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });
    return [...segmenter.segment(text)].map((s) => ({
      text: s.segment,
      index: s.index,
      wordLike: Boolean(s.isWordLike),
    }));
  } catch {
    const out = [];
    const re = /\S+/g;
    let m;
    while ((m = re.exec(text))) {
      out.push({ text: m[0], index: m.index, wordLike: /[\p{L}\p{N}]/u.test(m[0]) });
    }
    return out;
  }
}

function isCandidate(token) {
  const t = token.trim();
  if (!t || URL_RE.test(t) || HANDLE_RE.test(t) || NOISE_RE.test(t)) {
    return false;
  }
  if (HAN_RE.test(t)) {
    return [...t].length >= 2;
  }
  return /[a-z]/i.test(t) && t.length >= 3;
}

/**
 * 提取候选短语：剥 URL → 分词 → 过滤 → 词级计数 + 极大连续中文段（整句
 * 话术成短语，如「我福不黑不信你看」）→ 频次排序。
 * 返回 [{ phrase, count }]，count 降序、同频按长度降序。
 */
export function extractKeywordCandidates(text, { top = 30 } = {}) {
  const segments = segment(text.replace(URL_SPAN_RE, ' ')).filter((s) => s.wordLike);
  const counts = new Map();
  const bump = (phrase) => counts.set(phrase, (counts.get(phrase) ?? 0) + 1);

  for (const seg of segments) {
    if (isCandidate(seg.text)) {
      bump(seg.text.trim().toLowerCase());
    }
  }
  // 极大连续中文段：段在原文中首尾相接才续上；≥2 段合成才单独计数
  // （单段词已由词级计数覆盖，避免重复加 1）
  let run = null;
  for (const seg of segments) {
    const isHan = HAN_RE.test(seg.text);
    if (isHan && run && seg.index === run.endIndex) {
      run.text += seg.text;
      run.endIndex = seg.index + seg.text.length;
      run.merged += 1;
      continue;
    }
    if (run && run.merged >= 2) {
      bump(run.text);
    }
    run = isHan ? { text: seg.text, endIndex: seg.index + seg.text.length, merged: 1 } : null;
  }
  if (run && run.merged >= 2) {
    bump(run.text);
  }

  return [...counts.entries()]
    .map(([phrase, count]) => ({ phrase, count }))
    .sort((a, b) => b.count - a.count || b.phrase.length - a.phrase.length || a.phrase.localeCompare(b.phrase))
    .slice(0, top);
}

function parseArgs(args) {
  let top = 30;
  let json = false;
  let file = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--json') {
      json = true;
    } else if (args[i] === '--top') {
      top = Number(args[i + 1]) || 30;
      i += 1;
    } else if (!args[i].startsWith('--')) {
      file = args[i];
    }
  }
  return { top, json, file };
}

function main() {
  const { top, json, file } = parseArgs(process.argv.slice(2));
  const input = file ? readFileSync(file, 'utf8') : readFileSync(0, 'utf8');
  const candidates = extractKeywordCandidates(input, { top });
  if (json) {
    console.log(JSON.stringify(candidates, null, 2));
    return;
  }
  if (candidates.length === 0) {
    console.log('（无候选——文本可能全是 emoji/链接/标点）');
    return;
  }
  const width = Math.max(...candidates.map((c) => String(c.count).length));
  for (const { phrase, count } of candidates) {
    console.log(`${String(count).padStart(width)}  ${phrase}`);
  }
}

if (process.argv[1]?.endsWith('extract-keyword-candidates.mjs')) {
  main();
}
