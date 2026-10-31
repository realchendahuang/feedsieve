import { and, desc, eq, inArray, isNotNull, like, notInArray, sql } from 'drizzle-orm';
import { describeDbError, getDb } from './db/client';
import { accountHealth, accounts, meta, snapshots } from './db/schema';
import { sha256Hex } from './lib/hash';
import { compareText } from './lib/sql';
import { computeScore } from './lib/score';
import {
  buildSigningMessage,
  buildSnapshotDelta,
  compareManifestVersions,
  signManifestMessage,
  type ManifestSignature,
  type VerifiedEntry,
  type WhitelistEntry,
} from '@feedsieve/community-lists';
import { listMaintainerEntries } from './maintainer-blocklist';
import { listMaintainerWhitelist } from './maintainer-whitelist';
import { publicPolicy } from './reports';
import { POLICY } from './reports';
import { autoRateAccounts } from './rating';
import { inferCategory } from './category-inference';
import { loadCommunityAggregates } from './lib/consensus-v2';
import { LISTING_POLICY, listingReason } from './lib/listing';
import { loadHitSignals, mutedRuleIds, readRuleMutes, topHitCategory } from './rule-hits';

export const SNAPSHOT_SCHEMA_VERSION = 2;
/** 入榜政策版本（community/policy/v4.yaml），写进快照 body 与 manifest。 */
export const SNAPSHOT_POLICY_VERSION = LISTING_POLICY.version;
/**
 * 两版快照之间至少隔这么久（cron 每 30 分钟检查一次）。原来是「当日一版」，
 * 新上榜的号最晚要等到第二天；现在扩展按增量同步（/v1/snapshots/delta），发得勤也不费流量。
 */
export const SNAPSHOT_MIN_INTERVAL_S = 25 * 60;
export const SNAPSHOT_PACK = 'official.json';
export const PUBLIC_BLOCKLIST_PACK = 'blocklist.yaml';

/** 指纹簇（Campaign）：汉明距离 <= 此值视为同一话术的变体，归同一簇；< 2 个账号的簇不产生 campaign */
const SIMHASH_HAMMING_THRESHOLD = 2;
const MIN_CAMPAIGN_ACCOUNTS = 2;

/**
 * 快照 R2 分发前缀（与词库 keyword-packs/ 同桶分域）。
 * 快照文件是 write-once 发布物：版本化文件不可变缓存 + latest 指针文件。
 * 读路径优先 R2（不查库），数据库 files_json 保留为归档回退；latest 指针
 * 存 meta 表供 O(1) 点读，取代每次轮询的全表排序扫。
 */
const SNAPSHOT_R2_PREFIX = 'snapshots';
export const SNAPSHOT_LATEST_KEY = 'latest_snapshot_version';

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
  await upsertMeta(env, SNAPSHOT_LATEST_KEY, version);
}

async function upsertMeta(env: Cloudflare.Env, key: string, value: string): Promise<void> {
  await getDb(env)
    .insert(meta)
    .values({ key, value })
    .onConflictDoUpdate({ target: meta.key, set: { value: sql`excluded.value` } });
}

