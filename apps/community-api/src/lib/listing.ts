/**
 * 社区黑名单入榜判定（纯函数，政策 v4，公开在 community/policy/v4.yaml）。
 *
 * 一个账号进入最终黑名单，满足其一：
 *
 * 1. 共识上榜：净票（拉黑票 − 误标票）≥ 3，并且至少满足一条独立性要求：
 *    - consensus v2 加权共识达标（按安装信任 × 安装成熟度加权，且有时间或证据独立性）；
 *    - 拉黑票横跨 ≥ 2 个 UTC 自然日；
 *    - 净票 ≥ 5。
 *    挡住的是「同一天冒出来的 3–4 个安装」这种最便宜的刷榜方式。
 * 2. 佐证上榜：净票 ≥ 2、没有任何误标票，并且最近 7 天被 ≥ 3 个不同网段的用户的本地规则命中，
 *    或属于同模板批量号（见 rule-hits.ts isCorroborated）。规则命中本身不是票，只作独立佐证。
 *
 * 另外，探活确认已注销 / 冻结的账号不再下发（拉不黑，也不会再发帖），名单因此不会只增不减。
 */
import { POLICY } from '../reports';
import { isCorroborated, type HitSignal } from '../rule-hits';

export const LISTING_POLICY = {
  version: 4,
  minNetVotes: POLICY.communityNetThreshold,
  /** 拉黑票横跨的 UTC 自然日数 */
  minDistinctDays: 2,
  /** 净票达到这个数时不再要求独立性 */
  unconditionalNetVotes: 5,
} as const;

export interface ListingInput {
  report_count: number;
  rescue_count: number;
  /** accounts.status_v2（consensus v2 结果） */
  status_v2: string;
  /** 拉黑票横跨的 UTC 自然日数 */
  distinct_days: number;
  /** 探活确认已注销 / 冻结 */
  dead: boolean;
}

export type ListingReason = 'consensus' | 'corroborated';

export function listingReason(
  account: ListingInput,
  signal: HitSignal | undefined,
): ListingReason | null {
  if (account.dead) return null;
  const net = account.report_count - account.rescue_count;
  if (net >= LISTING_POLICY.minNetVotes) {
    if (
      account.status_v2 === 'strong' ||
      account.distinct_days >= LISTING_POLICY.minDistinctDays ||
      net >= LISTING_POLICY.unconditionalNetVotes
    ) {
      return 'consensus';
    }
  }
  return isCorroborated(account, signal) ? 'corroborated' : null;
}
