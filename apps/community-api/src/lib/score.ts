/**
 * Community Score v1 —— 可解释公式（OPEN_SOURCE_GOVERNANCE.md：算法公开）。
 *
 *   effective  = report_count - rescue_count           （票数，抢救抵扣）
 *   score      = effective / (effective + 3)           （饱和曲线：3票=0.5，7票=0.7，17票=0.85）
 *   + 多天持续出现加成：+2%/额外天，封顶 +0.1
 *   - 单日集中爆发打折：report_count ≥ 5 且全部落在 1 天内 → ×0.8
 *
 * 输出 clamp 到 [0,1]，两位小数。所有参数公开在 community/policy/v3.yaml。
 */

export const SCORE_POLICY = {
  saturation: 3,
  dayBonus: 0.02,
  dayBonusCap: 0.1,
  burstMinReports: 5,
  burstPenaltyFactor: 0.8,
} as const;

export interface ScoreInput {
  reportCount: number;
  rescueCount: number;
  /** 该账号的独立上报日数（date 维度去重） */
  distinctDays: number;
}

export function computeScore(input: ScoreInput): number {
  const effective = Math.max(0, input.reportCount - input.rescueCount);
  if (effective === 0) {
    return 0;
  }

  let score = effective / (effective + SCORE_POLICY.saturation);

  const dayBonus = Math.min(
    Math.max(0, input.distinctDays - 1) * SCORE_POLICY.dayBonus,
    SCORE_POLICY.dayBonusCap,
  );
  score += dayBonus;

  const isBurst =
    input.reportCount >= SCORE_POLICY.burstMinReports &&
    input.distinctDays <= 1;
  if (isBurst) {
    score *= SCORE_POLICY.burstPenaltyFactor;
  }

  return Math.round(Math.min(1, Math.max(0, score)) * 100) / 100;
}
