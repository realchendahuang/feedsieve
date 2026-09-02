/**
 * 社区入榜状态收敛器。
 *
 * 唯一公式：report_count - rescue_count >= 3 → strong（进入最终黑名单），
 * 否则 new（不进入最终黑名单）。维护者条目走独立表，不伪造社区票数。
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
}

/** 根据纯净票数派生内部状态（白盒逻辑，policy 端点可透明展示）。 */
export function deriveStatus(account: RateableAccount): string {
  if (account.report_count - account.rescue_count >= POLICY.communityNetThreshold) {
    return 'strong';
  }
  return 'new';
}

/**
 * 全表评估：每个账号按 deriveStatus 收敛目标状态。
 * 返回变更的账号数；幂等。
 */
export async function autoRateAccounts(env: Cloudflare.Env): Promise<{ changed: number }> {
  const rows = await env.DB.prepare(
    `SELECT handle, status, report_count, rescue_count
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
