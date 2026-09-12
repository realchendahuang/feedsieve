/**
 * 社区抢救 → 推荐白名单快速通道（维护者本地手动跑，无 CI）：
 * 拉最新签名快照里的抢救名单（verified = 误标票被推翻的账号），整批生成
 * whitespace 入册候选块，追加到本地 community/lists/whitelist.yaml；已入册的
 * handle 自动跳过。跑完看 diff，确认后跑 scripts/publish-community-whitelist.sh
 * 才真正写库发布（自动出快照，扩展+公示页同时生效）。
 *
 * note 自动文案化公开问责口径：「社区抢救入册：X 票共识推翻误标（净票 +N · 快照 <版本>）」。
 * 想换更体面的简介可以发布前手改那一行——文件仍是唯一事实。
 *
 * 用法：
 *   node scripts/promote-rescued-whitelist.mjs --dry-run   # 只评估
 *   node scripts/promote-rescued-whitelist.mjs             # 拉取 + 追加
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { entryBlock } from './ingest-whitelist-issues.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const SOURCE_FILE = 'community/lists/whitelist.yaml';
const DEFAULT_SOURCE = 'https://feedsieve.win/v1/roster/latest';

/** 从 roster 快照收敛候选：verified 全量 → {handle, note}；调用方负责去重。 */
export function planEntries(roster) {
  const out = [];
  for (const verified of roster?.whitelist?.verified ?? []) {
    if (typeof verified.handle !== 'string' || /^[A-Za-z0-9_]{1,15}$/.test(verified.handle) === false) continue;
    const net = Math.trunc(verified.net_votes ?? 0);
    const rescueCount = Math.trunc(verified.rescue_count ?? 0);
    const version = roster?.snapshot_version ?? '';
    out.push({
      handle: verified.handle.toLowerCase(),
      note: `社区抢救入册：${rescueCount} 票共识推翻误标（净票 +${net} · 快照 ${version}）`,
    });
  }
  return out;
}

/** yaml 里已存在的 handle（小写）。 */
function existingHandles(yaml) {
  const out = new Set();
  for (const match of yaml.matchAll(/^\s*- handle:\s*"?@?([\w-]+)"?\s*$/gm)) {
    out.add(match[1].toLowerCase());
  }
  return out;
}

export async function main({ dryRun = false, sourceUrl = DEFAULT_SOURCE } = {}) {
  const res = await fetch(sourceUrl);
  if (!res.ok) {
    console.error(`roster 拉取失败：HTTP ${res.status}（${sourceUrl}）`);
    process.exit(1);
  }
  const roster = await res.json();
  const all = planEntries(roster);

  const abs = path.join(ROOT, SOURCE_FILE);
  const yaml = readFileSync(abs, 'utf8');
  const taken = existingHandles(yaml);
  const fresh = all.filter((e) => !taken.has(e.handle));
  const skipped = all.length - fresh.length;

  if (dryRun) {
    console.log(`抢救 ${all.length} 条 · 已入册 ${skipped} 条 · 本轮新增 ${fresh.length} 条（快照 ${roster?.snapshot_version}）`);
    for (const entry of fresh) console.log(`[dry] + @${entry.handle} · ${entry.note}`);
    return { fresh: fresh.length, skipped, snapshot: roster?.snapshot_version };
  }

  if (fresh.length === 0) {
    console.log(`没有需要新增的（抢救 ${all.length} 条均已入册，快照 ${roster?.snapshot_version}）`);
    return { fresh: 0, skipped, snapshot: roster?.snapshot_version };
  }

  const block = fresh.map((entry) => `# 社区抢救迁移\n${entryBlock(entry)}`).join('\n');
  writeFileSync(abs, `${yaml.replace(/\s*$/, '')}\n${block}\n`);
  console.log(`已写入 ${fresh.length} 条候选到 ${SOURCE_FILE}（跳过已入册 ${skipped} 条）。\n下一步：看 diff → sh scripts/publish-community-whitelist.sh`);
  return { fresh: fresh.length, skipped, snapshot: roster?.snapshot_version };
}

// 直接执行才跑主流程
if (process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`) {
  const args = process.argv.slice(2);
  await main({ dryRun: args.includes('--dry-run') });
}
