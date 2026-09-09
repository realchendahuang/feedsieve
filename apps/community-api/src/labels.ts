import { hashInstallationId } from './lib/hash';
import { deriveStatus } from './rating';
import { computeConsensusV2, EMPTY_CONSENSUS_V2_INPUT, loadConsensusV2InputsByHandles } from './lib/consensus-v2';
import { inferCategory, type CategoryVoteRow } from './category-inference';
import { validateRescue } from './lib/validate';

const MAX_LABEL_BATCH = 50;
// D1 batch 单次调用与单条查询的绑定参数上限一致，按 100 分片。
const D1_CHUNK = 100;

export type AccountLabel = 'blocked' | 'allowed';

interface ActiveLabelRow {
  label: AccountLabel;
}

export async function installationHash(
  env: Cloudflare.Env,
  installationId: string,
): Promise<{ hash: string }> {
  return { hash: await hashInstallationId(env.INSTALLATION_SALT, installationId) };
}

/**
 * 设置当前判断。返回 true 表示标签发生了变化；同标签重传保持幂等。
 * 原始 reports / rescues 证据由各自路由保存，这里只管理当前计票状态。
 */
export async function setActiveLabel(
  env: Cloudflare.Env,
  installHash: string,
  handle: string,
  label: AccountLabel,
  now: number,
): Promise<boolean> {
  const previous = await env.DB.prepare(
    'SELECT label FROM active_labels WHERE installation_id = ?1 AND handle = ?2',
  )
    .bind(installHash, handle)
    .first<ActiveLabelRow>();
  if (previous?.label === label) {
    return false;
  }
  await env.DB.prepare(
    `INSERT INTO active_labels (installation_id, handle, label, updated_at)
     VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(installation_id, handle) DO UPDATE SET
       label = excluded.label,
       updated_at = excluded.updated_at`,
  )
    .bind(installHash, handle, label, now)
    .run();
  return true;
}

/**
 * 当前标签是唯一计票源；批量请求（上报 / 抢救 / 撤回）改动一组账号后收敛计数。
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
    env.DB.prepare(`SELECT handle FROM accounts WHERE handle IN (${inClause})`)
      .bind(...unique)
      .all<{ handle: string }>(),
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
  for (let index = 0; index < statements.length; index += D1_CHUNK) {
    await env.DB.batch(statements.slice(index, index + D1_CHUNK));
  }
  return existingHandles;
}

export interface RetractResult {
  handle: string;
  status: 'retracted' | 'absent' | 'rejected';
  error?: string;
}

export type RetractBatchResult =
  { ok: true; results: RetractResult[] } | { ok: false; httpStatus: 400 | 413; error: string };

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
  const results: RetractResult[] = [];
  const refreshingHandles: string[] = [];
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
    const known = await env.DB.prepare(
      `SELECT a.handle
       FROM accounts a
       WHERE a.handle = ?1
          OR EXISTS (SELECT 1 FROM json_each(a.aliases) WHERE value = ?1)
       ORDER BY CASE WHEN a.handle = ?1 THEN 0 ELSE 1 END
       LIMIT 1`,
    )
      .bind(validated.handle)
      .first<{ handle: string }>();
    const canonical = known?.handle ?? validated.handle;
    const deletion = await env.DB.prepare(
      `DELETE FROM active_labels
       WHERE installation_id = ?1 AND (handle = ?2 OR handle = ?3)`,
    )
      .bind(identity.hash, validated.handle, canonical)
      .run();
    if ((deletion.meta.changes ?? 0) === 0) {
      results.push({ handle: validated.handle, status: 'absent' });
      continue;
    }
    refreshingHandles.push(canonical, validated.handle);
    results.push({ handle: validated.handle, status: 'retracted' });
  }
  // 批量收敛计数：单账号逐次刷新在批量撤回时会把 D1 调用放大几十倍
  await refreshAccountsFromLabels(env, refreshingHandles);
  return { ok: true, results };
}
