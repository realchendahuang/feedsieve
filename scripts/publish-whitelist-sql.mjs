#!/usr/bin/env node
/**
 * whitelist.yaml 校验 + 发布 SQL 生成的 CLI（publish-community-whitelist.sh
 * 原内嵌 Python 块的替代，规则实现见 scripts/lib/whitelist-schema.mjs）：
 *
 *   node scripts/publish-whitelist-sql.mjs <source_file> <mode> <sql_file>
 *
 * mode 为 ''（发布：生成 SQL 写入 sql_file）或 '--check'（只校验+预览）。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import {
  epochSeconds,
  generateWhitelistSql,
  parseWhitelistYaml,
  utcIsoStamp,
} from './lib/whitelist-schema.mjs';

const [sourceFile = '', mode = '', sqlFile = ''] = process.argv.slice(2);
if (!sourceFile || !sqlFile) {
  console.error('usage: node scripts/publish-whitelist-sql.mjs <source_file> <mode> <sql_file>');
  process.exit(1);
}

const { entries, errors } = parseWhitelistYaml(readFileSync(sourceFile, 'utf8'));
if (errors.length > 0) {
  for (const error of errors) console.log(`error: ${sourceFile}:${error}`);
  process.exit(1);
}

console.log(`whitelist.yaml ok: ${entries.length} 条待发布`);
for (const entry of entries) {
  const xUserId = entry.x_user_id ? ` (${entry.x_user_id})` : '';
  console.log(`  + @${entry.handle.toLowerCase()}${xUserId}  ${entry.note}`);
}

if (mode === '--check') process.exit(0);

// now/stamp 取自两次独立的时钟读取，原 Python 的怪点原样保留（可能跨秒）
const now = epochSeconds();
const stamp = utcIsoStamp();
writeFileSync(sqlFile, generateWhitelistSql(entries, { now, stamp, sourceFile }));
