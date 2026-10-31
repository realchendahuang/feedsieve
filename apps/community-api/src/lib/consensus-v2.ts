/**
 * consensus v2：对社区入榜的 Sybil 加固公式。
 *
 * 结果写入 accounts.status_v2 / consensus_v2。自政策 v4 起，status_v2 = strong 是入榜的
 * 独立性条件之一（另两条是拉黑票横跨 ≥ 2 天、净票 ≥ 5，见 lib/listing.ts）；
 * 净票门槛本身仍是 v1（report_count - rescue_count >= 3）。
 *
 * 与 v1 的差别：
 * - 每张票按「安装信任 × 安装成熟度」加权：新安装（< probationDays）权重被压低，
 *   老安装正常计权 —— 两个小时内冒出的三个新安装不再等于三个独立长期观察者；
 * - 入榜同时要求「加权净票达标」与「时间或证据独立性」：
 *   举报横跨多个日期，或存在 ≥2 个独立安装一致上报的内容指纹/域名。
 */

import { and, asc, count, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { collateC } from './sql';
import type { CategoryVoteRow } from '../category-inference';
import { getDb } from '../db/client';
import { activeLabels, installations, reports } from '../db/schema';

export const CONSENSUS_V2_POLICY = {
  /** 新安装观察期天数：此期内投票权重从 minWeight 向 1 线性爬升 */
  probationDays: 7,
  /** 新安装票权重下限（trust 相同时） */
  minWeight: 0.15,
  /** 加权净票入榜阈值 */
  weightedNetThreshold: 2.5,
  /** 时间独立性：举报至少横跨的天数 */
  minDistinctDays: 2,
  /** score 饱和度（沿用 v0.4 computeScore 的饱和曲线） */
  saturation: 3,
} as const;

/** 单张票的权重：trust（长期行为）× 安装成熟度（观察期线性爬升）。 */
export function voteWeight(trust: number, ageDays: number): number {
  const maturity = Math.min(1, Math.max(0, ageDays) / CONSENSUS_V2_POLICY.probationDays);
  return trust * Math.max(CONSENSUS_V2_POLICY.minWeight, maturity);
}

export interface ConsensusV2Result {
  status: 'strong' | 'new';
  /** 可解释分数 [0,1]（饱和曲线），只作展示 */
  score: number;
  weightedNet: number;
  /** 加权净票的构成（便于影子对比与审计） */
  weightedBlocked: number;
  weightedAllowed: number;
  distinctDays: number;
  evidenceIndependent: boolean;
  /** 未达条件的机器可读原因（管理端展示用） */
  reasons: string[];
}

/** 纯函数：加权净票 + 时间/证据独立性两条件同时满足才算 strong。 */
export function computeConsensusV2(input: {
  blockedWeights: number[];
  allowedWeights: number[];
  distinctDays: number;
  evidenceIndependent: boolean;
}): ConsensusV2Result {
  const weightedBlocked = input.blockedWeights.reduce((sum, w) => sum + w, 0);
  const weightedAllowed = input.allowedWeights.reduce((sum, w) => sum + w, 0);
  const weightedNet = weightedBlocked - weightedAllowed;
  const score =
    weightedNet <= 0
      ? 0
      : Math.round(
          Math.min(1, weightedNet / (weightedNet + CONSENSUS_V2_POLICY.saturation)) * 100,
        ) / 100;
  const independent =
    input.evidenceIndependent || input.distinctDays >= CONSENSUS_V2_POLICY.minDistinctDays;
  const enoughNet = weightedNet >= CONSENSUS_V2_POLICY.weightedNetThreshold;
  const reasons: string[] = [];
  if (!enoughNet) reasons.push('weighted_net_below_threshold');
  if (!independent) reasons.push('lacks_temporal_or_evidence_independence');
  return {
    status: enoughNet && independent ? 'strong' : 'new',
    score,
    weightedNet: Math.round(weightedNet * 100) / 100,
    weightedBlocked: Math.round(weightedBlocked * 100) / 100,
    weightedAllowed: Math.round(weightedAllowed * 100) / 100,
    distinctDays: input.distinctDays,
    evidenceIndependent: input.evidenceIndependent,
    reasons,
  };
}

export interface ConsensusV2Input {
  blockedWeights: number[];
  allowedWeights: number[];
  distinctDays: number;
  evidenceIndependent: boolean;
}

/** 分类推理需要的按 handle 批量证据（与快照下发门槛同源：≥2 独立安装一致）。 */
export interface HandleEvidenceSets {
  inputs: Map<string, ConsensusV2Input>;
  fingerprintEvidenceHandles: Set<string>;
  domainEvidenceHandles: Set<string>;
}

/** 无票账号的 v2 输入：全零、无独立性证据。 */
export const EMPTY_CONSENSUS_V2_INPUT: ConsensusV2Input = {
  blockedWeights: [],
  allowedWeights: [],
  distinctDays: 0,
  evidenceIndependent: false,
};

/** reports 行 ⋈ 该安装对该账号的当前 blocked 标签：reports 唯一索引保证一行 = 一个安装的当前票 */
const blockedReportOn = and(
  eq(activeLabels.installationId, reports.installationId),
  eq(activeLabels.handle, reports.handle),
  eq(activeLabels.label, 'blocked'),
);

/** 按 UTC 日历日去重计数（created_at 是 Unix 秒） */
const distinctDays = sql<number>`count(distinct ${reports.createdAt} / 86400)`.mapWith(Number);

/**
 * 全表批量载入 v2 输入（影子重算用）。
 *
 * autoRateAccounts 对全表做影子重算时，逐账号加载会放大成 N×6 次往返；
 * 这里用 4 条聚合 SQL 一次取回全部输入，在内存里组装。
 */
export async function loadAllConsensusV2Inputs(
  env: Cloudflare.Env,
): Promise<Map<string, ConsensusV2Input>> {
  const db = getDb(env);
  const [labelRows, dayRows, fpRows, domainRows] = await Promise.all([
    db
      .select({
        handle: activeLabels.handle,
        label: activeLabels.label,
        trust: installations.trust,
        first_seen_at: installations.firstSeenAt,
      })
      .from(activeLabels)
      .innerJoin(installations, eq(installations.id, activeLabels.installationId)),
    db
      .select({ handle: reports.handle, days: distinctDays })
      .from(reports)
      .innerJoin(activeLabels, blockedReportOn)
      .groupBy(reports.handle),
    db
      .select({ handle: reports.handle })
      .from(reports)
      .innerJoin(activeLabels, blockedReportOn)
      .where(isNotNull(reports.contentFingerprint))
      .groupBy(reports.handle, reports.contentFingerprint)
      .having(sql`count(*) >= 2`),
    db.execute<{ handle: string }>(sql`
      SELECT r.handle
      FROM ${reports} r
      JOIN ${activeLabels} l
        ON l.installation_id = r.installation_id AND l.handle = r.handle AND l.label = 'blocked'
      CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(r.link_domains::jsonb) = 'array' THEN r.link_domains::jsonb ELSE '[]'::jsonb END) AS d(value)
      WHERE r.link_domains IS NOT NULL
      GROUP BY r.handle, d.value
      HAVING COUNT(DISTINCT r.installation_id) >= 2`),
  ]);

  const now = Math.floor(Date.now() / 1000);
  const ageDays = (firstSeenAt: number): number => Math.max(0, (now - firstSeenAt) / 86400);

  // 按 handle 聚合权重
  const blockedWeights = new Map<string, number[]>();
  const allowedWeights = new Map<string, number[]>();
  for (const row of labelRows) {
    const weight = voteWeight(row.trust, ageDays(row.first_seen_at));
    const bucket = row.label === 'blocked' ? blockedWeights : allowedWeights;
    const list = bucket.get(row.handle) ?? [];
    list.push(weight);
    bucket.set(row.handle, list);
  }

  const daysByHandle = new Map<string, number>();
  for (const row of dayRows) daysByHandle.set(row.handle, row.days);

  const independentHandles = new Set<string>();
  for (const row of fpRows) independentHandles.add(row.handle);
  for (const row of domainRows) independentHandles.add(row.handle);

  const handles = new Set([
    ...blockedWeights.keys(),
    ...allowedWeights.keys(),
    ...daysByHandle.keys(),
    ...independentHandles,
  ]);
  const inputs = new Map<string, ConsensusV2Input>();
  for (const handle of handles) {
    inputs.set(handle, {
      blockedWeights: blockedWeights.get(handle) ?? [],
      allowedWeights: allowedWeights.get(handle) ?? [],
      distinctDays: daysByHandle.get(handle) ?? 0,
      evidenceIndependent: independentHandles.has(handle),
    });
  }
  return inputs;
}

/**
 * 按 handle 集合批量载入 v2 输入。
 *
 * labels.ts 的 refreshAccountsFromLabels 对一批标签变更收敛计数时使用：
 * 逐账号加载会放大往返次数，这里用 4 条 IN 聚合 SQL（并发发出）一次取回全部输入，
 * 在内存里组装。
 */
export async function loadConsensusV2InputsByHandles(
  env: Cloudflare.Env,
  handles: string[],
): Promise<HandleEvidenceSets> {
  const unique = [...new Set(handles)];
  if (unique.length === 0) {
    return {
      inputs: new Map(),
      fingerprintEvidenceHandles: new Set(),
      domainEvidenceHandles: new Set(),
    };
  }
  const db = getDb(env);

  const [labelRows, dayRows, fpRows, domainRows] = await Promise.all([
    db
      .select({
        handle: activeLabels.handle,
        label: activeLabels.label,
        trust: installations.trust,
        first_seen_at: installations.firstSeenAt,
      })
      .from(activeLabels)
      .innerJoin(installations, eq(installations.id, activeLabels.installationId))
      .where(inArray(activeLabels.handle, unique)),
    db
      .select({ handle: reports.handle, days: distinctDays })
      .from(reports)
      .innerJoin(activeLabels, blockedReportOn)
      .where(inArray(reports.handle, unique))
      .groupBy(reports.handle),
    db
      .select({ handle: reports.handle })
      .from(reports)
      .innerJoin(activeLabels, blockedReportOn)
      .where(and(inArray(reports.handle, unique), isNotNull(reports.contentFingerprint)))
      .groupBy(reports.handle, reports.contentFingerprint)
      .having(sql`count(*) >= 2`),
    db.execute<{ handle: string }>(sql`
      SELECT r.handle
      FROM ${reports} r
      JOIN ${activeLabels} l
        ON l.installation_id = r.installation_id AND l.handle = r.handle AND l.label = 'blocked'
      CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(r.link_domains::jsonb) = 'array' THEN r.link_domains::jsonb ELSE '[]'::jsonb END) AS d(value)
      WHERE r.handle IN ${unique} AND r.link_domains IS NOT NULL
      GROUP BY r.handle, d.value
      HAVING COUNT(DISTINCT r.installation_id) >= 2`),
  ]);

  const now = Math.floor(Date.now() / 1000);
  const ageDays = (firstSeenAt: number): number => Math.max(0, (now - firstSeenAt) / 86400);

  // 按 handle 聚合权重
  const blockedWeights = new Map<string, number[]>();
  const allowedWeights = new Map<string, number[]>();
  for (const row of labelRows) {
    const bucket = row.label === 'blocked' ? blockedWeights : allowedWeights;
    const list = bucket.get(row.handle) ?? [];
    list.push(voteWeight(row.trust, ageDays(row.first_seen_at)));
    bucket.set(row.handle, list);
  }

  const daysByHandle = new Map<string, number>();
  for (const row of dayRows) daysByHandle.set(row.handle, row.days);

  const independentHandles = new Set<string>();
  const fingerprintEvidenceHandles = new Set<string>();
  const domainEvidenceHandles = new Set<string>();
  for (const row of fpRows) {
    independentHandles.add(row.handle);
    fingerprintEvidenceHandles.add(row.handle);
  }
  for (const row of domainRows) {
    independentHandles.add(row.handle);
    domainEvidenceHandles.add(row.handle);
  }

  const inputs = new Map<string, ConsensusV2Input>();
  for (const handle of unique) {
    inputs.set(handle, {
      blockedWeights: blockedWeights.get(handle) ?? [],
      allowedWeights: allowedWeights.get(handle) ?? [],
      distinctDays: daysByHandle.get(handle) ?? 0,
      evidenceIndependent: independentHandles.has(handle),
    });
  }
  return { inputs, fingerprintEvidenceHandles, domainEvidenceHandles };
}
/**
 * 快照聚合的共享产出：一次跑完全部社区聚合，供 generateSnapshot（快照内容）
 * 与 autoRateAccounts（v2 影子）共用，避免同一趟 cron 内 day / fp / domain
 * 各扫两遍 reports / active_labels。
 *
 * 原快照路径 4 条（day、fp、domain、evidence）+ v2 影子 4 条（label、day、fp、
 * domain）= 8 条全表扫；合并后 6 条：label、day、fp、domain、evidence、votes。
 */
export interface CommunityAggregates {
  v2Inputs: Map<string, ConsensusV2Input>;
  fingerprintsByHandle: Map<string, string[]>;
  domainsByHandle: Map<string, string[]>;
  daysByHandle: Map<string, number>;
  evidenceByHandle: Map<string, string[]>;
  /** 当前 blocked 票的 reason × detection_source 分布（分类推理输入） */
  votesByHandle: Map<string, CategoryVoteRow[]>;
}

/** 快照证据下发上限 / 门槛（与快照 schema 对齐；改动需同步快照侧语义）。 */
export const SNAPSHOT_EVIDENCE = {
  maxPerEntry: 5,
  minInstalls: 2,
} as const;

export async function loadCommunityAggregates(env: Cloudflare.Env): Promise<CommunityAggregates> {
  const db = getDb(env);
  const [labelRows, dayRows, fpRows, domainRows, evidenceRows, voteRows] = await Promise.all([
    // v2 权重：每张当前票对应的安装 trust 与成熟度
    db
      .select({
        handle: activeLabels.handle,
        label: activeLabels.label,
        trust: installations.trust,
        first_seen_at: installations.firstSeenAt,
      })
      .from(activeLabels)
      .innerJoin(installations, eq(installations.id, activeLabels.installationId)),
    // 日去重（快照 days + v2 distinctDays 共用）
    db
      .select({ handle: reports.handle, days: distinctDays })
      .from(reports)
      .innerJoin(activeLabels, blockedReportOn)
      .groupBy(reports.handle),
    // 内容指纹（快照前 N + v2 独立性共用；reports 唯一索引保证一行 = 独立安装）。
    // 指纹按字节序比较（collate "C"），与 SQLite 的 BINARY 排序一致。
    db
      .select({ handle: reports.handle, fp: sql<string>`${reports.contentFingerprint}` })
      .from(reports)
      .innerJoin(activeLabels, blockedReportOn)
      .where(isNotNull(reports.contentFingerprint))
      .groupBy(reports.handle, reports.contentFingerprint)
      .having(sql`count(*) >= ${SNAPSHOT_EVIDENCE.minInstalls}`)
      .orderBy(
        asc(collateC(reports.handle)),
        sql`count(*) desc`,
        sql`${reports.contentFingerprint} collate "C" asc`,
      ),
    // 域名（快照前 N + v2 独立性共用）：link_domains JSON 文本 + JS 计数，
    // 与 v0.4 的 collectContentEvidence 语义保持一致
    db
      .select({ handle: reports.handle, link_domains: sql<string>`${reports.linkDomains}` })
      .from(reports)
      .innerJoin(activeLabels, blockedReportOn)
      .where(isNotNull(reports.linkDomains)),
    // 内容证据帖（每账号至多前 N 条，按证据帖字节序取，产出确定）
    db.execute<{ handle: string; evidence_post_id: string }>(sql`
      SELECT handle, evidence_post_id FROM (
        SELECT d.handle, d.evidence_post_id,
               ROW_NUMBER() OVER (
                 PARTITION BY d.handle
                 ORDER BY d.evidence_post_id COLLATE "C" ASC
               ) AS rn
        FROM (
          SELECT DISTINCT r.handle, r.evidence_post_id
          FROM ${reports} r
          JOIN ${activeLabels} l
            ON l.installation_id = r.installation_id
           AND l.handle = r.handle
           AND l.label = 'blocked'
          WHERE r.evidence_post_id IS NOT NULL
        ) AS d
      ) AS ranked
      WHERE rn <= ${SNAPSHOT_EVIDENCE.maxPerEntry}
      ORDER BY handle COLLATE "C" ASC, rn ASC`),
    // 票型分布（分类推理输入）：reports 唯一索引保证一行 = 一个安装的当前票，
    // reason/detection_source 为该票最新值，与「one_current_vote_per_installation」一致
    db
      .select({
        handle: reports.handle,
        reason: reports.reason,
        detection_source: reports.detectionSource,
        n: count(),
      })
      .from(reports)
      .innerJoin(activeLabels, blockedReportOn)
      .groupBy(reports.handle, reports.reason, reports.detectionSource),
  ]);

  const now = Math.floor(Date.now() / 1000);
  const ageDays = (firstSeenAt: number): number => Math.max(0, (now - firstSeenAt) / 86400);

  // v2 输入组装
  const blockedWeights = new Map<string, number[]>();
  const allowedWeights = new Map<string, number[]>();
  for (const row of labelRows) {
    const weight = voteWeight(row.trust, ageDays(row.first_seen_at));
    const bucket = row.label === 'blocked' ? blockedWeights : allowedWeights;
    const list = bucket.get(row.handle) ?? [];
    list.push(weight);
    bucket.set(row.handle, list);
  }
  const daysByHandle = new Map<string, number>();
  for (const row of dayRows) daysByHandle.set(row.handle, row.days);

  // 指纹：按安装数降序取前 N，最终字典序排序保证确定性 JSON（快照原语义）
  const fingerprintsByHandle = new Map<string, string[]>();
  for (const row of fpRows) {
    const list = fingerprintsByHandle.get(row.handle) ?? [];
    if (list.length < SNAPSHOT_EVIDENCE.maxPerEntry) {
      list.push(row.fp);
      fingerprintsByHandle.set(row.handle, list);
    }
  }
  for (const list of fingerprintsByHandle.values()) list.sort();

  // 域名：每 (handle, domain) 按安装数计数，>=2 的取前 N，字典序排序（快照原语义）
  const domainCounts = new Map<string, Map<string, number>>();
  for (const row of domainRows) {
    try {
      const parsed = JSON.parse(row.link_domains) as unknown;
      if (!Array.isArray(parsed)) continue;
      const byDomain = domainCounts.get(row.handle) ?? new Map<string, number>();
      for (const d of parsed) {
        if (typeof d === 'string' && d) byDomain.set(d, (byDomain.get(d) ?? 0) + 1);
      }
      domainCounts.set(row.handle, byDomain);
    } catch {
      // 单行 link_domains 损坏不影响聚合
    }
  }
  const domainsByHandle = new Map<string, string[]>();
  for (const [handle, byDomain] of domainCounts) {
    const top = [...byDomain.entries()]
      .filter(([, installs]) => installs >= SNAPSHOT_EVIDENCE.minInstalls)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, SNAPSHOT_EVIDENCE.maxPerEntry)
      .map(([domain]) => domain)
      .sort();
    if (top.length > 0) domainsByHandle.set(handle, top);
  }

  // v2 独立性：存在 ≥1 个 ≥2 安装一致的指纹或域名即满足
  const independentHandles = new Set<string>();
  for (const row of fpRows) independentHandles.add(row.handle);
  for (const [handle, domains] of domainsByHandle) {
    if (domains.length > 0) independentHandles.add(handle);
  }

  const v2Inputs = new Map<string, ConsensusV2Input>();
  for (const handle of new Set([
    ...blockedWeights.keys(),
    ...allowedWeights.keys(),
    ...daysByHandle.keys(),
    ...independentHandles,
  ])) {
    v2Inputs.set(handle, {
      blockedWeights: blockedWeights.get(handle) ?? [],
      allowedWeights: allowedWeights.get(handle) ?? [],
      distinctDays: daysByHandle.get(handle) ?? 0,
      evidenceIndependent: independentHandles.has(handle),
    });
  }

  const evidenceByHandle = new Map<string, string[]>();
  for (const row of evidenceRows) {
    const list = evidenceByHandle.get(row.handle) ?? [];
    list.push(row.evidence_post_id);
    evidenceByHandle.set(row.handle, list);
  }

  const votesByHandle = new Map<string, CategoryVoteRow[]>();
  for (const row of voteRows) {
    const list = votesByHandle.get(row.handle) ?? [];
    list.push({ reason: row.reason, detectionSource: row.detection_source, count: row.n });
    votesByHandle.set(row.handle, list);
  }

  return {
    v2Inputs,
    fingerprintsByHandle,
    domainsByHandle,
    daysByHandle,
    evidenceByHandle,
    votesByHandle,
  };
}
