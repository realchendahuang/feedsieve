import { sha256Hex } from './lib/hash';
import { computeScore } from './lib/score';
import {
  buildSigningMessage,
  signManifestMessage,
  type ManifestSignature,
  type VerifiedEntry,
} from '@feedsieve/community-lists';
import { listMaintainerEntries } from './maintainer-blocklist';
import { publicPolicy } from './reports';
import { POLICY } from './reports';
import { autoRateAccounts } from './rating';
import { loadCommunityAggregates } from './lib/consensus-v2';

export const SNAPSHOT_SCHEMA_VERSION = 2;
export const SNAPSHOT_PACK = 'official.json';
export const PUBLIC_BLOCKLIST_PACK = 'blocklist.yaml';

/** 指纹簇（Campaign）：汉明距离 <= 此值视为同一话术的变体，归同一簇；< 2 个账号的簇不产生 campaign */
const SIMHASH_HAMMING_THRESHOLD = 2;
const MIN_CAMPAIGN_ACCOUNTS = 2;

/**
 * 快照 R2 分发前缀（与词库 keyword-packs/ 同桶分域）。
 * 快照文件是 write-once 发布物：版本化文件不可变缓存 + latest 指针文件。
 * 读路径优先 R2（零 D1 行读），D1 files_json 保留为归档回退；latest 指针
 * 存 meta 表供 O(1) 点读，取代每次轮询的全表排序扫。
 */
const SNAPSHOT_R2_PREFIX = 'snapshots';
const SNAPSHOT_LATEST_KEY = 'latest_snapshot_version';

async function r2Text(env: Cloudflare.Env, key: string): Promise<string | null> {
  const object = await env.KEYWORD_PACKS?.get(key);
  if (!object) return null;
  return object.text();
}

/** 快照文件分发到 R2（对齐词库发布模式）。 */
async function publishSnapshotToR2(
  env: Cloudflare.Env,
  version: string,
  machineFile: SnapshotFile,
  yamlFile: SnapshotFile,
  manifest: Record<string, unknown>,
): Promise<void> {
  if (!env.KEYWORD_PACKS) return;
  await Promise.all([
    env.KEYWORD_PACKS.put(`${SNAPSHOT_R2_PREFIX}/${version}/${SNAPSHOT_PACK}`, machineFile.body),
    env.KEYWORD_PACKS.put(
      `${SNAPSHOT_R2_PREFIX}/${version}/${PUBLIC_BLOCKLIST_PACK}`,
      yamlFile.body,
    ),
    env.KEYWORD_PACKS.put(`${SNAPSHOT_R2_PREFIX}/latest.json`, machineFile.body),
    env.KEYWORD_PACKS.put(`${SNAPSHOT_R2_PREFIX}/latest.yaml`, yamlFile.body),
    env.KEYWORD_PACKS.put(
      `${SNAPSHOT_R2_PREFIX}/latest-manifest.json`,
      `${JSON.stringify(manifest, null, 2)}\n`,
    ),
  ]);
}

/** 记录最新版本指针（meta 表，O(1) 点读）。 */
async function setLatestSnapshotPointer(env: Cloudflare.Env, version: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO meta (key, value) VALUES (?1, ?2)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  )
    .bind(SNAPSHOT_LATEST_KEY, version)
    .run();
}

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
  /** 当日一版守卫命中：内容有变化但今天已发布过，未落新行（调用方应保留脏标记待次日）。 */
  deferred?: boolean;
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

/** kill_switch 载荷构造（纯函数，便于单测；reason 为空串/空白视为未设置）。 */
export function buildKillSwitch(
  reason: string | undefined,
  disabledSince: string,
): { destructive_actions_disabled: true; reason: string; disabled_since: string } | undefined {
  const trimmed = reason?.trim();
  if (!trimmed) {
    return undefined;
  }
  return { destructive_actions_disabled: true, reason: trimmed, disabled_since: disabledSince };
}

