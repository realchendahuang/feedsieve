import { hashInstallationId } from './lib/hash';
import { deriveStatus } from './rating';
import { computeConsensusV2, EMPTY_CONSENSUS_V2_INPUT, loadConsensusV2InputsByHandles } from './lib/consensus-v2';
import { inferCategory, type CategoryVoteRow } from './category-inference';
import { syncConsensusEvents, type ConsensusTransition } from './leaderboard';
import { validateRescue } from './lib/validate';

const MAX_LABEL_BATCH = 50;
/** 单安装每日撤回上限：报告/撤回无限对拍会反复打脏快照与榜单聚合 */
const RETRACT_DAILY_LIMIT = 50;
/** D1 batch 单次调用与单条查询的绑定参数上限一致，按 100 分片。 */
export const D1_CHUNK = 100;

/** 批量执行（按 D1_CHUNK 分片）；batch 内语句按序执行，后续语句能看到前面的写入。 */
export async function batchStatements(
  env: Cloudflare.Env,
  statements: D1PreparedStatement[],
): Promise<void> {
  for (let index = 0; index < statements.length; index += D1_CHUNK) {
    await env.DB.batch(statements.slice(index, index + D1_CHUNK));
  }
}

/** 批量执行一批读取语句，返回与语句顺序一致的结果数组。 */
export async function batchReads<T>(
  env: Cloudflare.Env,
  reads: D1PreparedStatement[],
): Promise<D1Result<T>[]> {
  const all: D1Result<T>[] = [];
  for (let index = 0; index < reads.length; index += D1_CHUNK) {
    all.push(...((await env.DB.batch<T>(reads.slice(index, index + D1_CHUNK))) as D1Result<T>[]));
  }
  return all;
}

export type AccountLabel = 'blocked' | 'allowed';

export async function installationHash(
  env: Cloudflare.Env,
  installationId: string,
): Promise<{ hash: string }> {
  return { hash: await hashInstallationId(env.INSTALLATION_SALT, installationId) };
}

/**
 * 当前标签是唯一计票源；批量请求（上报 / 抢救 / 撤回）改动一组账号后收敛计数。
 * 逐条版本已并入调用方的批处理推演（见 reports.ts / rescues.ts 的标签内存推演），
 * 这里只保留批量版。
 *
 * 单账号版（refreshAccountFromLabels，N×~10 次 D1 请求）在批量路由里会撞
 * 单次 invocation 的请求上限；这里用 5 条 IN 聚合 SQL + 1 次 batch 写回收敛
 * 任意数量账号，改动单个账号的语义（全量重算防计数漂移）保持不变。
 * 返回存在于 accounts 的 handle 集合（调用方据此区分「名单外账号」）。
 */
