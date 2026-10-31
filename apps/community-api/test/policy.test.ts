import { describe, expect, it } from 'vitest';
import policyYaml from '../../community/policy/v4.yaml?raw';
import { CONSENSUS_V2_POLICY } from '../src/lib/consensus-v2';
import { LISTING_POLICY } from '../src/lib/listing';
import { RULE_HIT_POLICY } from '../src/rule-hits';
import { SNAPSHOT_MIN_INTERVAL_S } from '../src/snapshot';
import { POLICY } from '../src/reports';
import { SCORE_POLICY } from '../src/lib/score';

/**
 * 漂移守卫：community/policy/v4.yaml 是公开事实源，
 * 代码常量改动必须同步 yaml（?raw 导入，构建期内联，不依赖运行时 fs）。
 */
describe('policy yaml ↔ code constants', () => {
  const yaml = policyYaml;

  it('community net-vote threshold matches', () => {
    expect(yaml).toContain('formula: block_votes - false_positive_votes');
    expect(yaml).toContain(`min_net_votes: ${POLICY.communityNetThreshold}`);
  });

  it('maintainer source is transparent and does not receive weighted votes', () => {
    expect(yaml).toContain('weighted_vote: false');
    expect(yaml).toContain('maintainer_source_is_publicly_labeled');
    expect(yaml).toContain('maintainer_does_not_modify_community_votes');
  });

  it('limit values match', () => {
    expect(yaml).toContain(`daily_report_base: ${POLICY.dailyReportLimit}`);
    expect(yaml).toContain(`daily_rescue_base: ${POLICY.rescueDailyLimit}`);
    expect(yaml).toContain(`daily_min: ${POLICY.minDailyLimit}`);
    expect(yaml).toContain(`max_batch: ${POLICY.maxBatch}`);
    expect(yaml).toContain(`daily_ip_report_limit: ${POLICY.dailyIpReportLimit}`);
    expect(yaml).toContain(`daily_alias_cap: ${POLICY.aliasesPerDay}`);
  });

  it('trust values match', () => {
    expect(yaml).toContain(`default: 1.0`);
    expect(yaml).toContain(`floor: ${POLICY.trustFloor}`);
    expect(yaml).toContain(`burst_threshold: ${POLICY.trustBurstThreshold}`);
    expect(yaml).toContain(`burst_decay: ${POLICY.trustDecay}`);
  });

  it('score params match', () => {
    expect(yaml).toContain(`saturation: ${SCORE_POLICY.saturation}`);
    expect(yaml).toContain(`temporal_spread_bonus_per_extra_day: ${SCORE_POLICY.dayBonus}`);
    expect(yaml).toContain(`temporal_spread_bonus_max: ${SCORE_POLICY.dayBonusCap}`);
    expect(yaml).toContain(`burst_min_reports: ${SCORE_POLICY.burstMinReports}`);
    expect(yaml).toContain(`burst_penalty_factor: ${SCORE_POLICY.burstPenaltyFactor}`);
  });

  it('listing independence and corroboration match', () => {
    expect(yaml).toContain(`version: ${LISTING_POLICY.version}`);
    expect(yaml).toContain(`min_distinct_days: ${LISTING_POLICY.minDistinctDays}`);
    expect(yaml).toContain(`unconditional_net_votes: ${LISTING_POLICY.unconditionalNetVotes}`);
    expect(yaml).toContain(`min_net_votes: ${RULE_HIT_POLICY.corroboratedMinNet}`);
    expect(yaml).toContain(`min_rule_hit_networks_7d: ${RULE_HIT_POLICY.corroboratedMinNets}`);
    expect(yaml).toContain(`min_accounts: ${RULE_HIT_POLICY.campaignMinAccounts}`);
    expect(yaml).toContain(`min_networks: ${RULE_HIT_POLICY.campaignMinNets}`);
  });

  it('consensus v2 parameters match', () => {
    expect(yaml).toContain(`probation_days: ${CONSENSUS_V2_POLICY.probationDays}`);
    expect(yaml).toContain(`min_weight: ${CONSENSUS_V2_POLICY.minWeight}`);
    expect(yaml).toContain(`weighted_net_threshold: ${CONSENSUS_V2_POLICY.weightedNetThreshold}`);
  });

  it('rule feedback and publishing parameters match', () => {
    expect(yaml).toContain(`window_days: ${RULE_HIT_POLICY.feedbackWindowDays}`);
    expect(yaml).toContain(`auto_mute_min_hit_accounts: ${RULE_HIT_POLICY.muteMinHitAccounts}`);
    expect(yaml).toContain(
      `auto_mute_min_false_positive_installs: ${RULE_HIT_POLICY.muteMinRescueInstalls}`,
    );
    expect(yaml).toContain(`auto_mute_false_positive_rate: ${RULE_HIT_POLICY.muteFpRate}`);
    expect(yaml).toContain(`max_new_mutes_per_run: ${RULE_HIT_POLICY.muteMaxPerRun}`);
    expect(yaml).toContain(`retention_days: ${RULE_HIT_POLICY.retentionDays}`);
    expect(yaml).toContain(`hold_hours: ${RULE_HIT_POLICY.muteHoldHours}`);
    expect(yaml).toContain(
      `false_positive_min_install_days: ${RULE_HIT_POLICY.muteRescueMinInstallDays}`,
    );
    expect(yaml).toContain(`network_daily_limit: ${RULE_HIT_POLICY.ipDaily}`);
    expect(yaml).toContain(`session_daily_limit: ${RULE_HIT_POLICY.sessionDaily}`);
    expect(yaml).toContain(`min_interval_minutes: ${SNAPSHOT_MIN_INTERVAL_S / 60}`);
  });
});
