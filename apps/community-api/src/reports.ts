import { validateReport, type ValidReport } from './lib/validate';
import { hashIp } from './lib/hash';
import {
  installationHash,
  refreshAccountsFromLabels,
  batchStatements,
  batchReads,
  type AccountLabel,
} from './labels';

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
  dailyIpReportLimit: 200, // 单 IP（CF-Connecting-IP 加盐哈希）每日上报上限：安装自报 ID 不可信，防止无限换 ID 绕过单安装配额
  aliasesPerDay: 10, // 单安装每日别名（换号追踪）写入上限：超出后静默跳过，票仍计入正主
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
      daily_ip_report_limit: POLICY.dailyIpReportLimit,
      daily_alias_cap: POLICY.aliasesPerDay,
    },
    reporter_trust: {
      default: 1,
      floor: POLICY.trustFloor,
      burst_threshold: POLICY.trustBurstThreshold,
      burst_decay: POLICY.trustDecay,
    },
    // 影子公式：已计算但不参与入榜，公开声明避免误解
    consensus_v2: {
      status: 'shadow',
      formula: 'trust × installation maturity weighted net votes + temporal/evidence independence',
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
  clientIp?: string | null,
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

  // Invalid payloads should not create an installation record or consume any
  // quota. The per-item rejection results are still returned to the caller.
  if (valid.length === 0) {
    return { ok: true, results };
  }

  const identity = await installationHash(env, installationId);
  const installHash = identity.hash;
  const today = utcToday();
  const now = nowSeconds();

  // A client may retry an entire batch after a network timeout. Only handles
  // that are not already active blocked labels consume a daily report unit;
  // retries remain idempotent and do not turn a transient failure into a
  // quota lockout. Handle aliases are canonicalized below as usual.
  const uniqueHandles = [...new Set(valid.map(({ report }) => report.handle))];
  const existingBlocked = await env.DB.prepare(
    `SELECT handle FROM active_labels
     WHERE installation_id = ?1
       AND label = 'blocked'
       AND handle IN (${uniqueHandles.map((_, index) => `?${index + 2}`).join(', ')})`,
  )
    .bind(installHash, ...uniqueHandles)
    .all<{ handle: string }>();
  const existingBlockedHandles = new Set(existingBlocked.results.map((row) => row.handle));
  const quotaUnits = uniqueHandles.filter((handle) => !existingBlockedHandles.has(handle)).length;

  // Atomically reserve this batch's daily quota. The previous SELECT followed
  // by UPDATE allowed two concurrent requests to observe the same usage and
  // both pass the limit check. The conditional UPSERT makes the reservation
  // itself the gate.
  if (quotaUnits > 0) {
    // IP 级 Sybil 防线：安装 ID 是客户端自报的，无限换 ID 就能无限领配额。
    // IP 不一样可信（NAT 共享），上限放宽到单安装配额的 2 倍，只挡量产垃圾。
    // 隐私：只存加盐哈希，原始 IP 不落库。
    if (clientIp) {
      const ipHash = await hashIp(env.INSTALLATION_SALT, clientIp.trim());
      const ipReserved = await env.DB.prepare(
        `INSERT INTO ip_usage (ip_hash, day, reports_today)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(ip_hash) DO UPDATE SET
           day = excluded.day,
           reports_today = CASE
             WHEN ip_usage.day = excluded.day THEN ip_usage.reports_today + excluded.reports_today
             ELSE excluded.reports_today
           END
         WHERE (
           CASE WHEN ip_usage.day = excluded.day THEN ip_usage.reports_today ELSE 0 END
           + excluded.reports_today
         ) <= ?4`,
      )
        .bind(ipHash, today, quotaUnits, POLICY.dailyIpReportLimit)
        .run();
      if ((ipReserved.meta.changes ?? 0) === 0) {
        return { ok: false, httpStatus: 429, error: 'rate_limited' };
      }
    }

    const reserved = await env.DB.prepare(
      `INSERT INTO installations (id, first_seen_at, last_seen_at, reports_day, reports_today)
       VALUES (?1, ?2, ?2, ?3, ?4)
       ON CONFLICT(id) DO UPDATE SET
         last_seen_at = excluded.last_seen_at,
         reports_day = excluded.reports_day,
         reports_today = CASE
           WHEN installations.reports_day = excluded.reports_day
             THEN installations.reports_today + excluded.reports_today
           ELSE excluded.reports_today
         END
       WHERE (
         CASE
           WHEN installations.reports_day = excluded.reports_day THEN installations.reports_today
           ELSE 0
         END
         + excluded.reports_today
       ) <= MAX(?5, ROUND(?6 * installations.trust))`,
    )
      .bind(
        installHash,
        now,
        today,
        quotaUnits,
        POLICY.minDailyLimit,
        POLICY.dailyReportLimit,
      )
      .run();
    if ((reserved.meta.changes ?? 0) === 0) {
      return { ok: false, httpStatus: 429, error: 'rate_limited' };
    }
  }

  // Burst decay is also conditional on crossing the threshold in this batch,
  // so a retry or concurrent request cannot decay trust repeatedly.
  await env.DB.prepare(
    `UPDATE installations
     SET trust = MAX(?2, trust - ?3)
     WHERE id = ?1
       AND reports_day = ?4
       AND reports_today >= ?5
       AND reports_today - ?6 < ?5`,
  )
    .bind(
      installHash,
      POLICY.trustFloor,
      POLICY.trustDecay,
      today,
      POLICY.trustBurstThreshold,
      quotaUnits,
    )
    .run();

  // 原始证据按 (installation_id, handle) 幂等更新；active_labels 单独决定是否新增计票。
  // 批处理（与逐条执行行为一致，仅合并 D1 往返；语句在 batch 内按原顺序执行）：
  //   1) 换号追踪的正主读取一次 batch 完成，同 x_user_id 共享一次读取 + 内存镜像；
  //   2) 当前标签读取一次 batch 完成，是否变化按条目顺序内存推演 —— 批内同
  //      canonical 的后续条目与逐条执行一样得到 duplicate；
  //   3) reports 落库与 active_labels 写入各合并为一个 batch（两表互不相干，
  //      逐条执行时的交错写入对结果无影响）；
  //   4) 别名写入路径保持逐条：其「预留成功才追加」的条件语义依赖逐条
  //      meta.changes 分支，且频率受每日配额（aliasesPerDay）约束，属冷路径。
  interface KnownAccount {
    handle: string;
    aliases: string;
  }
  const xUserIds = [
    ...new Set(valid.map(({ report }) => report.xUserId).filter((id): id is string => id !== null)),
  ];
  const knownByXUserId = new Map<string, KnownAccount>();
  if (xUserIds.length > 0) {
    const knownRows = await batchReads<KnownAccount>(
      env,
      xUserIds.map((id) =>
        env.DB.prepare('SELECT handle, aliases FROM accounts WHERE x_user_id = ?1 LIMIT 1').bind(id),
      ),
    );
    xUserIds.forEach((id, index) => {
      const row = knownRows[index]!.results[0];
      if (row) {
        knownByXUserId.set(id, row);
      }
    });
  }

  // 正主归一（纯内存计算，不依赖任何写入）。
  const canonicalByResultIndex = new Map<number, string>();
  for (const item of valid) {
    let canonical = item.report.handle;
    const known = item.report.xUserId ? (knownByXUserId.get(item.report.xUserId) ?? null) : null;
    if (known && known.handle !== item.report.handle) {
      canonical = known.handle;
    }
    canonicalByResultIndex.set(item.resultIndex, canonical);
  }

  // 当前标签读取（每个 distinct canonical 一次，等价于逐条执行时各自那次读取：
  // 首次出现前没有任何本请求写入会改动 active_labels）。
  const distinctCanonicals = [...new Set(canonicalByResultIndex.values())];
  const labelState = new Map<string, AccountLabel>();
  if (distinctCanonicals.length > 0) {
    const labelRows = await batchReads<{ label: AccountLabel }>(
      env,
      distinctCanonicals.map((handle) =>
        env.DB.prepare(
          'SELECT label FROM active_labels WHERE installation_id = ?1 AND handle = ?2',
        ).bind(installHash, handle),
      ),
    );
    distinctCanonicals.forEach((handle, index) => {
      const row = labelRows[index]!.results[0];
      if (row) {
        labelState.set(handle, row.label);
      }
    });
  }

  const writeStatements: D1PreparedStatement[] = [];
  // 别名镜像：同 x_user_id 的后续条目要与逐条执行一样看到前面已成功追加的别名。
  const aliasMirror = new Map<string, string[]>();
  const touchedHandles = new Map<string, ValidReport>();
  for (const item of valid) {
    const r = item.report;
    const canonical = canonicalByResultIndex.get(item.resultIndex)!;

    // 换号追踪：同一 x_user_id 的已知账号换了个新 handle ——
    // 票记到原账号（正主）头上，新 handle 进它的别名表，不给换号者重新洗白的机会
    const xUserId = r.xUserId;
    const known = xUserId ? (knownByXUserId.get(xUserId) ?? null) : null;
    if (xUserId && known && known.handle !== r.handle) {
      let aliases = aliasMirror.get(xUserId);
      if (!aliases) {
        aliases = JSON.parse(known.aliases) as string[];
        aliasMirror.set(xUserId, aliases);
      }
      if (!aliases.includes(r.handle)) {
        // 别名写入有每日配额（静默跳过，不阻塞上报）：防止利用自报
        // x_user_id 无限制造别名污染快照。票仍计入正主，只是不记新别名。
        const aliasReserved = await env.DB.prepare(
          `INSERT INTO installations (id, first_seen_at, last_seen_at, aliases_day, aliases_today)
           VALUES (?1, ?2, ?2, ?3, 1)
           ON CONFLICT(id) DO UPDATE SET
             aliases_day = excluded.aliases_day,
             aliases_today = CASE
               WHEN installations.aliases_day = excluded.aliases_day
                 THEN installations.aliases_today + 1
               ELSE 1
             END
           WHERE (
             CASE
               WHEN installations.aliases_day = excluded.aliases_day THEN installations.aliases_today
               ELSE 0
             END
             + 1
           ) <= ?4`,
        )
          .bind(installHash, now, today, POLICY.aliasesPerDay)
          .run();
        if ((aliasReserved.meta.changes ?? 0) > 0) {
          aliases.push(r.handle);
          await env.DB.prepare('UPDATE accounts SET aliases = ?2 WHERE handle = ?1')
            .bind(known.handle, JSON.stringify(aliases))
            .run();
        }
      }
    }

    writeStatements.push(
      env.DB.prepare(
        `INSERT INTO reports
           (handle, x_user_id, reason, evidence_post_id, installation_id, client_version, created_at,
            content_fingerprint, link_domains, detection_source)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(installation_id, handle) DO UPDATE SET
           x_user_id = COALESCE(excluded.x_user_id, reports.x_user_id),
           reason = excluded.reason,
           evidence_post_id = COALESCE(excluded.evidence_post_id, reports.evidence_post_id),
           client_version = excluded.client_version,
           created_at = excluded.created_at,
           content_fingerprint = COALESCE(excluded.content_fingerprint, reports.content_fingerprint),
           link_domains = COALESCE(excluded.link_domains, reports.link_domains),
           detection_source = COALESCE(excluded.detection_source, reports.detection_source)`,
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
          r.detectionSource,
        ),
    );

    // 标签是否变化的内存推演：与 setActiveLabel 的「同标签幂等」语义一致。
    if (labelState.get(canonical) !== 'blocked') {
      writeStatements.push(
        env.DB.prepare(
          `INSERT INTO active_labels (installation_id, handle, label, updated_at)
           VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT(installation_id, handle) DO UPDATE SET
             label = excluded.label,
             updated_at = excluded.updated_at`,
        )
          .bind(installHash, canonical, 'blocked', now),
      );
      labelState.set(canonical, 'blocked');
      // resultIndex 与 results 一同构造，下标必然有效。
      results[item.resultIndex]!.status = 'recorded';
    } else {
      results[item.resultIndex]!.status = 'duplicate';
    }
    touchedHandles.set(canonical, { ...r, handle: canonical });
  }
  await batchStatements(env, writeStatements);

  // 先保证账号存在，再从 active_labels 全量重算当前正票、负票与分类。
  // 这样“正 -> 负 -> 正”的改判和同标签证据更新都不会让聚合计数漂移。
  // 批量收敛一次完成：逐账号刷新会把 D1 调用放大 N×10 倍。
  const accountStatements: D1PreparedStatement[] = [];
  for (const [handle, report] of touchedHandles) {
    accountStatements.push(
      env.DB.prepare(
        `INSERT INTO accounts
           (handle, x_user_id, category, status, report_count, rescue_count, first_report_at, updated_at)
         VALUES (?1, ?2, ?3, 'new', 0, 0, ?4, ?4)
         ON CONFLICT(handle) DO UPDATE SET
           x_user_id = COALESCE(excluded.x_user_id, accounts.x_user_id),
           updated_at = ?4`,
      )
        .bind(handle, report.xUserId, report.reason, now),
    );
  }
  await batchStatements(env, accountStatements);
  await refreshAccountsFromLabels(env, [...touchedHandles.keys()]);

  return { ok: true, results };
}