export async function refreshAccountsFromLabels(
  env: Cloudflare.Env,
  handles: string[],
): Promise<Set<string>> {
  const unique = [...new Set(handles)];
  if (unique.length === 0) {
    return new Set();
  }
  const inClause = unique.map((_, index) => `?${index + 1}`).join(', ');

  const [accountRows, blockedRows, allowedRows, voteRows, evidence] = await Promise.all([
    env.DB.prepare(`SELECT handle, x_user_id FROM accounts WHERE handle IN (${inClause})`)
      .bind(...unique)
      .all<{ handle: string; x_user_id: string | null }>(),
    env.DB.prepare(
      `SELECT handle, COUNT(*) AS n FROM active_labels
       WHERE handle IN (${inClause}) AND label = 'blocked' GROUP BY handle`,
    )
      .bind(...unique)
      .all<{ handle: string; n: number }>(),
    env.DB.prepare(
      `SELECT handle, COUNT(*) AS n FROM active_labels
       WHERE handle IN (${inClause}) AND label = 'allowed' GROUP BY handle`,
    )
      .bind(...unique)
      .all<{ handle: string; n: number }>(),
    env.DB.prepare(
      `SELECT l.handle, r.reason, r.detection_source, COUNT(*) AS n
       FROM active_labels l
       JOIN reports r
         ON r.installation_id = l.installation_id
        AND r.handle = l.handle
       WHERE l.handle IN (${inClause}) AND l.label = 'blocked'
       GROUP BY l.handle, r.reason, r.detection_source`,
    )
      .bind(...unique)
      .all<{ handle: string; reason: string; detection_source: string | null; n: number }>(),
    loadConsensusV2InputsByHandles(env, unique),
  ]);

  const existingHandles = new Set(accountRows.results.map((row) => row.handle));
  const xUserIdByHandle = new Map(
    accountRows.results.map((row) => [row.handle, row.x_user_id] as const),
  );
  // 共识锚点同步：本次收敛进/出 strong 的账号写入或删除击杀事件（打野排位赛计分）
  const consensusTransitions = new Map<string, ConsensusTransition>();
  const blockedCount = new Map(blockedRows.results.map((row) => [row.handle, row.n] as const));
  const allowedCount = new Map(allowedRows.results.map((row) => [row.handle, row.n] as const));
  // 分类用证据推理，不再原样取票面多数（回声票会把 'other' 越滚越大）
  const votesByHandle = new Map<string, CategoryVoteRow[]>();
  for (const row of voteRows.results) {
    const list = votesByHandle.get(row.handle) ?? [];
    list.push({ reason: row.reason, detectionSource: row.detection_source, count: row.n });
    votesByHandle.set(row.handle, list);
  }

  const now = Math.floor(Date.now() / 1000);
  const statements: D1PreparedStatement[] = [];
  for (const handle of existingHandles) {
    const reportCount = blockedCount.get(handle) ?? 0;
    const rescueCount = allowedCount.get(handle) ?? 0;
    const status = deriveStatus({
      handle,
      status: 'new',
      report_count: reportCount,
      rescue_count: rescueCount,
    });
    // consensus v2 影子：与入榜无关，只为影子对比积累数据
    const v2 = computeConsensusV2(evidence.inputs.get(handle) ?? EMPTY_CONSENSUS_V2_INPUT);
    const category = inferCategory({
      votes: votesByHandle.get(handle) ?? [],
      hasDomainEvidence: evidence.domainEvidenceHandles.has(handle),
      hasFingerprintEvidence: evidence.fingerprintEvidenceHandles.has(handle),
    });
    consensusTransitions.set(handle, {
      strong: status === 'strong',
      xUserId: xUserIdByHandle.get(handle) ?? null,
    });
    statements.push(
      env.DB.prepare(
        `UPDATE accounts SET
           report_count = ?2,
           rescue_count = ?3,
           owner_votes = ?4,
           status = ?5,
           category = ?6,
           status_v2 = ?8,
           consensus_v2 = ?9,
           updated_at = ?7
         WHERE handle = ?1`,
      ).bind(
        handle,
        reportCount,
        rescueCount,
        0,
        status,
        category,
        now,
        v2.status,
        v2.score,
      ),
    );
  }
  await batchStatements(env, statements);
  await syncConsensusEvents(env, consensusTransitions);
  return existingHandles;
}

export interface RetractResult {
  handle: string;
  status: 'retracted' | 'absent' | 'rejected';
  error?: string;
}

export type RetractBatchResult =
  { ok: true; results: RetractResult[] } | { ok: false; httpStatus: 400 | 413 | 429; error: string };

