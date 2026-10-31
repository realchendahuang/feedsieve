/**
 * 社区入榜状态收敛器。
 *
 * 唯一公式：report_count - rescue_count >= 3 → strong（进入最终黑名单），
 * 否则 new（不进入最终黑名单）。维护者条目走独立表，不伪造社区票数。
 *
 * 在任何 publish / cron 评估前调用，保证快照只反映最新逻辑。
 */
import { sql } from 'drizzle-orm';
import { getDb, retryOnConflict } from './db/client';
import { compareText } from './lib/sql';
import { accounts } from './db/schema';
import { POLICY } from './reports';
import { syncConsensusEvents, type ConsensusTransition } from './consensus-events';
import {
  computeConsensusV2,
  EMPTY_CONSENSUS_V2_INPUT,
  loadAllConsensusV2Inputs,
  type CommunityAggregates,
} from './lib/consensus-v2';

/** 单条 UPDATE … FROM (VALUES …) 的行数上限：5 个参数 × 1000 行，远低于 PG 的 65535 */
const UPDATE_CHUNK = 1000;

/** 账号评级所需的行（accounts 表 + 票数聚合后的形状） */
export interface RateableAccount {
  handle: string;
  status: string;
  report_count: number;
  rescue_count: number;
  x_user_id?: string | null;
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
 * v2 影子用 loadAllConsensusV2Inputs 一次取回输入，写回按 1000 行一条
 * UPDATE … FROM (VALUES …)，避免逐账号查询在账号多时放大成海量往返。
 * 快照发布路径已先 loadCommunityAggregates，传入 aggregates 可跳过重复聚合。
 */
export async function autoRateAccounts(
  env: Cloudflare.Env,
  aggregates?: CommunityAggregates,
): Promise<{ changed: number }> {
  const db = getDb(env);
  const rows = await db
    .select({
      handle: accounts.handle,
      x_user_id: accounts.xUserId,
      status: accounts.status,
      report_count: accounts.reportCount,
      rescue_count: accounts.rescueCount,
    })
    .from(accounts);
  // 按主键排序：并发的整表重写以相同顺序锁行，避免死锁
  rows.sort((a, b) => compareText(a.handle, b.handle));
  const v2Inputs = aggregates?.v2Inputs ?? (await loadAllConsensusV2Inputs(env));

  const updates: ReturnType<typeof sql>[] = [];
  // 进/出 strong 的账号同步共识事件（供死账号探活定位新进共识账号，快照路径兜底）
  const consensusTransitions = new Map<string, ConsensusTransition>();
  let changed = 0;
  for (const row of rows) {
    const target = deriveStatus(row);
    const statusChanged = target !== row.status;
    if (statusChanged) {
      changed++;
      consensusTransitions.set(row.handle, {
        strong: target === 'strong',
        xUserId: row.x_user_id ?? null,
      });
    }
    // consensus v2 影子：全表重算，与入榜逻辑无关
    const v2 = computeConsensusV2(v2Inputs.get(row.handle) ?? EMPTY_CONSENSUS_V2_INPUT);
    updates.push(
      sql`(${row.handle}::text, ${target}::text, ${statusChanged}::boolean, ${v2.status}::text, ${v2.score}::double precision)`,
    );
  }
  for (let index = 0; index < updates.length; index += UPDATE_CHUNK) {
    // status 只在评级变化时写；v2 影子只在值真的变化时写，避免整表每次都产生死元组
    const updateStatement = sql`
      UPDATE ${accounts} AS a SET
        status = CASE WHEN v.set_status THEN v.status ELSE a.status END,
        status_v2 = v.status_v2,
        consensus_v2 = v.consensus_v2
      FROM (VALUES ${sql.join(updates.slice(index, index + UPDATE_CHUNK), sql`, `)})
        AS v(handle, status, set_status, status_v2, consensus_v2)
      WHERE a.handle = v.handle
        AND (
          v.set_status
          OR a.status_v2 IS DISTINCT FROM v.status_v2
          OR a.consensus_v2 IS DISTINCT FROM v.consensus_v2
        )`;
    await retryOnConflict(() => db.execute(updateStatement));
  }
  await retryOnConflict(() => syncConsensusEvents(env, consensusTransitions));
  return { changed };
}
