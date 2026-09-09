/**
 * consensus v2（影子）：对社区入榜的 Sybil 加固候选公式。
 *
 * 只写入 accounts.status_v2 / consensus_v2 供影子对比与后续切换，不参与入榜：
 * deriveStatus 与快照 SQL 一律仍用 v1（report_count - rescue_count >= 3）。
 *
 * 与 v1 的差别：
 * - 每张票按「安装信任 × 安装成熟度」加权：新安装（< probationDays）权重被压低，
 *   老安装正常计权 —— 两个小时内冒出的三个新安装不再等于三个独立长期观察者；
 * - 入榜同时要求「加权净票达标」与「时间或证据独立性」：
 *   举报横跨多个日期，或存在 ≥2 个独立安装一致上报的内容指纹/域名。
 */

import type { CategoryVoteRow } from '../category-inference';

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

/**
 * 全表批量载入 v2 输入（影子重算用）。
 *
 * autoRateAccounts 对全表做影子重算时，逐账号 loadConsensusV2Input 会放大成
 * N×6 次 D1 请求，账号多了会撞单次 invocation 的请求上限（1000）；
 * 这里用 4 条聚合 SQL 一次取回全部输入，在内存里组装。
 */
export async function loadAllConsensusV2Inputs(
  env: Cloudflare.Env,
): Promise<Map<string, ConsensusV2Input>> {
  const [labelRows, dayRows, fpRows, domainRows] = await Promise.all([
    env.DB.prepare(
      `SELECT l.handle, l.label, i.trust, i.first_seen_at
       FROM active_labels l
       JOIN installations i ON i.id = l.installation_id`,
    ).all<{ handle: string; label: 'blocked' | 'allowed'; trust: number; first_seen_at: number }>(),
    env.DB.prepare(
      `SELECT r.handle, COUNT(DISTINCT date(r.created_at, 'unixepoch')) AS days
       FROM reports r
       JOIN active_labels l
         ON l.installation_id = r.installation_id
        AND l.handle = r.handle
        AND l.label = 'blocked'
       GROUP BY r.handle`,
    ).all<{ handle: string; days: number }>(),
    env.DB.prepare(
      `SELECT r.handle
       FROM reports r
       JOIN active_labels l
         ON l.installation_id = r.installation_id
        AND l.handle = r.handle
        AND l.label = 'blocked'
       WHERE r.content_fingerprint IS NOT NULL
       GROUP BY r.handle, r.content_fingerprint
       HAVING COUNT(*) >= 2`,
    ).all<{ handle: string }>(),
    env.DB.prepare(
      `SELECT r.handle
       FROM reports r
       JOIN active_labels l
         ON l.installation_id = r.installation_id
        AND l.handle = r.handle
        AND l.label = 'blocked'
       JOIN json_each(r.link_domains) AS d
       WHERE r.link_domains IS NOT NULL
       GROUP BY r.handle, d.value
       HAVING COUNT(DISTINCT r.installation_id) >= 2`,
    ).all<{ handle: string }>(),
  ]);

  const now = Math.floor(Date.now() / 1000);
  const ageDays = (firstSeenAt: number): number => Math.max(0, (now - firstSeenAt) / 86400);

  // 按 handle 聚合权重
  const blockedWeights = new Map<string, number[]>();
  const allowedWeights = new Map<string, number[]>();
  for (const row of labelRows.results ?? []) {
    const weight = voteWeight(row.trust, ageDays(row.first_seen_at));
    const bucket = row.label === 'blocked' ? blockedWeights : allowedWeights;
    const list = bucket.get(row.handle) ?? [];
    list.push(weight);
    bucket.set(row.handle, list);
  }

  const distinctDays = new Map<string, number>();
  for (const row of dayRows.results ?? []) distinctDays.set(row.handle, row.days);

  const independentHandles = new Set<string>();
  for (const row of fpRows.results ?? []) independentHandles.add(row.handle);
  for (const row of domainRows.results ?? []) independentHandles.add(row.handle);

  const handles = new Set([
    ...blockedWeights.keys(),
    ...allowedWeights.keys(),
    ...distinctDays.keys(),
    ...independentHandles,
  ]);
  const inputs = new Map<string, ConsensusV2Input>();
  for (const handle of handles) {
    inputs.set(handle, {
      blockedWeights: blockedWeights.get(handle) ?? [],
      allowedWeights: allowedWeights.get(handle) ?? [],
      distinctDays: distinctDays.get(handle) ?? 0,
      evidenceIndependent: independentHandles.has(handle),
    });
  }
  return inputs;
}