async function readMeta(env: Cloudflare.Env, key: string): Promise<string | null> {
  const [row] = await getDb(env).select({ value: meta.value }).from(meta).where(eq(meta.key, key));
  return row?.value ?? null;
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
  /** 佐证上榜（净票 ≥ 2 + 多个网段的规则命中佐证）时标出；共识上榜不写 */
  listed_by?: 'corroborated';
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
    const fp = fps[i];
    if (fp === undefined || visitedFp.has(fp)) {
      continue;
    }
    // 当前簇：从本指纹出发，把彼此距离 <= 阈值的指纹的账号并入
    // （传递归簇：变体链 A-B-C，A 近 B、B 近 C 算一簇）
    const clusterFps = new Set<string>([fp]);
    const clusterAccounts = new Set<string>(fpAccounts.get(fp) ?? []);
    visitedFp.add(fp);
    for (let j = i + 1; j < fps.length; j++) {
      const candidate = fps[j];
      if (candidate === undefined || visitedFp.has(candidate)) {
        continue;
      }
      const near = [...clusterFps].some((f) => hamming(f, candidate) <= SIMHASH_HAMMING_THRESHOLD);
      if (near) {
        clusterFps.add(candidate);
        for (const h of fpAccounts.get(candidate) ?? []) {
          clusterAccounts.add(h);
        }
        visitedFp.add(candidate);
      }
    }
    if (clusterAccounts.size < MIN_CAMPAIGN_ACCOUNTS) {
      continue;
    }
    // 代表条目：簇内 report_count 最高（并列取 handle 字典序）
    const sortedAccounts = [...clusterAccounts].sort((a, b) => {
      const ra = reportCounts.get(a) ?? 0;
      const rb = reportCounts.get(b) ?? 0;
      return rb - ra || a.localeCompare(b);
    });
    const entryId = sortedAccounts[0];
    if (entryId === undefined) continue;
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
  status_v2: string;
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
  /** 发布间隔守卫命中：内容有变化但距上一版不到 SNAPSHOT_MIN_INTERVAL_S，未落新行（调用方保留脏标记）。 */
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
  category: string,
  evidence: string[],
  distinctDays: number,
  fingerprints: string[],
  domains: string[],
  campaign?: { entryId: string; size: number },
  corroborated = false,
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
    category,
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
    ...(corroborated ? { listed_by: 'corroborated' as const } : {}),
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
    `  policy_version: ${SNAPSHOT_POLICY_VERSION}`,
    '  formula: "block_votes - false_positive_votes"',
    `  min_net_votes: ${POLICY.communityNetThreshold}`,
    '  independence: "consensus_v2 strong | votes on >= 2 days | net >= 5"',
    '  corroborated: "net >= 2, no false-positive votes, rule hits from >= 3 networks in 7 days"',
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
    if (entry.listed_by) {
      lines.push(`    listed_by: ${yamlString(entry.listed_by)}`);
    }
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

  const db = getDb(env);
  const [latest] = await db
    .select({ version: snapshots.version })
    .from(snapshots)
    .where(like(snapshots.version, `${dateStamp}.%`))
    .orderBy(sql`substr(${snapshots.version}, 12)::bigint desc`)
    .limit(1);
  const version = nextVersion(latest?.version ?? null, dateStamp);
  // 内容比较和发布间隔看「全局最新一版」（跨日也算）：零点后第一轮不会无故 mint 一版相同内容
  const [latestAny] = await db
    .select({ version: snapshots.version })
    .from(snapshots)
    .orderBy(desc(snapshots.createdAt))
    .limit(1);

  // accounts 一次全扫出三份投影（黑名单行 / verified 行 / 全量索引），原来是
  // 三次独立全扫——前两次都是这份全量的过滤子集。
  // 排序用 "C" 排序规则（字节序），与 SQLite 的二进制比较一致，快照内容与签名才稳定
  const allAccountRows: AccountRow[] = await db
    .select({
      handle: accounts.handle,
      x_user_id: accounts.xUserId,
      aliases: accounts.aliases,
      category: accounts.category,
      status: accounts.status,
      status_v2: accounts.statusV2,
      report_count: accounts.reportCount,
      rescue_count: accounts.rescueCount,
      first_report_at: accounts.firstReportAt,
      updated_at: accounts.updatedAt,
    })
    .from(accounts)
    .orderBy(sql`${accounts.handle} collate "C" asc`);
  // 规则命中佐证 + 误伤静音（rule-hits.ts）；已静音规则的命中不算佐证
  const ruleMutes = await readRuleMutes(env);
  const mutedRules = mutedRuleIds(ruleMutes);
  const [hitSignals, deadRows] = await Promise.all([
    loadHitSignals(env, now.getTime(), new Set(mutedRules)),
    db
      .select({ handle: accountHealth.handle })
      .from(accountHealth)
      .where(eq(accountHealth.state, 'dead')),
  ]);
  const deadHandles = new Set(deadRows.map((row) => row.handle));
  const listedBy = new Map<string, 'consensus' | 'corroborated'>();
  const accountRows = allAccountRows.filter((row) => {
    const reason = listingReason(
      {
        report_count: row.report_count,
        rescue_count: row.rescue_count,
        status_v2: row.status_v2,
        distinct_days: aggregates.daysByHandle.get(row.handle) ?? 0,
        dead: deadHandles.has(row.handle),
      },
      hitSignals.get(row.handle),
    );
    if (reason) listedBy.set(row.handle, reason);
    return reason !== null;
  });

  // 社区白名单（verified）：入榜公式与黑名单严格镜像——抢救净票 >= 同一阈值。
  // rescue_count/report_count 由 refreshAccountsFromLabels 收敛（active_labels 计票），
  // 与黑名单入榜 SQL 同源，无独立安装/跨天二次筛选（COMMUNITY_FILTERING 口径一致）。
  const verified: VerifiedEntry[] = allAccountRows
    .filter((row) => row.rescue_count - row.report_count >= POLICY.communityNetThreshold)
    .map((row) => ({
      handle: row.handle,
      x_user_id: row.x_user_id,
      rescue_count: row.rescue_count,
      report_count: row.report_count,
      net_votes: row.rescue_count - row.report_count,
      first_seen_at: new Date(row.first_report_at * 1000).toISOString(),
      updated_at: new Date(row.updated_at * 1000).toISOString(),
    }));

  // 推荐白名单（whitelist）：维护者在 GitHub 维护 whitelist.yaml，发布脚本同步进
  // maintainer_whitelist 表。与 verified 独立成段——verified 是社区抢救票合意，
  // whitelist 是维护者公开背书；两者在客户端都一票否决（任何检测来源不得标注）。
  const maintainedWhitelist = await listMaintainerWhitelist(env);
  const whitelist: WhitelistEntry[] = maintainedWhitelist.map((row) => ({
    handle: row.handle,
    x_user_id: row.x_user_id,
    name: row.name,
    avatar_url: row.avatar_url,
    note: row.note,
    added_at: new Date(row.created_at * 1000).toISOString(),
  }));

  const entries: SnapshotEntry[] = [];
  const daysByHandle = aggregates.daysByHandle;
  const accountByHandle = new Map(allAccountRows.map((row) => [row.handle, row] as const));
  const reportCounts = new Map(
    allAccountRows.map((row) => [row.handle, row.report_count] as const),
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
  const votesByHandle = aggregates.votesByHandle;
  // 发布分类 = 证据推理（accounts.category 是票面多数，可能被历史回声票钉在 other；
  // 维护者合并层会在推理结果之上覆盖，优先级最高）
  const inferredCategory = (handle: string): string =>
    inferCategory({
      votes: votesByHandle.get(handle) ?? [],
      hasDomainEvidence: (domainsByHandle.get(handle)?.length ?? 0) > 0,
      hasFingerprintEvidence: (fingerprintsByHandle.get(handle)?.length ?? 0) > 0,
      hitCategory: topHitCategory(hitSignals.get(handle)),
    });
  for (const row of accountRows) {
    const evidence = evidenceByHandle.get(row.handle) ?? [];
    const campaign = campaigns.get(row.handle);
    entries.push(
      buildEntry(
        row,
        inferredCategory(row.handle),
        evidence,
        daysByHandle.get(row.handle) ?? 1,
        fingerprintsByHandle.get(row.handle) ?? [],
        domainsByHandle.get(row.handle) ?? [],
        campaign,
        listedBy.get(row.handle) === 'corroborated',
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
          // 维护者分类马上会覆盖此值（entry.category = maintained.category）
          inferredCategory(maintained.handle),
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
  // 白名单优先于一切黑名单来源：命中白名单的账号必须从 entries 移除，
  // 否则客户端整份拒绝（duplicate_snapshot_handle，见 client validate.ts）。
  const whitelistHandles = new Set(whitelist.map((entry) => entry.handle));
  if (whitelistHandles.size > 0) {
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      if (entry && whitelistHandles.has(entry.handle)) entries.splice(i, 1);
    }
  }
  // 字节序（handle 只含 [a-z0-9_]）：扩展用增量重建全文时排序与语言设置无关，结果才能和签名哈希对上
  entries.sort((a, b) => compareText(a.handle, b.handle));

  const generatedAt = now.toISOString();
  // 官方破坏性动作暂停开关：部署配置里设置了 DESTRUCTIVE_KILL_SWITCH（理由）即下发；
  // 随签名快照分发，扩展验签后执行 —— 只能关闭拉黑，不能开启任何自动动作。
  const killSwitch = buildKillSwitch(env.DESTRUCTIVE_KILL_SWITCH, generatedAt);
  const body = `${JSON.stringify(
    {
      schema_version: SNAPSHOT_SCHEMA_VERSION,
      policy_version: SNAPSHOT_POLICY_VERSION,
      snapshot_version: version,
      generated_at: generatedAt,
      entries,
      ...(verified.length > 0 ? { verified } : {}),
      ...(whitelist.length > 0 ? { whitelist } : {}),
      ...(killSwitch ? { kill_switch: killSwitch } : {}),
      // 误伤率高、已静音的规则：扩展不再用它们标黄框（旧版扩展忽略这个字段）
      ...(mutedRules.length > 0 ? { muted_rules: mutedRules } : {}),
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
    policy_version: SNAPSHOT_POLICY_VERSION,
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
  const lastVersion = latestAny?.version ?? null;
  const loadLatestRow = async () => {
    if (!lastVersion) return null;
    const [row] = await db
      .select({ manifest_json: snapshots.manifestJson, files_json: snapshots.filesJson })
      .from(snapshots)
      .where(eq(snapshots.version, lastVersion));
    return row ?? null;
  };
  const lastBody = lastVersion ? await getSnapshotFile(env, lastVersion, SNAPSHOT_PACK) : null;
  if (
    lastBody &&
    entriesContentEqual(lastBody, entries, verified, whitelist, killSwitch, mutedRules)
  ) {
    const lastRow = await loadLatestRow();
    if (lastRow) {
      await syncListedFlags(
        env,
        entries.map((entry) => entry.handle),
      );
      return {
        version: lastVersion as string,
        manifest: JSON.parse(lastRow.manifest_json),
        files: JSON.parse(lastRow.files_json) as Record<string, SnapshotFile>,
      };
    }
  }

  // 发布间隔守卫：距最新一版不到 SNAPSHOT_MIN_INTERVAL_S 时先不 mint 新版本，
  // 调用方（scheduled）看到 deferred 会保留脏标记，下一轮 cron 合并发布；
  // 维护者显式发布走 bypassDailyOnce 即时通道。
  if (!options.bypassDailyOnce && (await publishedWithin(env, SNAPSHOT_MIN_INTERVAL_S))) {
    const lastRow = await loadLatestRow();
    if (lastRow && lastVersion) {
      return {
        version: lastVersion as string,
        manifest: JSON.parse(lastRow.manifest_json),
        files: JSON.parse(lastRow.files_json) as Record<string, SnapshotFile>,
        deferred: true,
      };
    }
  }

  const inserted = await db
    .insert(snapshots)
    .values({
      version,
      manifestJson: `${JSON.stringify(manifest, null, 2)}\n`,
      signatureJson,
      filesJson: JSON.stringify({
        [machineFile.path]: machineFile,
        [yamlFile.path]: yamlFile,
      }),
      createdAt: Math.floor(now.getTime() / 1000),
    })
    .onConflictDoNothing()
    .returning({ version: snapshots.version });

  // 两个请求可能同时读取到同一 latest 版本。主键冲突时只有一个写入成功；另一个重读最新
  // 内容，若内容已一致会直接复用，否则分配下一个序号。避免真实三票并发时返回 500。
  if (inserted.length === 0) {
    if (publishAttempt >= 20) {
      throw new Error('snapshot_publish_contention');
    }
    return generateSnapshot(env, publishAttempt + 1, options);
  }

  // 最新版本指针：latest 轮询从全表排序扫降为 O(1) 点读（写入失败无妨，读端回退排序扫）
  await setLatestSnapshotPointer(env, version);
  await syncListedFlags(
    env,
    entries.map((entry) => entry.handle),
  );
  // R2 分发：失败不阻断发布（数据库仍权威，读端自动回退 files_json）
  await publishSnapshotToR2(env, version, machineFile, yamlFile, manifest).catch((error) => {
    console.error(`[community-api] snapshot R2 publish failed: ${describeDbError(error)}`);
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

/**
 * 把「在不在公开名单里」写回 accounts.listed：后台概览、热榜、主页洞察、贡献统计都按它判断，
 * 和扩展下载的名单同一口径。只在快照真正发布或复用时调用（deferred 时名单还没变）。
 */
async function syncListedFlags(env: Cloudflare.Env, handles: string[]): Promise<void> {
  const db = getDb(env);
  for (let i = 0; i < handles.length; i += 5_000) {
    const chunk = handles.slice(i, i + 5_000);
    await db
      .update(accounts)
      .set({ listed: 1 })
      .where(and(eq(accounts.listed, 0), inArray(accounts.handle, chunk)));
  }
  await db
    .update(accounts)
    .set({ listed: 0 })
    .where(
      handles.length > 0
        ? and(eq(accounts.listed, 1), notInArray(accounts.handle, handles))
        : eq(accounts.listed, 1),
    );
}

/** 最近这么多秒内是否发布过快照（任何日期）。 */
async function publishedWithin(env: Cloudflare.Env, seconds: number): Promise<boolean> {
  const [row] = await getDb(env)
    .select({ created_at: snapshots.createdAt })
    .from(snapshots)
    .orderBy(desc(snapshots.createdAt))
    .limit(1);
  return row !== undefined && Math.floor(Date.now() / 1000) - row.created_at < seconds;
}

/** 两次快照的 entries、verified、whitelist、kill_switch 与 muted_rules 是否相同（忽略 generated_at / 版本号等元信息）。 */
function entriesContentEqual(
  lastBody: string,
  currentEntries: unknown[],
  currentVerified: unknown[],
  currentWhitelist: unknown[],
  currentKillSwitch:
    | {
        destructive_actions_disabled: true;
        reason?: string;
        disabled_since?: string;
      }
    | undefined,
  currentMutedRules: string[],
): boolean {
  type LastBody = {
    schema_version?: number;
    policy_version?: number;
    entries?: unknown[];
    verified?: unknown[];
    whitelist?: unknown[];
    kill_switch?: unknown;
    muted_rules?: unknown[];
  };
  let last: LastBody;
  try {
    last = JSON.parse(lastBody) as LastBody;
  } catch {
    return false;
  }
  if (
    last.schema_version !== SNAPSHOT_SCHEMA_VERSION ||
    last.policy_version !== SNAPSHOT_POLICY_VERSION ||
    !Array.isArray(last.entries)
  ) {
    return false;
  }
  if (last.kill_switch === undefined && currentKillSwitch !== undefined) return false;
  if (JSON.stringify(last.kill_switch) !== JSON.stringify(currentKillSwitch)) return false;
  if (JSON.stringify(last.entries) !== JSON.stringify(currentEntries)) return false;
  // 白名单也参与内容复用判断：verified / whitelist 变化必须产生新版本，不能复用旧 body
  if (JSON.stringify(last.verified ?? []) !== JSON.stringify(currentVerified)) return false;
  if (JSON.stringify(last.muted_rules ?? []) !== JSON.stringify(currentMutedRules)) return false;
  return JSON.stringify(last.whitelist ?? []) === JSON.stringify(currentWhitelist);
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
  const db = getDb(env);
  const requireSigned = env.REQUIRE_SIGNED_SNAPSHOTS === '1';
  const columns = {
    version: snapshots.version,
    manifest_json: snapshots.manifestJson,
    files_json: snapshots.filesJson,
    created_at: snapshots.createdAt,
  };
  // 指针和快照行一条查询读出（每次往返都要经 Hyperdrive 到源站，少一次串行往返）
  const [row] = await db
    .select(columns)
    .from(snapshots)
    .where(
      and(
        eq(
          snapshots.version,
          sql`(select ${meta.value} from ${meta} where ${meta.key} = ${SNAPSHOT_LATEST_KEY})`,
        ),
        requireSigned ? isNotNull(snapshots.signatureJson) : undefined,
      ),
    );
  if (row) return row;
  const [fallback] = await db
    .select(columns)
    .from(snapshots)
    .where(requireSigned ? isNotNull(snapshots.signatureJson) : undefined)
    .orderBy(
      sql`substr(${snapshots.version}, 1, 10) collate "C" desc`,
      sql`substr(${snapshots.version}, 12)::bigint desc`,
    )
    .limit(1);
  return fallback ?? null;
}

export async function getLatestSnapshot(env: Cloudflare.Env): Promise<{ manifest: string } | null> {
  // 快路径：R2 latest-manifest（发布时写入，命中即不查库）
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
  // 校验语义在 manifest（latestSnapshotRow 已按 signature 过滤），这里仍走数据库点读。
  if (env.REQUIRE_SIGNED_SNAPSHOTS !== '1') {
    const r2Body = await r2Text(env, `${SNAPSHOT_R2_PREFIX}/${version}/${path}`);
    if (r2Body !== null) {
      return r2Body;
    }
  }
  const requireSigned = env.REQUIRE_SIGNED_SNAPSHOTS === '1';
  const [row] = await getDb(env)
    .select({ filesJson: snapshots.filesJson })
    .from(snapshots)
    .where(
      and(
        eq(snapshots.version, version),
        requireSigned ? isNotNull(snapshots.signatureJson) : undefined,
      ),
    );
  if (!row) return null;
  const files = JSON.parse(row.filesJson) as Record<string, SnapshotFile>;
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

const SNAPSHOT_VERSION_RE = /^\d{4}\.\d{2}\.\d{2}\.\d{1,4}$/;
/** 快照版本保留 14 天：现在一天最多 48 版，比这更旧的扩展直接下全量。最新一版永远保留。 */
const SNAPSHOT_RETENTION_S = 14 * 86_400;

/** cron：删掉 14 天前的快照版本（数据库行 + R2 版本文件），最新一版不删。 */
export async function cleanupOldSnapshots(
  env: Cloudflare.Env,
  nowMs = Date.now(),
): Promise<number> {
  const db = getDb(env);
  const cutoff = Math.floor(nowMs / 1000) - SNAPSHOT_RETENTION_S;
  const latest = await getLatestSnapshotVersion(env);
  const old = await db
    .select({ version: snapshots.version })
    .from(snapshots)
    .where(sql`${snapshots.createdAt} < ${cutoff}`)
    .limit(500);
  const versions = old.map((row) => row.version).filter((version) => version !== latest);
  if (versions.length === 0) return 0;
  await db.delete(snapshots).where(inArray(snapshots.version, versions));
  await Promise.all(
    versions.map((version) =>
      env.KEYWORD_PACKS?.delete([
        `${SNAPSHOT_R2_PREFIX}/${version}/${SNAPSHOT_PACK}`,
        `${SNAPSHOT_R2_PREFIX}/${version}/${PUBLIC_BLOCKLIST_PACK}`,
      ]).catch(() => undefined),
    ),
  );
  return versions.length;
}
/** 增量比全量的这个比例还大时不给（扩展直接下全量更省事）。 */
const DELTA_MAX_RATIO = 0.5;

/**
 * 两版之间的增量（见 packages/community-lists/src/delta.ts）。版本不可变，结果可以永久缓存。
 * 任一版本不存在、from 不早于 to、增量过大时返回 null，扩展会退回下载全量。
 */
export async function getSnapshotDelta(
  env: Cloudflare.Env,
  from: string,
  to: string,
): Promise<string | null> {
  if (
    !SNAPSHOT_VERSION_RE.test(from) ||
    !SNAPSHOT_VERSION_RE.test(to) ||
    compareManifestVersions(from, to) >= 0
  ) {
    return null;
  }
  const [base, target] = await Promise.all([
    getSnapshotFile(env, from, SNAPSHOT_PACK),
    getSnapshotFile(env, to, SNAPSHOT_PACK),
  ]);
  if (!base || !target) return null;
  try {
    const delta = buildSnapshotDelta(base, target);
    const text = JSON.stringify(delta);
    // 小快照（测试、冷启动）不卡比例：省不了多少，但也不该逼扩展下全量
    return text.length <= Math.max(target.length * DELTA_MAX_RATIO, 64_000) ? text : null;
  } catch {
    return null;
  }
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

export async function getLatestSnapshotMeta(
  env: Cloudflare.Env,
): Promise<LatestSnapshotMeta | null> {
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
  const pointer = await readMeta(env, SNAPSHOT_LATEST_KEY);
  if (pointer) {
    return pointer;
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
 * 都要让公开镜像尽快反映）。距上一版不到 SNAPSHOT_MIN_INTERVAL_S 时返回 false，留给下一轮 cron，
 * 实时生效由 /v1/kill-switch 端点兜底，扩展破坏性操作前查询。
 */
export async function killSwitchNeedsPublish(env: Cloudflare.Env): Promise<boolean> {
  const now = new Date();
  if (await publishedWithin(env, SNAPSHOT_MIN_INTERVAL_S)) {
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
export const SNAPSHOT_DIRTY_KEY = 'snapshot_dirty';

export async function markSnapshotDirty(env: Cloudflare.Env): Promise<void> {
  await upsertMeta(env, SNAPSHOT_DIRTY_KEY, String(Date.now()));
}

export async function readSnapshotDirty(env: Cloudflare.Env): Promise<string | null> {
  return readMeta(env, SNAPSHOT_DIRTY_KEY);
}

/** 生成成功后清除；期间有新变更（value 已变）则保留，由下一周期再合并。 */
export async function clearSnapshotDirty(env: Cloudflare.Env, value: string): Promise<void> {
  await getDb(env)
    .delete(meta)
    .where(and(eq(meta.key, SNAPSHOT_DIRTY_KEY), eq(meta.value, value)));
}
