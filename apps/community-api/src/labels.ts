import { hashInstallationId } from './lib/hash';
import { deriveStatus } from './rating';
import { validateRescue } from './lib/validate';

const MAX_LABEL_BATCH = 50;

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

/** 当前标签是唯一计票源；每次变更只重算单个账号，避免增减计数漂移。 */
export async function refreshAccountFromLabels(
  env: Cloudflare.Env,
  handle: string,
): Promise<boolean> {
  const account = await env.DB.prepare(
    `SELECT handle, status, report_count, rescue_count
     FROM accounts WHERE handle = ?1`,
  )
    .bind(handle)
    .first<{
      handle: string;
      status: string;
      report_count: number;
      rescue_count: number;
    }>();
  if (!account) {
    return false;
  }

  const [blocked, allowed, category] = await Promise.all([
    env.DB.prepare(
      `SELECT COUNT(*) AS n FROM active_labels
       WHERE handle = ?1 AND label = 'blocked'`,
    )
      .bind(handle)
      .first<{ n: number }>(),
    env.DB.prepare(
      `SELECT COUNT(*) AS n FROM active_labels
       WHERE handle = ?1 AND label = 'allowed'`,
    )
      .bind(handle)
      .first<{ n: number }>(),
    env.DB.prepare(
      `SELECT r.reason
       FROM active_labels l
       JOIN reports r
         ON r.installation_id = l.installation_id
        AND r.handle = l.handle
       WHERE l.handle = ?1 AND l.label = 'blocked'
       GROUP BY r.reason
       ORDER BY COUNT(*) DESC, MAX(r.created_at) DESC, r.reason ASC
       LIMIT 1`,
    )
      .bind(handle)
      .first<{ reason: string }>(),
  ]);

  const reportCount = blocked?.n ?? 0;
  const rescueCount = allowed?.n ?? 0;
  const status = deriveStatus({
    handle,
    status: account.status,
    report_count: reportCount,
    rescue_count: rescueCount,
  });

  await env.DB.prepare(
    `UPDATE accounts SET
       report_count = ?2,
       rescue_count = ?3,
       owner_votes = ?4,
       status = ?5,
       category = COALESCE(?6, category),
       updated_at = ?7
     WHERE handle = ?1`,
  )
    .bind(
      handle,
      reportCount,
      rescueCount,
      0,
      status,
      category?.reason ?? null,
      Math.floor(Date.now() / 1000),
    )
    .run();
  return true;
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
    await refreshAccountFromLabels(env, canonical);
    if (canonical !== validated.handle) {
      await refreshAccountFromLabels(env, validated.handle);
    }
    results.push({ handle: validated.handle, status: 'retracted' });
  }
  return { ok: true, results };
}
