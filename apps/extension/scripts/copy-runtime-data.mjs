#!/usr/bin/env node
/* global process */
// 大数据 JSON（名单快照 / 词库目录 / 变体表）不进 JS bundle：拷入 public/
// 作为随包资源，运行时 runtime.getURL + fetch 读取。
// wxt prepare 会按 public 里实际存在的文件生成 getURL 的 PublicPath 类型，
// 所以在 postinstall（prepare 之前）与 typecheck/build 前都要保证文件在场。
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(appDir, '../..');
const publicDir = resolve(appDir, 'public/community');

const copies = [
  { src: [repoRoot, 'community/lists/official.json'], dst: 'lists/official.json' },
  { src: [repoRoot, 'community/keyword-packs/official.json'], dst: 'keyword-packs/official.json' },
  { src: [appDir, 'src/lib/detection/variant-tables.json'], dst: 'keyword-packs/variant-tables.json' },
];

for (const { src, dst } of copies) {
  const dstPath = resolve(publicDir, dst);
  mkdirSync(dirname(dstPath), { recursive: true });
  copyFileSync(resolve(...src), dstPath);
}
process.stdout.write(`[copy-runtime-data] ${copies.length} 个随包资源已入 apps/extension/public/community/\n`);
