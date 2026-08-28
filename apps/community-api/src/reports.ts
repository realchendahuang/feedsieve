import { hashInstallationId } from './lib/hash';
import { validateReport, type ValidReport } from './lib/validate';

// Phase D 会把阈值搬进 policy 文件/端点；先集中放这里
export const POLICY = {
  candidateThreshold: 3, // 独立安装数达到即自动进入 candidate
  dailyReportLimit: 100, // 单安装每日上报上限（实际限额 = 此值 × trust，见下）
  rescueDailyLimit: 50, // 单安装每日抢救上限（同样乘 trust）
  minDailyLimit: 10, // 限额下限：无论 trust 多低，保留基本参与能力
  trustBurstThreshold: 30, // 单日报量越过此线 → 信任衰减一次
  trustDecay: 0.1,
  trustFloor: 0.2,
  maxBatch: 50, // 单请求条数上限
} as const;

/** 信任分作用于每日限额：低信任被收紧，但永不归零 */
export function effectiveDailyLimit(baseLimit: number, trust: number): number {
  return Math.max(POLICY.minDailyLimit, Math.round(baseLimit * trust));
}

/** 公开政策快照（/v1/policy 与 manifest 内嵌；与 community/policy/v1.yaml 对应） */
export function publicPolicy() {
  return {
    version: 1,
    candidate: { min_independent_reports: POLICY.candidateThreshold },
    auto_demote: 'candidate_rescue_ge_reports',
    limits: {
      daily_report_base: POLICY.dailyReportLimit,
      daily_rescue_base: POLICY.rescueDailyLimit,
      daily_min: POLICY.minDailyLimit,
      max_batch: POLICY.maxBatch,
    },
    reporter_trust: {
      default: 1,
      floor: POLICY.trustFloor,
      burst_threshold: POLICY.trustBurstThreshold,
      burst_decay: POLICY.trustDecay,
    },
  };
}

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
    'SELECT reports_day, reports_today, trust FROM installations WHERE id = ?1',
  )
    .bind(installHash)
    .first<{ reports_day: string; reports_today: number; trust: number }>();
  const trust = installRow?.trust ?? 1;
  const usedToday =
    installRow && installRow.reports_day === today ? installRow.reports_today : 0;
  if (usedToday + valid.length > effectiveDailyLimit(POLICY.dailyReportLimit, trust)) {
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
    // 爆发衰减：本轮越过爆发线（此前未越过）→ 信任降一档，后续限额随之收紧
    const newUsed = usedToday + valid.length;
    if (
      newUsed >= POLICY.trustBurstThreshold &&
      usedToday < POLICY.trustBurstThreshold
    ) {
      await env.DB.prepare(
        'UPDATE installations SET trust = MAX(?2, trust - ?3) WHERE id = ?1',
      )
        .bind(installHash, POLICY.trustFloor, POLICY.trustDecay)
        .run();
    }
  }

  // 逐条 INSERT OR IGNORE：唯一索引 (installation_id, handle) 保证一个安装对一个账号只算一票
  const insertedHandles = new Map<string, number>(); // handle -> 本批新增票数
  const firstReport = new Map<string, ValidReport>(); // handle -> 首条（定 category / x_user_id）
  for (let i = 0; i < valid.length; i++) {
    const r = valid[i];

    // 换号追踪：同一 x_user_id 的已知账号换了个新 handle ——
    // 票记到原账号（正主）头上，新 handle 进它的别名表，不给换号者重新洗白的机会
    let canonical = r.handle;
    if (r.xUserId) {
      const known = await env.DB.prepare(
        'SELECT handle, aliases FROM accounts WHERE x_user_id = ?1 LIMIT 1',
      )
        .bind(r.xUserId)
        .first<{ handle: string; aliases: string }>();
      if (known && known.handle !== r.handle) {
        canonical = known.handle;
        const aliases = JSON.parse(known.aliases) as string[];
        if (!aliases.includes(r.handle)) {
          aliases.push(r.handle);
          await env.DB.prepare('UPDATE accounts SET aliases = ?2 WHERE handle = ?1')
            .bind(known.handle, JSON.stringify(aliases))
            .run();
        }
      }
    }

    const res = await env.DB.prepare(
      `INSERT OR IGNORE INTO reports
         (handle, x_user_id, reason, evidence_post_id, installation_id, client_version, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    )
      .bind(canonical, r.xUserId, r.reason, r.evidencePostId, installHash, clientVersion, now)
      .run();
    if ((res.meta.changes ?? 0) === 1) {
      insertedHandles.set(canonical, (insertedHandles.get(canonical) ?? 0) + 1);
      if (!firstReport.has(canonical)) {
        firstReport.set(canonical, { ...r, handle: canonical });
      }
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
