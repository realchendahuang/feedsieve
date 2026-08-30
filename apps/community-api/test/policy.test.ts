import { describe, expect, it } from 'vitest';
import policyYaml from '../../community/policy/v1.yaml?raw';
import { POLICY } from '../src/reports';
import { SCORE_POLICY } from '../src/lib/score';

/**
 * 漂移守卫：community/policy/v1.yaml 是公开事实源，
 * 代码常量改动必须同步 yaml（?raw 导入，构建期内联，不依赖运行时 fs）。
 */
describe('policy yaml ↔ code constants', () => {
  const yaml = policyYaml;

  it('candidate threshold matches', () => {
    expect(yaml).toContain(`min_independent_reports: ${POLICY.candidateThreshold}`);
  });

  it('strong threshold matches', () => {
    expect(yaml).toContain(`min_independent_reports: ${POLICY.strongThreshold}`);
  });

  it('zero-human-review principle is codified', () => {
    expect(yaml).toContain('zero_human_review');
    expect(yaml).toContain('owner_veto_is_final');
  });

  it('limit values match', () => {
    expect(yaml).toContain(`daily_report_base: ${POLICY.dailyReportLimit}`);
    expect(yaml).toContain(`daily_rescue_base: ${POLICY.rescueDailyLimit}`);
    expect(yaml).toContain(`daily_min: ${POLICY.minDailyLimit}`);
    expect(yaml).toContain(`max_batch: ${POLICY.maxBatch}`);
  });

  it('trust values match', () => {
    expect(yaml).toContain(`default: 1.0`);
    expect(yaml).toContain(`floor: ${POLICY.trustFloor}`);
    expect(yaml).toContain(`burst_threshold: ${POLICY.trustBurstThreshold}`);
    expect(yaml).toContain(`burst_decay: ${POLICY.trustDecay}`);
  });

  it('score params match', () => {
    expect(yaml).toContain(`saturation: ${SCORE_POLICY.saturation}`);
    expect(yaml).toContain(
      `temporal_spread_bonus_per_extra_day: ${SCORE_POLICY.dayBonus}`,
    );
    expect(yaml).toContain(`temporal_spread_bonus_max: ${SCORE_POLICY.dayBonusCap}`);
    expect(yaml).toContain(`burst_min_reports: ${SCORE_POLICY.burstMinReports}`);
    expect(yaml).toContain(
      `burst_penalty_factor: ${SCORE_POLICY.burstPenaltyFactor}`,
    );
  });
});
