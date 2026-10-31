/**
 * account_health 写入侧（#2 死账号检测定稿方案）。
 *
 * 状态机与终态保护全部在 UPSERT 里表达：
 * - dead 永不被覆写：state 归一为 CASE 桩住，probe_count 仍递增
 *   （kill-report 的随手确认也算探过），updated_at 不再前进，
 *   所以 cron 的 updated_at 抽样永远不会再选中它。
 * - alive 更新 confirmed_alive_at 并推进 updated_at（存活信号刷新）。
 * - unknown→alive/dead、alive→dead 是允许的跃迁。
 */
import { sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import { accountHealth } from '../db/schema';
import { compareText } from './sql';

export type AccountHealthState = 'unknown' | 'alive' | 'dead';
export type AccountHealthSource = 'kill-report' | 'cron-prober' | 'passive-signal';

export interface HealthObservation {
  handle: string;
  xUserId: string | null;
  state: AccountHealthState;
  source: AccountHealthSource;
}

/**
 * 同批次去重（一条多行 UPSERT 里同 handle 出现两次会报错，也违反逐条推演语义），
 * 入参脏时直接丢条目。返回尚未执行的多行 UPSERT 构造器，没有可写条目时返回 null；
 * 调用方可以直接 await，也可以嵌进 CTE 与别的写入合成一条语句。
 */
export function healthUpsertQuery(
  env: Cloudflare.Env,
  observations: readonly HealthObservation[],
  now: number,
) {
  const seen = new Set<string>();
  const rows: (typeof accountHealth.$inferInsert)[] = [];
  for (const observation of observations) {
    if (observation.handle.length === 0 || seen.has(observation.handle)) {
      continue;
    }
    seen.add(observation.handle);
    rows.push({
      handle: observation.handle,
      xUserId: observation.xUserId ?? null,
      state: observation.state,
      source: observation.source,
      probeCount: 1,
      confirmedAliveAt: observation.state === 'alive' ? now : null,
      terminalCheckedAt: observation.state === 'dead' ? now : null,
      updatedAt: now,
    });
  }
  if (rows.length === 0) {
    return null;
  }
  // 按主键排序：并发批量 UPSERT 以相同顺序锁行，避免死锁
  rows.sort((a, b) => compareText(a.handle, b.handle));
  const isDead = sql`${accountHealth.state} = 'dead'`;
  return getDb(env)
    .insert(accountHealth)
    .values(rows)
    .onConflictDoUpdate({
      target: accountHealth.handle,
      set: {
        xUserId: sql`coalesce(${accountHealth.xUserId}, excluded.x_user_id)`,
        state: sql`case when ${isDead} then 'dead' else excluded.state end`,
        source: sql`case when ${isDead} then ${accountHealth.source} else excluded.source end`,
        probeCount: sql`${accountHealth.probeCount} + 1`,
        confirmedAliveAt: sql`case when excluded.state = 'alive' then excluded.updated_at else ${accountHealth.confirmedAliveAt} end`,
        terminalCheckedAt: sql`case when ${isDead} then ${accountHealth.terminalCheckedAt} when excluded.state = 'dead' then excluded.updated_at else ${accountHealth.terminalCheckedAt} end`,
        updatedAt: sql`case when ${isDead} then ${accountHealth.updatedAt} else excluded.updated_at end`,
      },
    });
}

/** 一条多行 UPSERT 写入一批探活观察。 */
export async function recordHealthObservations(
  env: Cloudflare.Env,
  observations: readonly HealthObservation[],
  now: number,
): Promise<void> {
  const query = healthUpsertQuery(env, observations, now);
  if (query) await query;
}
