/**
 * account_health 写入侧（#2 死账号检测定稿方案）。
 *
 * 状态机与终态保护全部在 UPSERT 里表达：
 * - dead 永不被覆写：state 归一为 COALESCE 桩住，probe_count 仍递增
 *   （kill-report 的随手确认也算探过），updated_at 不再前进，
 *   所以 cron 的 updated_at 抽样永远不会再选中它。
 * - alive 更新 confirmed_alive_at 并推进 updated_at（存活信号刷新）。
 * - unknown→alive/dead、alive→dead 是允许的跃迁。
 */

export type AccountHealthState = 'unknown' | 'alive' | 'dead';
export type AccountHealthSource = 'kill-report' | 'cron-prober' | 'passive-signal';

export interface HealthObservation {
  handle: string;
  xUserId: string | null;
  state: AccountHealthState;
  source: AccountHealthSource;
}

const HEALTH_UPSERT = `
INSERT INTO account_health
  (handle, x_user_id, state, source, probe_count, confirmed_alive_at, terminal_checked_at, updated_at)
VALUES
  (?1, ?2, ?3, ?4, 1,
   CASE WHEN ?3 = 'alive' THEN ?5 END,
   CASE WHEN ?3 = 'dead' THEN ?5 END,
   ?5)
ON CONFLICT(handle) DO UPDATE SET
  x_user_id = COALESCE(account_health.x_user_id, excluded.x_user_id),
  state = CASE
    WHEN account_health.state = 'dead' THEN 'dead'
    ELSE excluded.state
  END,
  source = CASE
    WHEN account_health.state = 'dead' THEN account_health.source
    ELSE ?4
  END,
  probe_count = account_health.probe_count + 1,
  confirmed_alive_at = CASE
    WHEN ?3 = 'alive' THEN ?5
    ELSE account_health.confirmed_alive_at
  END,
  terminal_checked_at = CASE
    WHEN account_health.state = 'dead' THEN account_health.terminal_checked_at
    WHEN ?3 = 'dead' THEN ?5
    ELSE account_health.terminal_checked_at
  END,
  updated_at = CASE
    WHEN account_health.state = 'dead' THEN account_health.updated_at
    ELSE ?5
  END`;

export function healthStatement(
  env: Cloudflare.Env,
  observation: HealthObservation,
  now: number,
): D1PreparedStatement {
  return env.DB.prepare(HEALTH_UPSERT)
    .bind(
      observation.handle,
      observation.xUserId ?? null,
      observation.state,
      observation.source,
      now,
    );
}

/** 同批次去重（批内同 handle 的重复 UPSERT 会违反逐条推演语义），入参脏时直接丢条目。 */
export function recordHealthObservations(
  env: Cloudflare.Env,
  observations: readonly HealthObservation[],
  now: number,
): D1PreparedStatement[] {
  const seen = new Set<string>();
  const statements: D1PreparedStatement[] = [];
  for (const observation of observations) {
    if (observation.handle.length === 0 || seen.has(observation.handle)) {
      continue;
    }
    seen.add(observation.handle);
    statements.push(healthStatement(env, observation, now));
  }
  return statements;
}
