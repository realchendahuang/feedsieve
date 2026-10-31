#!/usr/bin/env node
// 大数据 JSON（名单快照 / 词库目录 / 变体表）不进 JS bundle：拷入 public/
// 作为随包资源，由后台读取并缓存到 storage。
// 随包资源清单这里只维护一份：wxt.config.ts 的 buildStart 也 import 本函数。
// wxt prepare 会按 public 里实际存在的文件生成 getURL 的 PublicPath 类型，
// 所以在 postinstall（prepare 之前）与 typecheck/build 前都要保证文件在场。
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(appDir, '../..');
const publicDir = resolve(appDir, 'public/community');

export const RUNTIME_DATA_COPIES = [
  { src: [repoRoot, 'community/lists/official.json'], dst: 'lists/official.json' },
  { src: [repoRoot, 'community/keyword-packs/official.json'], dst: 'keyword-packs/official.json' },
  { src: [appDir, 'src/lib/detection/variant-tables.json'], dst: 'keyword-packs/variant-tables.json' },
];

/** 把随包资源按清单拷入 public/community/，返回拷贝数。 */
export function copyRuntimeData() {
  for (const { src, dst } of RUNTIME_DATA_COPIES) {
    const dstPath = resolve(publicDir, dst);
    mkdirSync(dirname(dstPath), { recursive: true });
    copyFileSync(resolve(...src), dstPath);
  }
  return RUNTIME_DATA_COPIES.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const count = copyRuntimeData();
  process.stdout.write(`[copy-runtime-data] ${count} 个随包资源已入 apps/extension/public/community/\n`);
}
