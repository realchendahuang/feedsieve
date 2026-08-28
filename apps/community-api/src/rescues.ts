import { hashInstallationId } from './lib/hash';
import { validateRescue } from './lib/validate';
import { POLICY } from './reports';

interface ValidRescue {
  handle: string;
  evidencePostId: string | null;
}

export interface RescueResult {
  handle: string;
  status: 'recorded' | 'duplicate' | 'rejected' | 'unknown';
  error?: string;
}

export type ProcessRescueResult =
  | { ok: true; results: RescueResult[] }
  | { ok: false; httpStatus: 400 | 413 | 429; error: string };

function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * 抢救票：认为某条社区标注可能误伤时投出。
 * 语义：一个安装对一个 handle 只能投一票；rescue 只作用于已存在的账号。
 * 自动降级闸门（对称于自动升级）：candidate 账号 rescue_count >= report_count
 * 时降回 new（退出快照）；recommended / strong 的去留只归人工。
 */
export async function processRescueBatch(
  env: Cloudflare.Env,
  body: unknown,
): Promise<ProcessRescueResult> {
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
  const clientVersion =
    typeof b.client_version === 'string' ? b.client_version.slice(0, 20) : null;

  if (!Array.isArray(b.rescues) || b.rescues.length === 0) {
    return { ok: false, httpStatus: 400, error: 'rescues_must_be_non_empty_array' };
  }
  if (b.rescues.length > POLICY.maxBatch) {
    return { ok: false, httpStatus: 413, error: 'batch_too_large' };
  }

  const results: RescueResult[] = [];
  const valid: ValidRescue[] = [];
  for (const raw of b.rescues) {
    const v = validateRescue(raw);
    if (v.ok) {
      valid.push({ handle: v.handle, evidencePostId: v.evidencePostId });
      results.push({ handle: v.handle, status: 'recorded' });
    } else {
      const handle =
        typeof (raw as Record<string, unknown>)?.handle === 'string'
          ? ((raw as Record<string, unknown>).handle as string)
          : '(unknown)';
      results.push({ handle, status: 'rejected', error: v.error });
    }
  }

  const installHash = await hashInstallationId(env.INSTALLATION_SALT, installationId);
  const today = utcToday();
  const now = nowSeconds();

  const installRow = await env.DB.prepare(
    'SELECT rescues_day, rescues_today FROM installations WHERE id = ?1',
  )
    .bind(installHash)
    .first<{ rescues_day: string; rescues_today: number }>();
  const usedToday =
    installRow && installRow.rescues_day === today ? installRow.rescues_today : 0;
  if (usedToday + valid.length > POLICY.rescueDailyLimit) {
    return { ok: false, httpStatus: 429, error: 'rate_limited' };
  }

  if (!installRow) {
    await env.DB.prepare(
      `INSERT INTO installations (id, first_seen_at, last_seen_at, rescues_day, rescues_today)
       VALUES (?1, ?2, ?2, ?3, ?4)`,
    )
      .bind(installHash, now, today, valid.length)
      .run();
  } else {
    await env.DB.prepare(
      'UPDATE installations SET last_seen_at = ?2, rescues_day = ?3, rescues_today = ?4 WHERE id = ?1',
    )
      .bind(installHash, now, today, usedToday + valid.length)
      .run();
  }

  for (let i = 0; i < valid.length; i++) {
    const r = valid[i];
    const insert = await env.DB.prepare(
      `INSERT OR IGNORE INTO rescues
         (handle, evidence_post_id, installation_id, client_version, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
    )
      .bind(r.handle, r.evidencePostId, installHash, clientVersion, now)
      .run();

    if ((insert.meta.changes ?? 0) === 0) {
      results[i].status = 'duplicate';
      continue;
    }

    const update = await env.DB.prepare(
      `UPDATE accounts SET
         rescue_count = rescue_count + 1,
         status = CASE
           WHEN status = 'candidate' AND rescue_count + 1 >= report_count THEN 'new'
           ELSE status END,
         updated_at = ?2
       WHERE handle = ?1`,
    )
      .bind(r.handle, now)
      .run();
    if ((update.meta.changes ?? 0) === 0) {
      // 名单里没有这个账号：抢救票只留档，不产生任何效果
      results[i].status = 'unknown';
    }
  }

  return { ok: true, results };
}
