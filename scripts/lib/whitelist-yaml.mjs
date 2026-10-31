/**
 * 白名单 YAML 公共解析（ingest-whitelist-issues / promote-rescued-whitelist 共用）。
 * 条目块的字段顺序以 publish-community-whitelist.sh 的解析器为准，勿改。
 */

/** 生成与 publish-community-whitelist.sh 兼容的条目 YAML 块（字段顺序固定）。 */
export function entryBlock(entry) {
  const lines = [`  - handle: ${entry.handle}`];
  if (entry.name) lines.push(`    name: "${entry.name}"`);
  if (entry.avatar_url) lines.push(`    avatar_url: "${entry.avatar_url}"`);
  lines.push(`    note: "${entry.note}"`);
  if (entry.x_user_id) lines.push(`    x_user_id: "${entry.x_user_id}"`);
  return lines.join('\n');
}

/** yaml 里已存在的 handle（小写）。 */
export function existingHandles(yaml) {
  const out = new Set();
  for (const match of yaml.matchAll(/^\s*- handle:\s*"?@?([\w-]+)"?\s*$/gm)) {
    out.add(match[1].toLowerCase());
  }
  return out;
}
