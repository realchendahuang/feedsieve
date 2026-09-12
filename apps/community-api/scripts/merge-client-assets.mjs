/* global process, console */
/**
 * 构建产物合并：TanStack Start 客户端资产在 dist/client（vite 输出），
 * admin SPA 资产在 ../admin/dist；部署前把 admin 资产拷进 dist/client，
 * 让单个 ASSETS 绑定同时覆盖公示站字体/图与后台 SPA。
 */
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.resolve(dirname, '../dist/client');
const adminDir = path.resolve(dirname, '../../admin/dist');

if (!existsSync(adminDir)) {
  console.error('[merge-client-assets] ../admin/dist 不存在：先 `pnpm --filter @feedsieve/admin build`');
  process.exit(1);
}

mkdirSync(clientDir, { recursive: true });
// admin 的资产整树拷入并允许覆盖：admin 是先构建的旧资产，本站 vite 构建的
// 新产物（字体、chunk）不会被覆盖；两站同路径资产（/assets/avatar.png）内容一致。
cpSync(adminDir, clientDir, { recursive: true, force: true });
console.log('[merge-client-assets] merged admin SPA assets ->', clientDir);
