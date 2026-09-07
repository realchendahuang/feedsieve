/**
 * 社区入榜状态收敛器。
 *
 * 唯一公式：report_count - rescue_count >= 3 → strong（进入最终黑名单），
 * 否则 new（不进入最终黑名单）。维护者条目走独立表，不伪造社区票数。
 *
 * 在任何 publish / cron 评估前调用，保证快照只反映最新逻辑。
 */

import { POLICY } from './reports';
import {
  computeConsensusV2,
  EMPTY_CONSENSUS_V2_INPUT,
  loadAllConsensusV2Inputs,
} from './lib/consensus-v2';

// D1 batch 与单条查询的绑定参数上限一致，按 100 分片。
const D1_CHUNK = 100;

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
 * 全表评估：每个账号按 deriveStatus 收敛目标状态，并同步 consensus v2 影子。
 * 返回变更的账号数；幂等。
 *
 * v2 影子用 loadAllConsensusV2Inputs 一次取回输入 + DB.batch 写回，
 * 避免逐账号查询（N×6 次 D1 请求）在账号多时撞单次 invocation 请求上限。
 */
export async function autoRateAccounts(env: Cloudflare.Env): Promise<{ changed: number }> {
  const rows = await env.DB.prepare(
    `SELECT handle, status, report_count, rescue_count
     FROM accounts`,
  ).all<RateableAccount>();
  const v2Inputs = await loadAllConsensusV2Inputs(env);

  const statements: D1PreparedStatement[] = [];
  let changed = 0;
  for (const row of rows.results) {
    const target = deriveStatus(row);
    if (target !== row.status) {
      statements.push(
        env.DB.prepare('UPDATE accounts SET status = ?2 WHERE handle = ?1')
          .bind(row.handle, target),
      );
      changed++;
    }
    // consensus v2 影子：全表重算，与入榜逻辑无关
    const v2 = computeConsensusV2(v2Inputs.get(row.handle) ?? EMPTY_CONSENSUS_V2_INPUT);
    statements.push(
      env.DB.prepare('UPDATE accounts SET status_v2 = ?2, consensus_v2 = ?3 WHERE handle = ?1')
        .bind(row.handle, v2.status, v2.score),
    );
  }
  for (let index = 0; index < statements.length; index += D1_CHUNK) {
    await env.DB.batch(statements.slice(index, index + D1_CHUNK));
  }
  return { changed };
}