export async function generateSnapshot(
  env: Cloudflare.Env,
  publishAttempt = 0,
  options: { bypassDailyOnce?: boolean } = {},
): Promise<PublishedSnapshot> {
  // 签名可用性 fail fast（同 keyword-admin 的 assertKeywordSigningAvailable）：
  // REQUIRE_SIGNED_SNAPSHOTS=1 时扩展只认已签名快照，静默发布无签名版本等于假
  // 发布。让误配在 cron 日志炸出来（脏标记保留、下小时重试），而不是顶上一份
  // 必被扩展拒绝的 latest。
  if (env.REQUIRE_SIGNED_SNAPSHOTS === '1' && (!env.SIGNING_PRIVATE_KEY || !env.SIGNING_KEY_ID)) {
    throw new Error('signing_key_missing');
  }

  const now = new Date();
  const dateStamp = now.toISOString().slice(0, 10).replaceAll('-', '.');

  // 社区聚合一次跑完（day/fp/domain/evidence + v2 影子输入），供本函数与
  // autoRateAccounts 共用：同一趟 cron 内每类聚合只扫一遍 reports/active_labels。
  const aggregates = await loadCommunityAggregates(env);
  // 出快照前按唯一净票公式收敛历史状态字段。
  await autoRateAccounts(env, aggregates);

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

  // 社区白名单（verified）：入榜公式与黑名单严格镜像——抢救净票 >= 同一阈值。
  // rescue_count/report_count 由 refreshAccountsFromLabels 收敛（active_labels 计票），
  // 与黑名单入榜 SQL 同源，无独立安装/跨天二次筛选（COMMUNITY_FILTERING 口径一致）。
  const verifiedRows = await env.DB.prepare(
    `SELECT handle, x_user_id, report_count, rescue_count, first_report_at, updated_at
     FROM accounts
     WHERE rescue_count - report_count >= ?1
     ORDER BY handle ASC`,
  )
    .bind(POLICY.communityNetThreshold)
    .all<{
      handle: string;
      x_user_id: string | null;
      report_count: number;
      rescue_count: number;
      first_report_at: number;
      updated_at: number;
    }>();
  const verified: VerifiedEntry[] = verifiedRows.results.map((row) => ({
    handle: row.handle,
    x_user_id: row.x_user_id,
    rescue_count: row.rescue_count,
    report_count: row.report_count,
    net_votes: row.rescue_count - row.report_count,
    first_seen_at: new Date(row.first_report_at * 1000).toISOString(),
    updated_at: new Date(row.updated_at * 1000).toISOString(),
  }));

  const entries: SnapshotEntry[] = [];
  const daysByHandle = aggregates.daysByHandle;
  const allAccountRows = await env.DB.prepare(
    `SELECT handle, x_user_id, aliases, category, status, report_count, rescue_count,
            first_report_at, updated_at
     FROM accounts`,
  ).all<AccountRow>();
  const accountByHandle = new Map(allAccountRows.results.map((row) => [row.handle, row] as const));
  const reportCounts = new Map(
    allAccountRows.results.map((row) => [row.handle, row.report_count] as const),
  );
  const { fingerprintsByHandle, domainsByHandle } = aggregates;
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
  const evidenceByHandle = aggregates.evidenceByHandle;
  for (const row of accounts.results) {
    const evidence = evidenceByHandle.get(row.handle) ?? [];
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
  // 但 verified（抢救成功的正常账号）优先于维护者黑名单：客户端 validate.ts
  // 对 handle 同时出现在 entries 与 verified 会整份拒绝（duplicate_snapshot_handle），
  // 所以命中 verified 的维护者条目必须让位，黑名单不收录。
  const verifiedHandles = new Set(verified.map((entry) => entry.handle));
  const byHandle = new Map(entries.map((entry) => [entry.handle, entry] as const));
  for (const maintained of await listMaintainerEntries(env)) {
    if (verifiedHandles.has(maintained.handle)) continue;
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
          evidenceByHandle.get(maintained.handle) ?? [],
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
  // 官方破坏性动作暂停开关：部署配置里设置了 DESTRUCTIVE_KILL_SWITCH（理由）即下发；
  // 随签名快照分发，扩展验签后执行 —— 只能关闭拉黑，不能开启任何自动动作。
  const killSwitch = buildKillSwitch(env.DESTRUCTIVE_KILL_SWITCH, generatedAt);
  const body = `${JSON.stringify(
    {
      schema_version: SNAPSHOT_SCHEMA_VERSION,
      policy_version: 3,
      snapshot_version: version,
      generated_at: generatedAt,
      entries,
      ...(verified.length > 0 ? { verified } : {}),
      ...(killSwitch ? { kill_switch: killSwitch } : {}),
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
  } as Record<string, unknown>;

  // 发布者签名：manifest 一旦落库即签名，公开端点只在签名行存在时下发。
  // 私钥来自部署配置（gitignored wrangler.local.jsonc / wrangler secret），
  // 不进 R2；即使 R2/存储被整体替换，扩展也会因验签失败而拒绝。
  let signatureJson: string | null = null;
  if (env.SIGNING_PRIVATE_KEY && env.SIGNING_KEY_ID) {
    const message = buildSigningMessage({
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      version,
      generatedAt,
      files: [machineFile, yamlFile].map((file) => ({
        path: file.path,
        sha256: file.sha256,
        count: file.entries,
      })),
    });
    const sig = await signManifestMessage(message, env.SIGNING_PRIVATE_KEY, env.SIGNING_KEY_ID);
    manifest.signature = sig;
    signatureJson = JSON.stringify(sig satisfies ManifestSignature);
  }

  // 内容无变化则复用最新版本（cron 每小时跑，避免空转刷版本号）。
  // 比较 entries 内容（body 里的 generated_at 每次不同，不能整串比较）。
  // kill_switch 也参与比较：开关翻转（开/关/理由变更）必须产生新版本，不能复用旧 body。
  const lastVersion = latest?.version ?? null;
  const loadLatestRow = () =>
    lastVersion
      ? env.DB.prepare('SELECT manifest_json, files_json FROM snapshots WHERE version = ?1')
          .bind(lastVersion)
          .first<{ manifest_json: string; files_json: string }>()
      : Promise.resolve(null);
  const lastBody = lastVersion ? await getSnapshotFile(env, lastVersion, SNAPSHOT_PACK) : null;
  if (lastBody && entriesContentEqual(lastBody, entries, verified, killSwitch)) {
    const lastRow = await loadLatestRow();
    if (lastRow) {
      return {
        version: lastVersion as string,
        manifest: JSON.parse(lastRow.manifest_json),
        files: JSON.parse(lastRow.files_json) as Record<string, SnapshotFile>,
      };
    }
  }

  // 当日一版守卫：今天已发布过、内容又有变化时不再 mint 新版本，延迟到下一个自然日
  // 由 cron 合并发布（版本号是 YYYY.MM.DD.N 天锚格式，天然支持日更语义）。
  // 调用方（scheduled）看到 deferred 会保留脏标记；维护者显式发布走 bypassDailyOnce 即时通道。
  if (lastVersion && !options.bypassDailyOnce) {
    const lastRow = await loadLatestRow();
    if (lastRow) {
      return {
        version: lastVersion as string,
        manifest: JSON.parse(lastRow.manifest_json),
        files: JSON.parse(lastRow.files_json) as Record<string, SnapshotFile>,
        deferred: true,
      };
    }
  }

  const inserted = await env.DB.prepare(
    `INSERT OR IGNORE INTO snapshots (version, manifest_json, signature_json, files_json, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5)`,
  )
    .bind(
      version,
      `${JSON.stringify(manifest, null, 2)}\n`,
      signatureJson,
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
    return generateSnapshot(env, publishAttempt + 1, options);
  }

  // 最新版本指针：latest 轮询从全表排序扫降为 O(1) 点读（写入失败无妨，读端回退排序扫）
  await setLatestSnapshotPointer(env, version);
  // R2 分发：失败不阻断发布（D1 仍权威，读端自动回退 files_json）
  await publishSnapshotToR2(env, version, machineFile, yamlFile, manifest).catch((error) => {
    console.error('[community-api] snapshot R2 publish failed:', error);
  });

  return {
    version,
    manifest,
    files: {
      [machineFile.path]: machineFile,
      [yamlFile.path]: yamlFile,
    },
  };
}

/** 两次快照的 entries、verified 与 kill_switch 是否相同（忽略 generated_at / 版本号等元信息）。 */
function entriesContentEqual(
  lastBody: string,
  currentEntries: unknown[],
  currentVerified: unknown[],
  currentKillSwitch?: { destructive_actions_disabled: true; reason?: string; disabled_since?: string },
): boolean {
  let last: {
    schema_version?: number;
    policy_version?: number;
    entries?: unknown[];
    verified?: unknown[];
    kill_switch?: unknown;
  };
  try {
    last = JSON.parse(lastBody) as {
      schema_version?: number;
      policy_version?: number;
      entries?: unknown[];
      verified?: unknown[];
      kill_switch?: unknown;
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
  if (last.kill_switch === undefined && currentKillSwitch !== undefined) return false;
  if (JSON.stringify(last.kill_switch) !== JSON.stringify(currentKillSwitch)) return false;
  if (JSON.stringify(last.entries) !== JSON.stringify(currentEntries)) return false;
  // 白名单也参与内容复用判断：verified 变化必须产生新版本，不能复用旧 body
  return JSON.stringify(last.verified ?? []) === JSON.stringify(currentVerified);
}

/**
 * 读取最新快照行：优先 meta 指针点读（O(1)），无指针时回退排序扫
 * （数据迁移期 / 指针缺失兜底）。requireSigned 时只取已签名行。
 */
async function latestSnapshotRow(env: Cloudflare.Env): Promise<{
  version: string;
  manifest_json: string;
  files_json: string;
  created_at: number;
} | null> {
  const requireSigned = env.REQUIRE_SIGNED_SNAPSHOTS === '1';
  const signedWhere = requireSigned ? ' AND signature_json IS NOT NULL' : '';
  const pointer = await env.DB.prepare('SELECT value FROM meta WHERE key = ?1')
    .bind(SNAPSHOT_LATEST_KEY)
    .first<{ value: string }>();
  if (pointer) {
    const row = await env.DB.prepare(
      `SELECT version, manifest_json, files_json, created_at FROM snapshots
       WHERE version = ?1${signedWhere}`,
    )
      .bind(pointer.value)
      .first<{ version: string; manifest_json: string; files_json: string; created_at: number }>();
    if (row) return row;
  }
  return env.DB.prepare(
    `SELECT version, manifest_json, files_json, created_at FROM snapshots
     ${requireSigned ? 'WHERE signature_json IS NOT NULL' : ''}
     ORDER BY substr(version, 1, 10) DESC, CAST(substr(version, 12) AS INTEGER) DESC
     LIMIT 1`,
  ).first<{ version: string; manifest_json: string; files_json: string; created_at: number }>();
}

export async function getLatestSnapshot(env: Cloudflare.Env): Promise<{ manifest: string } | null> {
  // 快路径：R2 latest-manifest（发布时写入，命中即零 D1 读取）
  if (env.REQUIRE_SIGNED_SNAPSHOTS !== '1') {
    const r2Manifest = await r2Text(env, `${SNAPSHOT_R2_PREFIX}/latest-manifest.json`);
    if (r2Manifest !== null) {
      return { manifest: r2Manifest };
    }
  }
  const row = await latestSnapshotRow(env);
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
  // 快路径：R2 版本化文件（不可变缓存）。requireSigned 时文件本身不携带签名信息，
  // 校验语义在 manifest（latestSnapshotRow 已按 signature 过滤），这里仍走 D1 点读。
  if (env.REQUIRE_SIGNED_SNAPSHOTS !== '1') {
    const r2Body = await r2Text(env, `${SNAPSHOT_R2_PREFIX}/${version}/${path}`);
    if (r2Body !== null) {
      return r2Body;
    }
  }
  const requireSigned = env.REQUIRE_SIGNED_SNAPSHOTS === '1';
  const row = await env.DB.prepare(
    `SELECT files_json FROM snapshots WHERE version = ?1
     ${requireSigned ? 'AND signature_json IS NOT NULL' : ''}`,
  )
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
  // 快路径：R2 latest 指针文件（blocklist/latest.json|.yaml = 最新文件体）
  if (env.REQUIRE_SIGNED_SNAPSHOTS !== '1') {
    const latestKey =
      path === PUBLIC_BLOCKLIST_PACK
        ? `${SNAPSHOT_R2_PREFIX}/latest.yaml`
        : `${SNAPSHOT_R2_PREFIX}/latest.json`;
    const r2Body = await r2Text(env, latestKey);
    if (r2Body !== null) {
      return r2Body;
    }
  }
  const row = await latestSnapshotRow(env);
  if (!row) return null;
  const files = JSON.parse(row.files_json) as Record<string, SnapshotFile>;
  return files[path]?.body ?? null;
}

/** 概览页所需的最新快照元信息（版本 / 生成时间 / 公开条目数 / 落后秒数）。 */
export interface LatestSnapshotMeta {
  version: string;
  /** unix 秒 */
  generated_at: number;
  /** 公开名单条目数（machine file），与客户端实际下载量一致。 */
  entries: number;
  lag_seconds: number;
}

export async function getLatestSnapshotMeta(env: Cloudflare.Env): Promise<LatestSnapshotMeta | null> {
  const row = await latestSnapshotRow(env);
  if (!row) return null;
  try {
    const manifest = JSON.parse(row.manifest_json) as { snapshot_version?: unknown };
    const files = JSON.parse(row.files_json) as Record<string, SnapshotFile>;
    return {
      version: typeof manifest.snapshot_version === 'string' ? manifest.snapshot_version : '',
      generated_at: row.created_at,
      entries: files[SNAPSHOT_PACK]?.entries ?? 0,
      lag_seconds: Math.max(0, Math.floor(Date.now() / 1000) - row.created_at),
    };
  } catch {
    return null;
  }
}

/** 只读最新版本号：异步化后上报路径立即返回当前有效版本，不等新快照生成。 */
export async function getLatestSnapshotVersion(env: Cloudflare.Env): Promise<string | null> {
  // O(1) 点读 meta 指针（POST 路径每批调用一次，不再全表排序扫 snapshots）
  const pointer = await env.DB.prepare('SELECT value FROM meta WHERE key = ?1')
    .bind(SNAPSHOT_LATEST_KEY)
    .first<{ value: string }>();
  if (pointer) {
    return pointer.value;
  }
  const latest = await getLatestSnapshot(env);
  if (!latest) return null;
  try {
    const parsed = JSON.parse(latest.manifest) as { snapshot_version?: unknown };
    return typeof parsed.snapshot_version === 'string' ? parsed.snapshot_version : null;
  } catch {
    return null;
  }
}

/**
 * 官方暂停开关是否需要补发一次快照（cron 无脏标记时调用）。
 *
 * 开关状态来自部署配置 env.DESTRUCTIVE_KILL_SWITCH，翻转不落库、不置脏；
 * 这里与最新已发布 body 里的 kill_switch 比对，不一致就值得补发（开/关/理由变更
 * 都要让公开镜像尽快反映）。当日已发布过则直接返回 false —— day-once 守卫会把
 * 开关变更顺延到次日，实时生效由 /v1/kill-switch 端点兜底，扩展破坏性操作前查询。
 */
export async function killSwitchNeedsPublish(env: Cloudflare.Env): Promise<boolean> {
  const now = new Date();
  const dateStamp = now.toISOString().slice(0, 10).replaceAll('-', '.');
  const todayRow = await env.DB.prepare(
    'SELECT 1 AS x FROM snapshots WHERE version LIKE ?1 LIMIT 1',
  )
    .bind(`${dateStamp}.%`)
    .first<{ x: number }>();
  if (todayRow) {
    return false;
  }

  const expected = buildKillSwitch(env.DESTRUCTIVE_KILL_SWITCH, now.toISOString());
  const latestVersion = await getLatestSnapshotVersion(env);
  if (!latestVersion) {
    return expected != null;
  }
  const body = await getSnapshotFile(env, latestVersion, SNAPSHOT_PACK);
  if (!body) {
    return false;
  }
  try {
    const parsed = JSON.parse(body) as { kill_switch?: unknown };
    return JSON.stringify(parsed.kill_switch ?? null) !== JSON.stringify(expected ?? null);
  } catch {
    return false;
  }
}

/**
 * 快照脏标记（异步发布协调）。
 *
 * 上报/抢救/撤回落库后置脏；cron 读标记 → 生成快照 → 值比对清除。
 * 不用时间戳反推：低票变更不改变名单内容时 generateSnapshot 会复用版本、
 * 不产生新快照行，「数据比快照新」会永远为真导致每周期空转全量扫描。
 * value 存置脏时刻（毫秒）；清除带值比对，生成期间到达的新变更会保留标记。
 */
const SNAPSHOT_DIRTY_KEY = 'snapshot_dirty';

export async function markSnapshotDirty(env: Cloudflare.Env): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO meta (key, value) VALUES (?1, ?2)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  )
    .bind(SNAPSHOT_DIRTY_KEY, String(Date.now()))
    .run();
}

export async function readSnapshotDirty(env: Cloudflare.Env): Promise<string | null> {
  const row = await env.DB.prepare('SELECT value FROM meta WHERE key = ?1')
    .bind(SNAPSHOT_DIRTY_KEY)
    .first<{ value: string }>();
  return row?.value ?? null;
}

/** 生成成功后清除；期间有新变更（value 已变）则保留，由下一周期再合并。 */
export async function clearSnapshotDirty(env: Cloudflare.Env, value: string): Promise<void> {
  await env.DB.prepare('DELETE FROM meta WHERE key = ?1 AND value = ?2')
    .bind(SNAPSHOT_DIRTY_KEY, value)
    .run();
}
