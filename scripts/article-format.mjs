#!/usr/bin/env node
/**
 * Markdown → X 文章内容（纯转换，不碰浏览器）。
 *
 * 给外部 AI Agent / 脚本用的入口：把 Markdown 转成 X 文章编辑器（Draft.js）认的
 * HTML，顺带给出标题、纯文本和本地图片占位符清单。真正的粘贴、插图仍由 Agent
 * 在浏览器里完成，流程见 skills/feedsieve-article/SKILL.md。
 *
 * 用法：
 *   node scripts/article-format.mjs article.md           # JSON：title / html / text / images
 *   node scripts/article-format.mjs article.md --html    # 只打印 HTML
 *   node scripts/article-format.mjs article.md --text    # 只打印纯文本
 *   cat article.md | node scripts/article-format.mjs --json
 *   node scripts/article-format.mjs article.md --out /tmp/article.json
 *
 * 依赖：Node ≥ 22（直接跑 TypeScript 源码，和扩展共用同一份转换器）。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { markdownToArticle } from '../apps/extension/src/lib/compose/markdown-article.ts';

/** 转换入口：与扩展里粘贴 Markdown 时用的是同一个函数。 */
export function formatMarkdown(markdown) {
  return markdownToArticle(markdown);
}

function usage(stream = process.stdout) {
  stream.write(`用法：node scripts/article-format.mjs <article.md | -> [--json|--html|--text] [--out 文件]

  --json   （默认）title / html / text / images 全量 JSON
  --html   只输出 X 文章编辑器认的 HTML
  --text   只输出纯文本（粘到不支持富文本的地方用）
  --out     写进文件而不是标准输出
  不给文件名时从标准输入读（cat article.md | …）
`);
}

/**
 * CLI 主逻辑。返回进程退出码，方便测试直接调用。
 * @param {string[]} argv
 * @param {() => string} [readStdin]
 */
export function main(argv = process.argv.slice(2), readStdin = () => readFileSync(0, 'utf8')) {
  const args = [...argv];
  let file = null;
  let mode = 'json';
  let out = null;
  while (args.length > 0) {
    const arg = args.shift();
    if (arg === '--json') mode = 'json';
    else if (arg === '--html') mode = 'html';
    else if (arg === '--text') mode = 'text';
    else if (arg === '--out') {
      out = args.shift() ?? null;
      if (!out) {
        process.stderr.write('--out 后面要给文件名\n');
        return 1;
      }
    } else if (arg === '--help' || arg === '-h') {
      usage();
      return 0;
    } else if (arg.startsWith('-') && arg !== '-') {
      process.stderr.write(`不认识的参数：${arg}\n`);
      usage(process.stderr);
      return 1;
    } else if (file === null) {
      file = arg;
    } else {
      process.stderr.write(`只能给一个 Markdown 文件：${file} / ${arg}\n`);
      return 1;
    }
  }

  let markdown;
  try {
    markdown = file && file !== '-' ? readFileSync(resolve(file), 'utf8') : readStdin();
  } catch (error) {
    process.stderr.write(`读不到 ${file}：${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }

  const result = formatMarkdown(markdown);
  const json = `${JSON.stringify(result, null, 2)}\n`;
  const payload = mode === 'html' ? result.html : mode === 'text' ? result.text : json;
  const withNewline = payload.endsWith('\n') ? payload : `${payload}\n`;
  if (out) {
    writeFileSync(resolve(out), mode === 'json' ? json : withNewline);
    process.stderr.write(`已写入 ${out}\n`);
  } else {
    process.stdout.write(withNewline);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