/**
 * 按 handle 集合批量载入 v2 输入。
 *
 * labels.ts 的 refreshAccountsFromLabels 对一批标签变更收敛计数时使用：
 * 逐账号 loadConsensusV2Input（N×5 次 D1 请求）会撞单次 invocation 的请求上限，
 * 这里用 5 条 IN 聚合 SQL 一次取回全部输入，在内存里组装。
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
  const inClause = unique.map((_, index) => `?${index + 1}`).join(', ');

  const [blockedRows, allowedRows, dayRows, fpRows, domainRows] = await Promise.all([
    env.DB.prepare(
      `SELECT l.handle, i.trust, i.first_seen_at
       FROM active_labels l
       JOIN installations i ON i.id = l.installation_id
       WHERE l.handle IN (${inClause}) AND l.label = 'blocked'`,
    )
      .bind(...unique)
      .all<{ handle: string; trust: number; first_seen_at: number }>(),
    env.DB.prepare(
      `SELECT l.handle, i.trust, i.first_seen_at
       FROM active_labels l
       JOIN installations i ON i.id = l.installation_id
       WHERE l.handle IN (${inClause}) AND l.label = 'allowed'`,
    )
      .bind(...unique)
      .all<{ handle: string; trust: number; first_seen_at: number }>(),
    env.DB.prepare(
      `SELECT r.handle, COUNT(DISTINCT date(r.created_at, 'unixepoch')) AS days
       FROM reports r
       JOIN active_labels l
         ON l.installation_id = r.installation_id
        AND l.handle = r.handle
        AND l.label = 'blocked'
       WHERE r.handle IN (${inClause})
       GROUP BY r.handle`,
    )
      .bind(...unique)
      .all<{ handle: string; days: number }>(),
    env.DB.prepare(
      `SELECT r.handle
       FROM reports r
       JOIN active_labels l
         ON l.installation_id = r.installation_id
        AND l.handle = r.handle
        AND l.label = 'blocked'
       WHERE r.handle IN (${inClause}) AND r.content_fingerprint IS NOT NULL
       GROUP BY r.handle, r.content_fingerprint
       HAVING COUNT(*) >= 2`,
    )
      .bind(...unique)
      .all<{ handle: string }>(),
    env.DB.prepare(
      `SELECT r.handle
       FROM reports r
       JOIN active_labels l
         ON l.installation_id = r.installation_id
        AND l.handle = r.handle
        AND l.label = 'blocked'
       JOIN json_each(r.link_domains) AS d
       WHERE r.handle IN (${inClause}) AND r.link_domains IS NOT NULL
       GROUP BY r.handle, d.value
       HAVING COUNT(DISTINCT r.installation_id) >= 2`,
    )
      .bind(...unique)
      .all<{ handle: string }>(),
  ]);

  const now = Math.floor(Date.now() / 1000);
  const ageDays = (firstSeenAt: number): number => Math.max(0, (now - firstSeenAt) / 86400);

  // 按 handle 聚合权重
  const blockedWeights = new Map<string, number[]>();
  const allowedWeights = new Map<string, number[]>();
  for (const row of blockedRows.results ?? []) {
    const list = blockedWeights.get(row.handle) ?? [];
    list.push(voteWeight(row.trust, ageDays(row.first_seen_at)));
    blockedWeights.set(row.handle, list);
  }
  for (const row of allowedRows.results ?? []) {
    const list = allowedWeights.get(row.handle) ?? [];
    list.push(voteWeight(row.trust, ageDays(row.first_seen_at)));
    allowedWeights.set(row.handle, list);
  }

  const distinctDays = new Map<string, number>();
  for (const row of dayRows.results ?? []) distinctDays.set(row.handle, row.days);

  const independentHandles = new Set<string>();
  const fingerprintEvidenceHandles = new Set<string>();
  const domainEvidenceHandles = new Set<string>();
  for (const row of fpRows.results ?? []) {
    independentHandles.add(row.handle);
    fingerprintEvidenceHandles.add(row.handle);
  }
  for (const row of domainRows.results ?? []) {
    independentHandles.add(row.handle);
    domainEvidenceHandles.add(row.handle);
  }

  const inputs = new Map<string, ConsensusV2Input>();
  for (const handle of unique) {
    inputs.set(handle, {
      blockedWeights: blockedWeights.get(handle) ?? [],
      allowedWeights: allowedWeights.get(handle) ?? [],
      distinctDays: distinctDays.get(handle) ?? 0,
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
  const [labelRows, dayRows, fpRows, domainRows, evidenceRows, voteRows] = await Promise.all([
    // v2 权重：每张当前票对应的安装 trust 与成熟度
    env.DB.prepare(
      `SELECT l.handle, l.label, i.trust, i.first_seen_at
       FROM active_labels l
       JOIN installations i ON i.id = l.installation_id`,
    ).all<{ handle: string; label: 'blocked' | 'allowed'; trust: number; first_seen_at: number }>(),
    // 日去重（快照 days + v2 distinctDays 共用）
    env.DB.prepare(
      `SELECT r.handle, COUNT(DISTINCT date(r.created_at, 'unixepoch')) AS days
       FROM reports r
       JOIN active_labels l
         ON l.installation_id = r.installation_id
        AND l.handle = r.handle
        AND l.label = 'blocked'
       GROUP BY r.handle`,
    ).all<{ handle: string; days: number }>(),
    // 内容指纹（快照前 N + v2 独立性共用；reports 唯一索引保证一行 = 独立安装）
    env.DB.prepare(
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
      .bind(SNAPSHOT_EVIDENCE.minInstalls)
      .all<{ handle: string; fp: string }>(),
    // 域名（快照前 N + v2 独立性共用）：link_domains JSON 文本 + JS 计数，
    // 与 v0.4 的 collectContentEvidence 语义保持一致
    env.DB.prepare(
      `SELECT r.handle, r.link_domains
       FROM reports r
       JOIN active_labels l
         ON l.installation_id = r.installation_id
        AND l.handle = r.handle
        AND l.label = 'blocked'
       WHERE r.link_domains IS NOT NULL`,
    ).all<{ handle: string; link_domains: string }>(),
    // 内容证据帖（每账号至多前 N 条，按证据帖字典序取，产出确定）
    env.DB.prepare(
      `SELECT handle, evidence_post_id FROM (
         SELECT d.handle, d.evidence_post_id,
                ROW_NUMBER() OVER (
                  PARTITION BY d.handle
                  ORDER BY d.evidence_post_id ASC
                ) AS rn
         FROM (
           SELECT DISTINCT r.handle, r.evidence_post_id
           FROM reports r
           JOIN active_labels l
             ON l.installation_id = r.installation_id
            AND l.handle = r.handle
            AND l.label = 'blocked'
           WHERE r.evidence_post_id IS NOT NULL
         ) AS d
       ) WHERE rn <= ?1
       ORDER BY handle ASC`,
    )
      .bind(SNAPSHOT_EVIDENCE.maxPerEntry)
      .all<{ handle: string; evidence_post_id: string }>(),
    // 票型分布（分类推理输入）：reports 唯一索引保证一行 = 一个安装的当前票，
    // reason/detection_source 为该票最新值，与「one_current_vote_per_installation」一致
    env.DB.prepare(
      `SELECT r.handle, r.reason, r.detection_source, COUNT(*) AS n
       FROM reports r
       JOIN active_labels l
         ON l.installation_id = r.installation_id
        AND l.handle = r.handle
        AND l.label = 'blocked'
       GROUP BY r.handle, r.reason, r.detection_source`,
    ).all<{ handle: string; reason: string; detection_source: string | null; n: number }>(),
  ]);

  const now = Math.floor(Date.now() / 1000);
  const ageDays = (firstSeenAt: number): number => Math.max(0, (now - firstSeenAt) / 86400);

  // v2 输入组装
  const blockedWeights = new Map<string, number[]>();
  const allowedWeights = new Map<string, number[]>();
  for (const row of labelRows.results ?? []) {
    const weight = voteWeight(row.trust, ageDays(row.first_seen_at));
    const bucket = row.label === 'blocked' ? blockedWeights : allowedWeights;
    const list = bucket.get(row.handle) ?? [];
    list.push(weight);
    bucket.set(row.handle, list);
  }
  const daysByHandle = new Map<string, number>();
  for (const row of dayRows.results ?? []) daysByHandle.set(row.handle, row.days);

  // 指纹：按安装数降序取前 N，最终字典序排序保证确定性 JSON（快照原语义）
  const fingerprintsByHandle = new Map<string, string[]>();
  for (const row of fpRows.results ?? []) {
    const list = fingerprintsByHandle.get(row.handle) ?? [];
    if (list.length < SNAPSHOT_EVIDENCE.maxPerEntry) {
      list.push(row.fp);
      fingerprintsByHandle.set(row.handle, list);
    }
  }
  for (const list of fingerprintsByHandle.values()) list.sort();

  // 域名：每 (handle, domain) 按安装数计数，>=2 的取前 N，字典序排序（快照原语义）
  const domainCounts = new Map<string, Map<string, number>>();
  for (const row of domainRows.results ?? []) {
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
  for (const row of fpRows.results ?? []) independentHandles.add(row.handle);
  for (const [handle, domains] of domainsByHandle) {
    if (domains.length > 0) independentHandles.add(handle);
  }

  const v2Inputs = new Map<string, ConsensusV2Input>();
  for (const handle of new Set([...blockedWeights.keys(), ...allowedWeights.keys(), ...daysByHandle.keys(), ...independentHandles])) {
    v2Inputs.set(handle, {
      blockedWeights: blockedWeights.get(handle) ?? [],
      allowedWeights: allowedWeights.get(handle) ?? [],
      distinctDays: daysByHandle.get(handle) ?? 0,
      evidenceIndependent: independentHandles.has(handle),
    });
  }

  const evidenceByHandle = new Map<string, string[]>();
  for (const row of evidenceRows.results ?? []) {
    const list = evidenceByHandle.get(row.handle) ?? [];
    list.push(row.evidence_post_id);
    evidenceByHandle.set(row.handle, list);
  }

  const votesByHandle = new Map<string, CategoryVoteRow[]>();
  for (const row of voteRows.results ?? []) {
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
