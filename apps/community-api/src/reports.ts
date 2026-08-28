import { hashInstallationId } from './lib/hash';
import { validateReport, type ValidReport } from './lib/validate';

// Phase D 会把阈值搬进 policy 文件/端点；先集中放这里
export const POLICY = {
  candidateThreshold: 3, // 独立安装数达到即自动进入 candidate
  dailyReportLimit: 100, // 单安装每日上报上限
  rescueDailyLimit: 50, // 单安装每日抢救上限
  maxBatch: 50, // 单请求条数上限
} as const;

export interface ReportResult {
  handle: string;
  status: 'recorded' | 'duplicate' | 'rejected';
  error?: string;
}

export type ProcessBatchResult =
  | { ok: true; results: ReportResult[] }
  | { ok: false; httpStatus: 400 | 413 | 429; error: string };

function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export async function processReportBatch(
  env: Cloudflare.Env,
  body: unknown,
): Promise<ProcessBatchResult> {
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

  if (!Array.isArray(b.reports) || b.reports.length === 0) {
    return { ok: false, httpStatus: 400, error: 'reports_must_be_non_empty_array' };
  }
  if (b.reports.length > POLICY.maxBatch) {
    return { ok: false, httpStatus: 413, error: 'batch_too_large' };
  }

  const results: ReportResult[] = [];
  const valid: ValidReport[] = [];
  for (const raw of b.reports) {
    const v = validateReport(raw);
    if (v.ok) {
      valid.push(v.report);
      results.push({ handle: v.report.handle, status: 'recorded' });
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
    'SELECT reports_day, reports_today FROM installations WHERE id = ?1',
  )
    .bind(installHash)
    .first<{ reports_day: string; reports_today: number }>();
  const usedToday =
    installRow && installRow.reports_day === today ? installRow.reports_today : 0;
  if (usedToday + valid.length > POLICY.dailyReportLimit) {
    return { ok: false, httpStatus: 429, error: 'rate_limited' };
  }

  if (!installRow) {
    await env.DB.prepare(
      `INSERT INTO installations (id, first_seen_at, last_seen_at, reports_day, reports_today)
       VALUES (?1, ?2, ?2, ?3, ?4)`,
    )
      .bind(installHash, now, today, valid.length)
      .run();
  } else {
    await env.DB.prepare(
      'UPDATE installations SET last_seen_at = ?2, reports_day = ?3, reports_today = ?4 WHERE id = ?1',
    )
      .bind(installHash, now, today, usedToday + valid.length)
      .run();
  }

  // 逐条 INSERT OR IGNORE：唯一索引 (installation_id, handle) 保证一个安装对一个账号只算一票
  const insertedHandles = new Map<string, number>(); // handle -> 本批新增票数
  const firstReport = new Map<string, ValidReport>(); // handle -> 首条（定 category / x_user_id）
  for (let i = 0; i < valid.length; i++) {
    const r = valid[i];
    const res = await env.DB.prepare(
      `INSERT OR IGNORE INTO reports
         (handle, x_user_id, reason, evidence_post_id, installation_id, client_version, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    )
      .bind(r.handle, r.xUserId, r.reason, r.evidencePostId, installHash, clientVersion, now)
      .run();
    if ((res.meta.changes ?? 0) === 1) {
      insertedHandles.set(r.handle, (insertedHandles.get(r.handle) ?? 0) + 1);
      if (!firstReport.has(r.handle)) firstReport.set(r.handle, r);
    } else {
      results[i].status = 'duplicate';
    }
  }

  // 聚合进 accounts：首报定 category / x_user_id；独立票数过阈值自动升 candidate
  for (const [handle, delta] of insertedHandles) {
    const first = firstReport.get(handle)!;
    const threshold = POLICY.candidateThreshold;
    await env.DB.prepare(
      `INSERT INTO accounts
         (handle, x_user_id, category, status, report_count, rescue_count, first_report_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?6)
       ON CONFLICT(handle) DO UPDATE SET
         report_count = accounts.report_count + ?5,
         x_user_id = COALESCE(excluded.x_user_id, accounts.x_user_id),
         status = CASE
           WHEN accounts.status IN ('new') AND accounts.report_count + ?5 >= ?7 THEN 'candidate'
           ELSE accounts.status END,
         updated_at = ?6`,
    )
      .bind(
        handle,
        first.xUserId,
        first.reason,
        delta >= threshold ? 'candidate' : 'new',
        delta,
        now,
        threshold,
      )
      .run();
  }

  return { ok: true, results };
}
