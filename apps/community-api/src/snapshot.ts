import { sha256Hex } from './lib/hash';
import { computeScore } from './lib/score';
import { listMaintainerEntries } from './maintainer-blocklist';
import { publicPolicy } from './reports';
import { POLICY } from './reports';
import { autoRateAccounts } from './rating';

export const SNAPSHOT_SCHEMA_VERSION = 2;
export const SNAPSHOT_PACK = 'official.json';
export const PUBLIC_BLOCKLIST_PACK = 'blocklist.yaml';

/** 单账号下发的指纹/域名证据上限，防快照膨胀 */
const MAX_EVIDENCE_PER_ENTRY = 5;
/** 证据门槛：一条指纹/域名至少要 2 个独立安装上报（reports 唯一索引保证一行 = 一个独立安装） */
const MIN_INSTALLS_FOR_EVIDENCE = 2;
/** 指纹簇（Campaign）：汉明距离 <= 此值视为同一话术的变体，归同一簇；< 2 个账号的簇不产生 campaign */
const SIMHASH_HAMMING_THRESHOLD = 2;
const MIN_CAMPAIGN_ACCOUNTS = 2;

export interface SnapshotEntry {
  handle: string;
  x_user_id: string | null;
  aliases: string[];
  category: string;
  sources: Array<'community' | 'maintainer'>;
  maintainer_note?: string;
  community_score: number;
  report_count: number;
  rescue_count: number;
  net_votes: number;
  first_seen_at: string;
  updated_at: string;
  evidence_post_ids: string[];
  fingerprints?: string[];
  domains?: string[];
  campaign_entry_id?: string;
  campaign_size?: number;
}

function hamming(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x !== 0n) {
    x &= x - 1n;
    n++;
  }
  return n;
}

/**
 * Campaign 聚类（v0.5）：按指纹汉明距离把账号归簇。
 *
 * - 输入：指纹 -> 上报该指纹的账号（已过 ≥2 安装门槛），+ 各账号 report_count
 * - 输出：account -> { entryId: 簇内 report_count 最高的账号, size: 簇内账号数 }
 * - 只有簇内 >= 2 个账号才产生 campaign（单账号无「网络」语义）
 * - 同一账号上报多个相近指纹时去重（防自环）
 * - 代表性：簇内证据最强的账号（report_count 最高；并列时 handle 字典序）
 *
 * 指纹是 SimHash 位向量（64bit hex），距离 <= 阈值视为同一话术模板的变体；
 * 簇 = 共享同一模板的账号集合，它们协同推送同一条垃圾内容 -> 一个 Campaign。
 * 快照代表条目（campaign_entry_id）由调用方对每个 account 反向填回。
 */
function clusterCampaigns(
  inputs: Map<string, string[]>,
  reportCounts: Map<string, number>,
): Map<string, { entryId: string; size: number }> {
  // 指纹 -> 去重账号集合（排序稳定）
  const fpAccounts = new Map<string, string[]>();
  for (const [fp, handles] of inputs) {
    const unique = [...new Set(handles)].sort();
    fpAccounts.set(fp, unique);
  }
  const fps = [...fpAccounts.keys()];
  const visitedFp = new Set<string>();
  const result = new Map<string, { entryId: string; size: number }>();

  for (let i = 0; i < fps.length; i++) {
    if (visitedFp.has(fps[i])) {
      continue;
    }
    // 当前簇：从本指纹出发，把彼此距离 <= 阈值的指纹的账号并入
    // （传递归簇：变体链 A-B-C，A 近 B、B 近 C 算一簇）
    const clusterFps = new Set<string>([fps[i]]);
    const clusterAccounts = new Set<string>(fpAccounts.get(fps[i])!);
    visitedFp.add(fps[i]);
    for (let j = i + 1; j < fps.length; j++) {
      if (visitedFp.has(fps[j])) {
        continue;
      }
      const near = [...clusterFps].some((f) => hamming(f, fps[j]) <= SIMHASH_HAMMING_THRESHOLD);
      if (near) {
        clusterFps.add(fps[j]);
        for (const h of fpAccounts.get(fps[j])!) {
          clusterAccounts.add(h);
        }
        visitedFp.add(fps[j]);
      }
    }
    if (clusterAccounts.size < MIN_CAMPAIGN_ACCOUNTS) {
      continue;
    }
    // 代表条目：簇内 report_count 最高（并列取 handle 字典序）
    const entryId = [...clusterAccounts].sort((a, b) => {
      const ra = reportCounts.get(a) ?? 0;
      const rb = reportCounts.get(b) ?? 0;
      return rb - ra || a.localeCompare(b);
    })[0];
    for (const account of clusterAccounts) {
      result.set(account, { entryId, size: clusterAccounts.size });
    }
  }
  return result;
}

