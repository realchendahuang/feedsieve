import { validateReport, type ValidReport } from './lib/validate';
import { installationHash, refreshAccountFromLabels, setActiveLabel } from './labels';

// Phase D 会把阈值搬进 policy 文件/端点；先集中放这里
export const POLICY = {
  // 唯一入榜公式：独立拉黑票 - 独立误标票 >= 3。
  communityNetThreshold: 3,
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

/** 公开政策快照（/v1/policy 与 manifest 内嵌；与 community/policy/v3.yaml 对应） */
export function publicPolicy() {
  return {
    version: 3,
    blocklist: {
      formula: 'block_votes - false_positive_votes',
      min_net_votes: POLICY.communityNetThreshold,
      one_current_vote_per_installation: true,
    },
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
  { ok: true; results: ReportResult[] } | { ok: false; httpStatus: 400 | 413 | 429; error: string };

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
  const clientVersion = typeof b.client_version === 'string' ? b.client_version.slice(0, 20) : null;

  if (!Array.isArray(b.reports) || b.reports.length === 0) {
    return { ok: false, httpStatus: 400, error: 'reports_must_be_non_empty_array' };
  }
  if (b.reports.length > POLICY.maxBatch) {
    return { ok: false, httpStatus: 413, error: 'batch_too_large' };
  }

  const results: ReportResult[] = [];
  const valid: Array<{ report: ValidReport; resultIndex: number }> = [];
  for (const raw of b.reports) {
    const v = validateReport(raw);
    if (v.ok) {
      results.push({ handle: v.report.handle, status: 'recorded' });
      valid.push({ report: v.report, resultIndex: results.length - 1 });
    } else {
      const handle =
        typeof (raw as Record<string, unknown>)?.handle === 'string'
          ? ((raw as Record<string, unknown>).handle as string)
          : '(unknown)';
      results.push({ handle, status: 'rejected', error: v.error });
    }
  }

  const identity = await installationHash(env, installationId);
  const installHash = identity.hash;
  const today = utcToday();
  const now = nowSeconds();

  const installRow = await env.DB.prepare(
    'SELECT reports_day, reports_today, trust FROM installations WHERE id = ?1',
  )
    .bind(installHash)
    .first<{ reports_day: string; reports_today: number; trust: number }>();
  const trust = installRow?.trust ?? 1;
  const usedToday = installRow && installRow.reports_day === today ? installRow.reports_today : 0;
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
    if (newUsed >= POLICY.trustBurstThreshold && usedToday < POLICY.trustBurstThreshold) {
      await env.DB.prepare('UPDATE installations SET trust = MAX(?2, trust - ?3) WHERE id = ?1')
        .bind(installHash, POLICY.trustFloor, POLICY.trustDecay)
        .run();
    }
  }

  // 原始证据按 (installation_id, handle) 幂等更新；active_labels 单独决定是否新增计票。
  const touchedHandles = new Map<string, ValidReport>();
  for (const item of valid) {
    const r = item.report;

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

    await env.DB.prepare(
      `INSERT INTO reports
         (handle, x_user_id, reason, evidence_post_id, installation_id, client_version, created_at,
          content_fingerprint, link_domains)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
       ON CONFLICT(installation_id, handle) DO UPDATE SET
         x_user_id = COALESCE(excluded.x_user_id, reports.x_user_id),
         reason = excluded.reason,
         evidence_post_id = COALESCE(excluded.evidence_post_id, reports.evidence_post_id),
         client_version = excluded.client_version,
         created_at = excluded.created_at,
         content_fingerprint = COALESCE(excluded.content_fingerprint, reports.content_fingerprint),
         link_domains = COALESCE(excluded.link_domains, reports.link_domains)`,
    )
      .bind(
        canonical,
        r.xUserId,
        r.reason,
        r.evidencePostId,
        installHash,
        clientVersion,
        now,
        r.contentFingerprint,
        r.linkDomains.length > 0 ? JSON.stringify(r.linkDomains) : null,
      )
      .run();
    const labelChanged = await setActiveLabel(env, installHash, canonical, 'blocked', now);
    results[item.resultIndex].status = labelChanged ? 'recorded' : 'duplicate';
    touchedHandles.set(canonical, { ...r, handle: canonical });
  }

  // 先保证账号存在，再从 active_labels 全量重算当前正票、负票与分类。
  // 这样“正 -> 负 -> 正”的改判和同标签证据更新都不会让聚合计数漂移。
  for (const [handle, report] of touchedHandles) {
    await env.DB.prepare(
      `INSERT INTO accounts
         (handle, x_user_id, category, status, report_count, rescue_count, first_report_at, updated_at)
       VALUES (?1, ?2, ?3, 'new', 0, 0, ?4, ?4)
       ON CONFLICT(handle) DO UPDATE SET
         x_user_id = COALESCE(excluded.x_user_id, accounts.x_user_id),
         updated_at = ?4`,
    )
      .bind(handle, report.xUserId, report.reason, now)
      .run();
    await refreshAccountFromLabels(env, handle);
  }

  return { ok: true, results };
}