/** 本地名单删除后撤回当前票；原始审计证据不删除。 */
export async function processRetractionBatch(
  env: Cloudflare.Env,
  body: unknown,
): Promise<RetractBatchResult> {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, httpStatus: 400, error: 'invalid_json_body' };
  }
  const b = body as Record<string, unknown>;
  const installationId = b.installation_id;
  if (
    typeof installationId !== 'string' ||
    installationId.length < 8 ||
    installationId.length > 128
  ) {
    return { ok: false, httpStatus: 400, error: 'invalid_installation_id' };
  }
  if (!Array.isArray(b.handles) || b.handles.length === 0) {
    return { ok: false, httpStatus: 400, error: 'handles_must_be_non_empty_array' };
  }
  if (b.handles.length > MAX_LABEL_BATCH) {
    return { ok: false, httpStatus: 413, error: 'batch_too_large' };
  }

  const identity = await installationHash(env, installationId);
  const today = new Date().toISOString().slice(0, 10);
  const now = Math.floor(Date.now() / 1000);

  const results: RetractResult[] = [];
  const refreshingHandles: string[] = [];
  const validatedHandles: string[] = [];
  for (const raw of b.handles) {
    const validated = validateRescue({ handle: raw });
    if (!validated.ok) {
      results.push({
        handle: typeof raw === 'string' ? raw : '(unknown)',
        status: 'rejected',
        error: validated.error,
      });
      continue;
    }
    validatedHandles.push(validated.handle);
  }

  // 每日撤回配额：只统计当前仍持有本安装有效标签的 handle（重试幂等，
  // 对不存在的标签反复撤回不消耗配额）。条件 UPSERT 本身即门禁。
  let quotaUnits = 0;
  if (validatedHandles.length > 0) {
    const active = await env.DB.prepare(
      `SELECT COUNT(DISTINCT handle) AS n FROM active_labels
       WHERE installation_id = ?1
         AND handle IN (${validatedHandles.map((_, index) => `?${index + 2}`).join(', ')})`,
    )
      .bind(identity.hash, ...validatedHandles)
      .first<{ n: number }>();
    quotaUnits = active?.n ?? 0;
  }
  if (quotaUnits > 0) {
    const reserved = await env.DB.prepare(
      `INSERT INTO installations (id, first_seen_at, last_seen_at, retracts_day, retracts_today)
       VALUES (?1, ?2, ?2, ?3, ?4)
       ON CONFLICT(id) DO UPDATE SET
         last_seen_at = excluded.last_seen_at,
         retracts_day = excluded.retracts_day,
         retracts_today = CASE
           WHEN installations.retracts_day = excluded.retracts_day
             THEN installations.retracts_today + excluded.retracts_today
           ELSE excluded.retracts_today
         END
       WHERE (
         CASE
           WHEN installations.retracts_day = excluded.retracts_day THEN installations.retracts_today
           ELSE 0
         END
         + excluded.retracts_today
       ) <= ?5`,
    )
      .bind(identity.hash, now, today, quotaUnits, RETRACT_DAILY_LIMIT)
      .run();
    if ((reserved.meta.changes ?? 0) === 0) {
      return { ok: false, httpStatus: 429, error: 'rate_limited' };
    }
  }

  for (const validatedHandle of validatedHandles) {
    const known = await env.DB.prepare(
      `SELECT a.handle
       FROM accounts a
       WHERE a.handle = ?1
          OR EXISTS (SELECT 1 FROM json_each(a.aliases) WHERE value = ?1)
       ORDER BY CASE WHEN a.handle = ?1 THEN 0 ELSE 1 END
       LIMIT 1`,
    )
      .bind(validatedHandle)
      .first<{ handle: string }>();
    const canonical = known?.handle ?? validatedHandle;
    const deletion = await env.DB.prepare(
      `DELETE FROM active_labels
       WHERE installation_id = ?1 AND (handle = ?2 OR handle = ?3)`,
    )
      .bind(identity.hash, validatedHandle, canonical)
      .run();
    if ((deletion.meta.changes ?? 0) === 0) {
      results.push({ handle: validatedHandle, status: 'absent' });
      continue;
    }
    refreshingHandles.push(canonical, validatedHandle);
    results.push({ handle: validatedHandle, status: 'retracted' });
  }
  // 批量收敛计数：单账号逐次刷新在批量撤回时会把 D1 调用放大几十倍
  await refreshAccountsFromLabels(env, refreshingHandles);
  return { ok: true, results };
}