interface AccountRow {
  handle: string;
  x_user_id: string | null;
  aliases: string;
  category: string;
  status: string;
  report_count: number;
  rescue_count: number;
  first_report_at: number;
  updated_at: number;
}

export interface SnapshotFile {
  path: string;
  sha256: string;
  entries: number;
  body: string; // 序列化好的最终 JSON，原样分发
}

export interface PublishedSnapshot {
  version: string;
  manifest: Record<string, unknown>;
  files: Record<string, SnapshotFile>;
}

function nextVersion(existing: string | null, dateStamp: string): string {
  if (existing && existing.startsWith(`${dateStamp}.`)) {
    const n = Number.parseInt(existing.split('.')[3] ?? '0', 10);
    return `${dateStamp}.${n + 1}`;
  }
  return `${dateStamp}.1`;
}

// 键按固定顺序写入（JS 字符串键保持插入序）+ 条目按 handle 排序 => 同一数据必然产出同字节 JSON
function buildEntry(
  row: AccountRow,
  evidence: string[],
  distinctDays: number,
  fingerprints: string[],
  domains: string[],
  campaign?: { entryId: string; size: number },
): SnapshotEntry {
  let aliases: string[] = [];
  try {
    const parsed = JSON.parse(row.aliases) as unknown;
    if (Array.isArray(parsed)) {
      aliases = parsed.filter((a): a is string => typeof a === 'string');
    }
  } catch {
    // 别名字段损坏时不阻塞快照
  }
  return {
    handle: row.handle,
    x_user_id: row.x_user_id,
    aliases,
    category: row.category,
    sources: ['community'],
    community_score: computeScore({
      reportCount: row.report_count,
      rescueCount: row.rescue_count,
      distinctDays,
    }),
    report_count: row.report_count,
    rescue_count: row.rescue_count,
    net_votes: row.report_count - row.rescue_count,
    first_seen_at: new Date(row.first_report_at * 1000).toISOString(),
    updated_at: new Date(row.updated_at * 1000).toISOString(),
    evidence_post_ids: evidence,
    // v0.4 内容证据：仅在有达标（≥2 独立安装）指纹/域名时携带
    ...(fingerprints.length > 0 ? { fingerprints } : {}),
    ...(domains.length > 0 ? { domains } : {}),
    // v0.5 Campaign：该条目所属簇的代表条目与规模（只在簇内 >= 2 账号时存在）
    ...(campaign ? { campaign_entry_id: campaign.entryId, campaign_size: campaign.size } : {}),
  };
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

/** 可读公开 YAML：只包含最终黑名单，不包含内部候选或匿名安装数据。 */
export function serializePublicBlocklistYaml(input: {
  version: string;
  generatedAt: string;
  entries: SnapshotEntry[];
}): string {
  const lines = [
    '# FeedSieve 公开社区黑名单',
    '# 拉黑仍需用户在扩展中明确点击；社区批量拉黑不会反向增加票数。',
    `schema_version: ${SNAPSHOT_SCHEMA_VERSION}`,
    `version: ${yamlString(input.version)}`,
    `generated_at: ${yamlString(input.generatedAt)}`,
    'rule:',
    '  formula: "block_votes - false_positive_votes"',
    `  min_net_votes: ${POLICY.communityNetThreshold}`,
    'summary:',
    `  accounts: ${input.entries.length}`,
  ];
  if (input.entries.length === 0) {
    lines.push('entries: []');
    return `${lines.join('\n')}\n`;
  }
  lines.push('entries:');
  for (const entry of input.entries) {
    lines.push(
      `  - handle: ${yamlString(entry.handle)}`,
      `    x_user_id: ${entry.x_user_id ? yamlString(entry.x_user_id) : 'null'}`,
      `    category: ${yamlString(entry.category)}`,
      `    sources: [${entry.sources.map(yamlString).join(', ')}]`,
      '    votes:',
      `      block: ${entry.report_count}`,
      `      false_positive: ${entry.rescue_count}`,
      `      net: ${entry.net_votes}`,
    );
    if (entry.maintainer_note) {
      lines.push(`    maintainer_note: ${yamlString(entry.maintainer_note)}`);
    }
    lines.push(
      `    first_seen_at: ${yamlString(entry.first_seen_at)}`,
      `    updated_at: ${yamlString(entry.updated_at)}`,
    );
    if (entry.evidence_post_ids.length === 0) {
      lines.push('    evidence_post_ids: []');
    } else {
      lines.push('    evidence_post_ids:');
      for (const id of entry.evidence_post_ids) lines.push(`      - ${yamlString(id)}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

async function collectEvidence(env: Cloudflare.Env, handle: string): Promise<string[]> {
  const res = await env.DB.prepare(
    `SELECT DISTINCT r.evidence_post_id
     FROM reports r
     JOIN active_labels l
       ON l.installation_id = r.installation_id
      AND l.handle = r.handle
      AND l.label = 'blocked'
     WHERE r.handle = ?1 AND r.evidence_post_id IS NOT NULL LIMIT 5`,
  )
    .bind(handle)
    .all<{ evidence_post_id: string }>();
  return res.results.map((r) => r.evidence_post_id);
}

/**
 * 内容证据聚合（v0.4）：指纹/域名只在「≥2 个独立安装上报」时随条目下发。
 * 门槛的意义：单人重复上报制造不出指纹/域名证据，误拉黑也污染不了名单。
 * 每账号取安装数最高的前 5 条，最终按字典序排序保证确定性 JSON。
 */
async function collectContentEvidence(env: Cloudflare.Env): Promise<{
  fingerprintsByHandle: Map<string, string[]>;
  domainsByHandle: Map<string, string[]>;
}> {
  const fpRows = await env.DB.prepare(
    `SELECT r.handle, r.content_fingerprint AS fp
     FROM reports r
     JOIN active_labels l
       ON l.installation_id = r.installation_id
      AND l.handle = r.handle
      AND l.label = 'blocked'
     WHERE r.content_fingerprint IS NOT NULL
     GROUP BY r.handle, r.content_fingerprint
     HAVING COUNT(*) >= ?1
     ORDER BY r.handle ASC, COUNT(*) DESC, r.content_fingerprint ASC`,
  )
    .bind(MIN_INSTALLS_FOR_EVIDENCE)
    .all<{ handle: string; fp: string }>();
  const fingerprintsByHandle = new Map<string, string[]>();
  for (const row of fpRows.results) {
    const list = fingerprintsByHandle.get(row.handle) ?? [];
    if (list.length < MAX_EVIDENCE_PER_ENTRY) {
      list.push(row.fp);
      fingerprintsByHandle.set(row.handle, list);
    }
  }
  for (const list of fingerprintsByHandle.values()) {
    list.sort();
  }

  const domainRows = await env.DB.prepare(
    `SELECT r.handle, r.link_domains
     FROM reports r
     JOIN active_labels l
       ON l.installation_id = r.installation_id
      AND l.handle = r.handle
      AND l.label = 'blocked'
     WHERE r.link_domains IS NOT NULL`,
  ).all<{ handle: string; link_domains: string }>();
  const domainCounts = new Map<string, Map<string, number>>();
  for (const row of domainRows.results) {
    try {
      const parsed = JSON.parse(row.link_domains) as unknown;
      if (!Array.isArray(parsed)) {
        continue;
      }
      const byDomain = domainCounts.get(row.handle) ?? new Map<string, number>();
      for (const d of parsed) {
        if (typeof d === 'string' && d) {
          byDomain.set(d, (byDomain.get(d) ?? 0) + 1);
        }
      }
      domainCounts.set(row.handle, byDomain);
    } catch {
      // 单行 link_domains 损坏不阻塞快照
    }
  }
  const domainsByHandle = new Map<string, string[]>();
  for (const [handle, byDomain] of domainCounts) {
    const top = [...byDomain.entries()]
      .filter(([, installs]) => installs >= MIN_INSTALLS_FOR_EVIDENCE)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, MAX_EVIDENCE_PER_ENTRY)
      .map(([domain]) => domain)
      .sort();
    if (top.length > 0) {
      domainsByHandle.set(handle, top);
    }
  }

  return { fingerprintsByHandle, domainsByHandle };
}

export async function generateSnapshot(
  env: Cloudflare.Env,
  publishAttempt = 0,
): Promise<PublishedSnapshot> {
  const now = new Date();
  const dateStamp = now.toISOString().slice(0, 10).replaceAll('-', '.');

  // 出快照前按唯一净票公式收敛历史状态字段。
  await autoRateAccounts(env);

  const latest = await env.DB.prepare(
    `SELECT version FROM snapshots
     WHERE version LIKE ?1
     ORDER BY CAST(substr(version, 12) AS INTEGER) DESC
     LIMIT 1`,
  )
    .bind(`${dateStamp}.%`)
    .first<{ version: string }>();
  const version = nextVersion(latest?.version ?? null, dateStamp);

  const accounts = await env.DB.prepare(
    `SELECT handle, x_user_id, aliases, category, status, report_count, rescue_count,
            first_report_at, updated_at
     FROM accounts
     WHERE report_count - rescue_count >= ?1
     ORDER BY handle ASC`,
  )
    .bind(POLICY.communityNetThreshold)
    .all<AccountRow>();

  const entries: SnapshotEntry[] = [];
  const dayRows = await env.DB.prepare(
    `SELECT r.handle, COUNT(DISTINCT date(r.created_at, 'unixepoch')) AS days
     FROM reports r
     JOIN active_labels l
       ON l.installation_id = r.installation_id
      AND l.handle = r.handle
      AND l.label = 'blocked'
     GROUP BY r.handle`,
  ).all<{ handle: string; days: number }>();
  const daysByHandle = new Map(dayRows.results.map((r) => [r.handle, r.days] as const));
  const allAccountRows = await env.DB.prepare(
    `SELECT handle, x_user_id, aliases, category, status, report_count, rescue_count,
            first_report_at, updated_at
     FROM accounts`,
  ).all<AccountRow>();
  const accountByHandle = new Map(allAccountRows.results.map((row) => [row.handle, row] as const));
  const reportCounts = new Map(
    allAccountRows.results.map((row) => [row.handle, row.report_count] as const),
  );
  const { fingerprintsByHandle, domainsByHandle } = await collectContentEvidence(env);
  // 指纹簇（Campaign）：每个指纹的账号（已达标），汉明距离归簇
  const evidenceFpAccounts = new Map<string, string[]>();
  for (const [handle, fps] of fingerprintsByHandle) {
    for (const fp of fps) {
      const list = evidenceFpAccounts.get(fp) ?? [];
      list.push(handle);
      evidenceFpAccounts.set(fp, list);
    }
  }
  const campaigns = clusterCampaigns(evidenceFpAccounts, reportCounts);
  for (const row of accounts.results) {
    const evidence = await collectEvidence(env, row.handle);
    const campaign = campaigns.get(row.handle);
    entries.push(
      buildEntry(
        row,
        evidence,
        daysByHandle.get(row.handle) ?? 1,
        fingerprintsByHandle.get(row.handle) ?? [],
        domainsByHandle.get(row.handle) ?? [],
        campaign,
      ),
    );
  }

  // 维护者条目是独立、透明来源，不制造社区票数。与社区条目重复时合并来源。
  const byHandle = new Map(entries.map((entry) => [entry.handle, entry] as const));
  for (const maintained of await listMaintainerEntries(env)) {
    const existing = byHandle.get(maintained.handle);
    if (existing) {
      if (!existing.sources.includes('maintainer')) existing.sources.push('maintainer');
      existing.maintainer_note = maintained.note;
      existing.category = maintained.category;
      if (maintained.x_user_id) existing.x_user_id = maintained.x_user_id;
      if (
        maintained.evidence_post_id &&
        !existing.evidence_post_ids.includes(maintained.evidence_post_id)
      ) {
        existing.evidence_post_ids.push(maintained.evidence_post_id);
        existing.evidence_post_ids.sort();
      }
      existing.updated_at = new Date(
        Math.max(Date.parse(existing.updated_at), maintained.updated_at * 1000),
      ).toISOString();
      continue;
    }
    const belowThresholdAccount = accountByHandle.get(maintained.handle);
    const entry: SnapshotEntry = belowThresholdAccount
      ? buildEntry(
          belowThresholdAccount,
          await collectEvidence(env, maintained.handle),
          daysByHandle.get(maintained.handle) ?? 1,
          fingerprintsByHandle.get(maintained.handle) ?? [],
          domainsByHandle.get(maintained.handle) ?? [],
          campaigns.get(maintained.handle),
        )
      : {
          handle: maintained.handle,
          x_user_id: maintained.x_user_id,
          aliases: [],
          category: maintained.category,
          sources: ['maintainer'],
          community_score: 0,
          report_count: 0,
          rescue_count: 0,
          net_votes: 0,
          first_seen_at: new Date(maintained.created_at * 1000).toISOString(),
          updated_at: new Date(maintained.updated_at * 1000).toISOString(),
          evidence_post_ids: [],
        };
    entry.sources = ['maintainer'];
    entry.maintainer_note = maintained.note;
    entry.category = maintained.category;
    if (maintained.x_user_id) entry.x_user_id = maintained.x_user_id;
    entry.first_seen_at = new Date(
      Math.min(Date.parse(entry.first_seen_at), maintained.created_at * 1000),
    ).toISOString();
    entry.updated_at = new Date(
      Math.max(Date.parse(entry.updated_at), maintained.updated_at * 1000),
    ).toISOString();
    if (
      maintained.evidence_post_id &&
      !entry.evidence_post_ids.includes(maintained.evidence_post_id)
    ) {
      entry.evidence_post_ids.push(maintained.evidence_post_id);
      entry.evidence_post_ids.sort();
    }
    entries.push(entry);
    byHandle.set(entry.handle, entry);
  }
  entries.sort((a, b) => a.handle.localeCompare(b.handle));

  const generatedAt = now.toISOString();
  const body = `${JSON.stringify(
    {
      schema_version: SNAPSHOT_SCHEMA_VERSION,
      policy_version: 3,
      snapshot_version: version,
      generated_at: generatedAt,
      entries,
    },
    null,
    2,
  )}\n`;

  const machineFile: SnapshotFile = {
    path: SNAPSHOT_PACK,
    sha256: await sha256Hex(body),
    entries: entries.length,
    body,
  };
  const yamlBody = serializePublicBlocklistYaml({ version, generatedAt, entries });
  const yamlFile: SnapshotFile = {
    path: PUBLIC_BLOCKLIST_PACK,
    sha256: await sha256Hex(yamlBody),
    entries: entries.length,
    body: yamlBody,
  };

  const manifest = {
    schema_version: SNAPSHOT_SCHEMA_VERSION,
    policy_version: 3,
    snapshot_version: version,
    generated_at: generatedAt,
    policy: publicPolicy(),
    files: [machineFile, yamlFile].map((file) => ({
      path: file.path,
      sha256: file.sha256,
      entries: file.entries,
    })),
  };

  // 内容无变化则复用最新版本（cron 每小时跑，避免空转刷版本号）。
  // 比较 entries 内容（body 里的 generated_at 每次不同，不能整串比较）。
  const lastVersion = latest?.version ?? null;
  const lastBody = lastVersion ? await getSnapshotFile(env, lastVersion, SNAPSHOT_PACK) : null;
  if (lastBody && entriesContentEqual(lastBody, entries)) {
    const lastRow = await env.DB.prepare(
      'SELECT manifest_json, files_json FROM snapshots WHERE version = ?1',
    )
      .bind(lastVersion as string)
      .first<{ manifest_json: string; files_json: string }>();
    if (lastRow) {
      return {
        version: lastVersion as string,
        manifest: JSON.parse(lastRow.manifest_json),
        files: JSON.parse(lastRow.files_json) as Record<string, SnapshotFile>,
      };
    }
  }

  const inserted = await env.DB.prepare(
    `INSERT OR IGNORE INTO snapshots (version, manifest_json, files_json, created_at)
     VALUES (?1, ?2, ?3, ?4)`,
  )
    .bind(
      version,
      `${JSON.stringify(manifest, null, 2)}\n`,
      JSON.stringify({
        [machineFile.path]: machineFile,
        [yamlFile.path]: yamlFile,
      }),
      Math.floor(now.getTime() / 1000),
    )
    .run();

  // 两个请求可能同时读取到同一 latest 版本。D1 只允许一个写入；另一个重读最新
  // 内容，若内容已一致会直接复用，否则分配下一个序号。避免真实三票并发时返回 500。
  if ((inserted.meta.changes ?? 0) === 0) {
    if (publishAttempt >= 20) {
      throw new Error('snapshot_publish_contention');
    }
    return generateSnapshot(env, publishAttempt + 1);
  }

  return {
    version,
    manifest,
    files: {
      [machineFile.path]: machineFile,
      [yamlFile.path]: yamlFile,
    },
  };
}

/** 两次快照的 entries 内容是否相同（忽略 generated_at / 版本号等元信息）。 */
function entriesContentEqual(lastBody: string, currentEntries: unknown[]): boolean {
  let last: { schema_version?: number; policy_version?: number; entries?: unknown[] };
  try {
    last = JSON.parse(lastBody) as {
      schema_version?: number;
      policy_version?: number;
      entries?: unknown[];
    };
  } catch {
    return false;
  }
  if (
    last.schema_version !== SNAPSHOT_SCHEMA_VERSION ||
    last.policy_version !== 3 ||
    !Array.isArray(last.entries)
  ) {
    return false;
  }
  return JSON.stringify(last.entries) === JSON.stringify(currentEntries);
}

export async function getLatestSnapshot(env: Cloudflare.Env): Promise<{ manifest: string } | null> {
  const row = await env.DB.prepare(
    `SELECT manifest_json FROM snapshots
     ORDER BY substr(version, 1, 10) DESC, CAST(substr(version, 12) AS INTEGER) DESC
     LIMIT 1`,
  ).first<{ manifest_json: string }>();
  return row ? { manifest: row.manifest_json } : null;
}

export async function getSnapshotFile(
  env: Cloudflare.Env,
  version: string,
  path: string,
): Promise<string | null> {
  if (
    !/^\d{4}\.\d{2}\.\d{2}\.\d{1,4}$/.test(version) ||
    ![SNAPSHOT_PACK, PUBLIC_BLOCKLIST_PACK].includes(path)
  ) {
    return null;
  }
  const row = await env.DB.prepare('SELECT files_json FROM snapshots WHERE version = ?1')
    .bind(version)
    .first<{ files_json: string }>();
  if (!row) return null;
  const files = JSON.parse(row.files_json) as Record<string, SnapshotFile>;
  return files[path]?.body ?? null;
}

export async function getLatestSnapshotFile(
  env: Cloudflare.Env,
  path: typeof SNAPSHOT_PACK | typeof PUBLIC_BLOCKLIST_PACK,
): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT files_json FROM snapshots
     ORDER BY substr(version, 1, 10) DESC, CAST(substr(version, 12) AS INTEGER) DESC
     LIMIT 1`,
  ).first<{ files_json: string }>();
  if (!row) return null;
  const files = JSON.parse(row.files_json) as Record<string, SnapshotFile>;
  return files[path]?.body ?? null;
}
