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

/** 从 active_labels + installations 载入单账号的 v2 输入（每张当前票对应一个安装）。 */
export async function loadConsensusV2Input(
  env: Cloudflare.Env,
  handle: string,
): Promise<ConsensusV2Input> {
  const now = Math.floor(Date.now() / 1000);
  const [blocked, allowed, daysRow, fpRow, domainRow] = await Promise.all([
    env.DB.prepare(
      `SELECT i.trust, i.first_seen_at
       FROM active_labels l
       JOIN installations i ON i.id = l.installation_id
       WHERE l.handle = ?1 AND l.label = 'blocked'`,
    )
      .bind(handle)
      .all<{ trust: number; first_seen_at: number }>(),
    env.DB.prepare(
      `SELECT i.trust, i.first_seen_at
       FROM active_labels l
       JOIN installations i ON i.id = l.installation_id
       WHERE l.handle = ?1 AND l.label = 'allowed'`,
    )
      .bind(handle)
      .all<{ trust: number; first_seen_at: number }>(),
    env.DB.prepare(
      `SELECT COUNT(DISTINCT date(r.created_at, 'unixepoch')) AS days
       FROM reports r
       JOIN active_labels l
         ON l.installation_id = r.installation_id
        AND l.handle = r.handle
        AND l.label = 'blocked'
       WHERE r.handle = ?1`,
    )
      .bind(handle)
      .first<{ days: number }>(),
    // 内容证据独立性：≥2 个独立安装上报同一指纹（reports 唯一索引保证一行 = 独立安装）
    env.DB.prepare(
      `SELECT r.content_fingerprint AS fp
       FROM reports r
       JOIN active_labels l
         ON l.installation_id = r.installation_id
        AND l.handle = r.handle
        AND l.label = 'blocked'
       WHERE r.handle = ?1 AND r.content_fingerprint IS NOT NULL
       GROUP BY r.content_fingerprint
       HAVING COUNT(*) >= 2
       LIMIT 1`,
    )
      .bind(handle)
      .first(),
    env.DB.prepare(
      `SELECT d.value AS domain
       FROM reports r
       JOIN active_labels l
         ON l.installation_id = r.installation_id
        AND l.handle = r.handle
        AND l.label = 'blocked'
       JOIN json_each(r.link_domains) AS d
       WHERE r.handle = ?1 AND r.link_domains IS NOT NULL
       GROUP BY d.value
       HAVING COUNT(DISTINCT r.installation_id) >= 2
       LIMIT 1`,
    )
      .bind(handle)
      .first(),
  ]);
  const ageDays = (install: { first_seen_at: number }): number =>
    Math.max(0, (now - install.first_seen_at) / 86400);
  return {
    blockedWeights: (blocked.results ?? []).map((row) => voteWeight(row.trust, ageDays(row))),
    allowedWeights: (allowed.results ?? []).map((row) => voteWeight(row.trust, ageDays(row))),
    distinctDays: daysRow?.days ?? 0,
    evidenceIndependent: Boolean(fpRow) || Boolean(domainRow),
  };
}

/** 载入 + 求值（labels/rating 共用）。 */
export async function computeConsensusV2ForAccount(
  env: Cloudflare.Env,
  handle: string,
): Promise<ConsensusV2Result> {
  const input = await loadConsensusV2Input(env, handle);
  return computeConsensusV2(input);
}