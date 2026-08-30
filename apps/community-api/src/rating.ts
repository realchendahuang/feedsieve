/**
 * 自动评级器（v0.5 Zero-admin）。
 *
 * 全部账号的状态由逻辑派生，没有任何人工背书：
 * - owner 票 >= 1（维护者拉黑）           → strong（全档可见）
 * - 普通独立票 >= strongThreshold          → strong
 * - 普通独立票 >= candidateThreshold       → candidate（默认档可见）
 * - rescue >= report_count（多数人抢救）    → new（退出快照）
 * - dismissed（owner 白名单裁决）          → 永久终态，后续举报不复活
 *
 * 在任何 publish / cron 评估前调用，保证快照只反映最新逻辑。
 */

import { POLICY } from './reports';

/** 账号评级所需的行（accounts 表 + 票数聚合后的形状） */
export interface RateableAccount {
  handle: string;
  status: string;
  report_count: number;
  rescue_count: number;
  owner_votes: number;
}

/** 根据纯票数/裁决派生目标状态（白盒逻辑，policy 端点可透明展示）。 */
export function deriveStatus(account: RateableAccount): string {
  // owner 白名单裁决：永久终态，任何票数不复活
  if (account.status === 'dismissed') {
    return 'dismissed';
  }
  // owner 拉黑：最高置信
  if (account.owner_votes >= 1) {
    return 'strong';
  }
  // 多数人抢救 >= 举报数：退出名单（candidate 级别自动降级；strong 也应收敛）
  if (account.rescue_count >= account.report_count && account.report_count > 0) {
    return 'new';
  }
  if (account.report_count >= POLICY.strongThreshold) {
    return 'strong';
  }
  if (account.report_count >= POLICY.candidateThreshold) {
    return 'candidate';
  }
  return 'new';
}

/**
 * 全表评估：每个账号按 deriveStatus 收敛目标状态。
 * 返回变更的账号数（dismissed 不变；new 保持 new；幂等）。
 */
export async function autoRateAccounts(
  env: Cloudflare.Env,
): Promise<{ changed: number }> {
  const rows = await env.DB.prepare(
    `SELECT handle, status, report_count, rescue_count, owner_votes
     FROM accounts`,
  ).all<RateableAccount>();
  let changed = 0;
  for (const row of rows.results) {
    const target = deriveStatus(row);
    if (target !== row.status) {
      await env.DB.prepare('UPDATE accounts SET status = ?2 WHERE handle = ?1')
        .bind(row.handle, target)
        .run();
      changed++;
    }
  }
  return { changed };
}