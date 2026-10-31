import { validateReport, type ValidReport } from './lib/validate';
import { hashIp } from './lib/hash';
import { collateC, compareText, stripNul } from './lib/sql';
import { nowSeconds, utcToday } from './lib/time';
import { healthUpsertQuery, type HealthObservation } from './lib/account-health';
import { installationHash, refreshAccountsFromLabels, type AccountLabel } from './labels';
import { asc, and, eq, inArray, sql } from 'drizzle-orm';
import { getDb, retryOnConflict } from './db/client';
import { accounts, activeLabels, installations, reports } from './db/schema';

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

/** 公开政策快照（/v1/policy 与 manifest 内嵌；与 community/policy/v4.yaml 对应）。
 *  纯静态字面量，模块级冻结一份，roster 组装 / manifest 生成按引用复用。
 *  入榜判定的代码在 lib/listing.ts 与 rule-hits.ts（isCorroborated），数字改动要三处同步。 */
const PUBLIC_POLICY = Object.freeze({
  version: 4,
  blocklist: {
    formula: 'block_votes - false_positive_votes',
    min_net_votes: POLICY.communityNetThreshold,
    one_current_vote_per_installation: true,
    // 净票达标之外还要一条独立性：v2 加权共识达标 / 拉黑票横跨 ≥ 2 天 / 净票 ≥ 5
    independence: {
      consensus_v2_strong: true,
      min_distinct_days: 2,
      unconditional_net_votes: 5,
    },
    // 佐证上榜：规则命中不是票，只作独立佐证
    corroborated: {
      min_net_votes: 2,
      max_false_positive_votes: 0,
      min_rule_hit_networks_7d: 3,
      same_template_campaign: true,
    },
    exclude_dead_accounts: true,
  },
  rule_feedback: {
    window_days: 14,
    auto_mute_min_hit_accounts: 30,
    auto_mute_min_false_positive_installs: 5,
    auto_mute_false_positive_rate: 0.5,
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
  // v2 加权共识：作为入榜的独立性条件之一（见 blocklist.independence）
  consensus_v2: {
    status: 'independence_condition',
    formula: 'trust × installation maturity weighted net votes + temporal/evidence independence',
  },
});

export function publicPolicy() {
  return PUBLIC_POLICY;
}

export interface ReportResult {
  handle: string;
  status: 'recorded' | 'duplicate' | 'rejected';
  error?: string;
}

export type ProcessBatchResult =
  { ok: true; results: ReportResult[] } | { ok: false; httpStatus: 400 | 413 | 429; error: string };

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
  const clientVersion =
    typeof b.client_version === 'string' ? stripNul(b.client_version).slice(0, 20) : null;

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

  const db = getDb(env);
  const identity = await installationHash(env, installationId);
  const installHash = identity.hash;
  const today = utcToday();
  const now = nowSeconds();

  // 一次并发读出本请求需要的全部现状：
  //   1) 本安装在这些 handle 上的当前标签（既是配额口径，也是标签变化推演的起点）；
  //   2) 换号追踪的正主：同 x_user_id 的已知账号，每个 x_user_id 一行。
  // 同一 x_user_id 若有多个账号（正常不会出现），取最早建档的，保证结果确定。
  const uniqueHandles = [...new Set(valid.map(({ report }) => report.handle))];
  interface KnownAccount {
    handle: string;
    aliases: string;
  }
  const xUserIds = [
    ...new Set(valid.map(({ report }) => report.xUserId).filter((id): id is string => id !== null)),
  ];
  const [currentLabels, knownRows] = await Promise.all([
    db
      .select({ handle: activeLabels.handle, label: activeLabels.label })
      .from(activeLabels)
      .where(
        and(
          eq(activeLabels.installationId, installHash),
          inArray(activeLabels.handle, uniqueHandles),
        ),
      ),
    xUserIds.length > 0
      ? db
          .selectDistinctOn([accounts.xUserId], {
            xUserId: accounts.xUserId,
            handle: accounts.handle,
            aliases: accounts.aliases,
          })
          .from(accounts)
          .where(inArray(accounts.xUserId, xUserIds))
          .orderBy(accounts.xUserId, asc(accounts.firstReportAt), asc(collateC(accounts.handle)))
      : Promise.resolve([]),
  ]);
  const knownByXUserId = new Map<string, KnownAccount>();
  for (const row of knownRows) {
    if (row.xUserId !== null) {
      knownByXUserId.set(row.xUserId, row);
    }
  }
  const labelState = new Map<string, AccountLabel>(
    currentLabels.map((row) => [row.handle, row.label] as const),
  );

  // A client may retry an entire batch after a network timeout. Only handles
  // that are not already active blocked labels consume a daily report unit;
  // retries remain idempotent and do not turn a transient failure into a
  // quota lockout. Handle aliases are canonicalized below as usual.
  const quotaUnits = uniqueHandles.filter((handle) => labelState.get(handle) !== 'blocked').length;

  // Atomically reserve this batch's daily quota. The previous SELECT followed
  // by UPDATE allowed two concurrent requests to observe the same usage and
  // both pass the limit check. The conditional UPSERT makes the reservation
  // itself the gate.
  if (quotaUnits > 0) {
    // 安装当日已用量（跨日清零）与本批叠加后的总量。
    const usedToday = sql`(CASE WHEN ${installations.reportsDay} = excluded.reports_day THEN ${installations.reportsToday} ELSE 0 END)`;
    // 突发降权也在同一条 UPSERT 里：仅当本批把当日量推过阈值时降一次，
    // 重试或并发请求不会重复降权。首次建档的安装直接以降权后的 trust 入库。
    const decayedTrust = sql`GREATEST(${POLICY.trustFloor}::double precision, ${installations.trust} - ${POLICY.trustDecay}::double precision)`;
    const initialTrust =
      quotaUnits >= POLICY.trustBurstThreshold
        ? Math.max(POLICY.trustFloor, 1 - POLICY.trustDecay)
        : 1;
    // 限额 = max(下限, round(基数 × trust))；按 numeric 取整（四舍五入，与原 SQLite ROUND 一致）。
    const dailyCap = sql`GREATEST(${POLICY.minDailyLimit}::numeric, ROUND((${POLICY.dailyReportLimit}::int * ${installations.trust})::numeric))`;
    const installUpsert = sql`
      INSERT INTO ${installations} (id, first_seen_at, last_seen_at, reports_day, reports_today, trust)
      SELECT ${installHash}::text, ${now}::bigint, ${now}::bigint, ${today}::text, ${quotaUnits}::int, ${initialTrust}::double precision
      ${clientIp ? sql`WHERE EXISTS (SELECT 1 FROM ip)` : sql``}
      ON CONFLICT (id) DO UPDATE SET
        last_seen_at = excluded.last_seen_at,
        reports_day = excluded.reports_day,
        reports_today = CASE
          WHEN ${installations.reportsDay} = excluded.reports_day
            THEN ${installations.reportsToday} + excluded.reports_today
          ELSE excluded.reports_today
        END,
        trust = CASE
          WHEN ${usedToday} + excluded.reports_today >= ${POLICY.trustBurstThreshold}
            AND ${usedToday} < ${POLICY.trustBurstThreshold}
            THEN ${decayedTrust}
          ELSE ${installations.trust}
        END
      WHERE ${usedToday} + excluded.reports_today <= ${dailyCap}
      RETURNING id`;

    // IP 级 Sybil 防线：安装 ID 是客户端自报的，无限换 ID 就能无限领配额。
    // IP 不一样可信（NAT 共享），上限放宽到单安装配额的 2 倍，只挡量产垃圾。
    // 隐私：只存加盐哈希，原始 IP 不落库。
    // IP 预留与安装预留合成一条语句（一次往返）：IP 超限时安装预留不执行，
    // 结果照样是 0 行 → 429；IP 通过而安装超限时 IP 用量已消耗，与分两步执行一致。
    let statement = installUpsert;
    if (clientIp) {
      const ipHash = await hashIp(env.INSTALLATION_SALT, clientIp.trim());
      statement = sql`
        WITH ip AS (
          INSERT INTO ip_usage (ip_hash, day, reports_today)
          VALUES (${ipHash}::text, ${today}::text, ${quotaUnits}::int)
          ON CONFLICT (ip_hash) DO UPDATE SET
            day = excluded.day,
            reports_today = CASE
              WHEN ip_usage.day = excluded.day THEN ip_usage.reports_today + excluded.reports_today
              ELSE excluded.reports_today
            END
          WHERE (
            CASE WHEN ip_usage.day = excluded.day THEN ip_usage.reports_today ELSE 0 END
            + excluded.reports_today
          ) <= ${POLICY.dailyIpReportLimit}
          RETURNING 1
        )
        ${installUpsert}`;
    }
    const reserved = await db.execute(statement);
    if (reserved.length === 0) {
      return { ok: false, httpStatus: 429, error: 'rate_limited' };
    }
  }

  // 原始证据按 (installation_id, handle) 幂等更新；active_labels 单独决定是否新增计票。
  // 批处理（与逐条执行行为一致，仅合并数据库往返）：
  //   1) 换号追踪的正主、当前标签已在上面并发读出，同 x_user_id 共享内存镜像；
  //   2) 是否变化按条目顺序内存推演 —— 批内同 canonical 的后续条目与逐条执行一样得到 duplicate；
  //   3) reports / active_labels / account_health / accounts 的写入合成一条 CTE 语句，
  //      一次往返、整体原子；批内同 canonical 的 reports 行先在内存里折叠成最终值
  //      （与逐条 UPSERT 的 COALESCE 叠加结果一致），避免一条语句里同一行被更新两次；
  //   4) 别名写入路径保持逐条：其「预留成功才追加」的条件语义依赖逐条预留结果，
  //      且频率受每日配额（aliasesPerDay）约束，属冷路径。

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

  // 换号后正主不在本批原始 handle 里时，补读本安装在这些正主上的当前标签（冷路径）。
  const unreadCanonicals = [...new Set(canonicalByResultIndex.values())].filter(
    (handle) => !uniqueHandles.includes(handle),
  );
  if (unreadCanonicals.length > 0) {
    const extra = await db
      .select({ handle: activeLabels.handle, label: activeLabels.label })
      .from(activeLabels)
      .where(
        and(
          eq(activeLabels.installationId, installHash),
          inArray(activeLabels.handle, unreadCanonicals),
        ),
      );
    for (const row of extra) {
      labelState.set(row.handle, row.label);
    }
  }

  const reportRows = new Map<string, typeof reports.$inferInsert>();
  const labelRows: (typeof activeLabels.$inferInsert)[] = [];
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
        const aliasUsedToday = sql`CASE WHEN ${installations.aliasesDay} = excluded.aliases_day THEN ${installations.aliasesToday} ELSE 0 END`;
        const aliasReserved = await db
          .insert(installations)
          .values({
            id: installHash,
            firstSeenAt: now,
            lastSeenAt: now,
            aliasesDay: today,
            aliasesToday: 1,
          })
          .onConflictDoUpdate({
            target: installations.id,
            set: {
              aliasesDay: sql`excluded.aliases_day`,
              aliasesToday: sql`${aliasUsedToday} + 1`,
            },
            setWhere: sql`(${aliasUsedToday}) + 1 <= ${POLICY.aliasesPerDay}`,
          })
          .returning({ id: installations.id });
        if (aliasReserved.length > 0) {
          aliases.push(r.handle);
          await db
            .update(accounts)
            .set({ aliases: JSON.stringify(aliases) })
            .where(eq(accounts.handle, known.handle));
        }
      }
    }

    // 同一 (installation_id, handle) 的后续条目叠加在前一条之上：
    // reason / client_version / created_at 取后者，其余字段 COALESCE(后者, 前者)。
    const incoming: typeof reports.$inferInsert = {
      handle: canonical,
      xUserId: r.xUserId,
      reason: r.reason,
      evidencePostId: r.evidencePostId,
      installationId: installHash,
      clientVersion,
      createdAt: now,
      contentFingerprint: r.contentFingerprint,
      linkDomains: r.linkDomains.length > 0 ? JSON.stringify(r.linkDomains) : null,
      detectionSource: r.detectionSource,
      ruleId: r.ruleId,
      signalIds: r.signalIds.length > 0 ? JSON.stringify(r.signalIds) : null,
      tweetText: r.tweetText,
      displayName: r.displayName,
      bio: r.bio,
    };
    const previous = reportRows.get(canonical);
    reportRows.set(
      canonical,
      previous
        ? {
            ...incoming,
            xUserId: incoming.xUserId ?? previous.xUserId ?? null,
            evidencePostId: incoming.evidencePostId ?? previous.evidencePostId ?? null,
            contentFingerprint: incoming.contentFingerprint ?? previous.contentFingerprint ?? null,
            linkDomains: incoming.linkDomains ?? previous.linkDomains ?? null,
            detectionSource: incoming.detectionSource ?? previous.detectionSource ?? null,
            ruleId: incoming.ruleId ?? previous.ruleId ?? null,
            signalIds: incoming.signalIds ?? previous.signalIds ?? null,
            tweetText: incoming.tweetText ?? previous.tweetText ?? null,
            displayName: incoming.displayName ?? previous.displayName ?? null,
            bio: incoming.bio ?? previous.bio ?? null,
          }
        : incoming,
    );

    // 标签是否变化的内存推演：与 setActiveLabel 的「同标签幂等」语义一致。
    if (labelState.get(canonical) !== 'blocked') {
      labelRows.push({
        installationId: installHash,
        handle: canonical,
        label: 'blocked',
        updatedAt: now,
      });
      labelState.set(canonical, 'blocked');
      // resultIndex 与 results 一同构造，下标必然有效。
      results[item.resultIndex]!.status = 'recorded';
    } else {
      results[item.resultIndex]!.status = 'duplicate';
    }
    touchedHandles.set(canonical, { ...r, handle: canonical });
  }

  // 击杀时刻探活结果（#2 定稿）：随开火票写 account_health。
  // 键取正主（canonical），探测物理对象是用户上报的 handle：换号别名场景下
  // 两者经 x_user_id 关联，正主一条足以表达存活口径。
  // 单笔客户端上报不能锁死终态（2026-09-12 收口）：kill-report 的 dead 只落
  // unknown 标记，由 cron-prober 的「kill-report 待复核」队列重验后才进 dead
  // 终态；alive 是探活的正向结果，照常直写。
  const healthObservations: HealthObservation[] = [];
  for (const [, report] of touchedHandles) {
    if (report.liveness === null) continue;
    healthObservations.push({
      handle: report.handle,
      xUserId: report.xUserId,
      state: report.liveness === 'dead' ? 'unknown' : 'alive',
      source: 'kill-report',
    });
  }

  // 先保证账号存在，再从 active_labels 全量重算当前正票、负票与分类。
  // 这样“正 -> 负 -> 正”的改判和同标签证据更新都不会让聚合计数漂移。
  const accountRows: (typeof accounts.$inferInsert)[] = [];
  for (const [handle, report] of touchedHandles) {
    accountRows.push({
      handle,
      xUserId: report.xUserId,
      category: report.reason,
      status: 'new',
      reportCount: 0,
      rescueCount: 0,
      firstReportAt: now,
      updatedAt: now,
    });
  }

  // 多行写入按主键排序：并发请求以相同顺序锁行，避免死锁
  const sortedReportRows = [...reportRows.values()].sort((a, b) => compareText(a.handle, b.handle));
  accountRows.sort((a, b) => compareText(a.handle, b.handle));
  labelRows.sort((a, b) => compareText(a.handle, b.handle));

  const writes = [
    sql`r AS ${db
      .insert(reports)
      .values(sortedReportRows)
      .onConflictDoUpdate({
        target: [reports.installationId, reports.handle],
        set: {
          xUserId: sql`COALESCE(excluded.x_user_id, ${reports.xUserId})`,
          reason: sql`excluded.reason`,
          evidencePostId: sql`COALESCE(excluded.evidence_post_id, ${reports.evidencePostId})`,
          clientVersion: sql`excluded.client_version`,
          createdAt: sql`excluded.created_at`,
          contentFingerprint: sql`COALESCE(excluded.content_fingerprint, ${reports.contentFingerprint})`,
          linkDomains: sql`COALESCE(excluded.link_domains, ${reports.linkDomains})`,
          detectionSource: sql`COALESCE(excluded.detection_source, ${reports.detectionSource})`,
          ruleId: sql`COALESCE(excluded.rule_id, ${reports.ruleId})`,
          signalIds: sql`COALESCE(excluded.signal_ids, ${reports.signalIds})`,
          tweetText: sql`COALESCE(excluded.tweet_text, ${reports.tweetText})`,
          displayName: sql`COALESCE(excluded.display_name, ${reports.displayName})`,
          bio: sql`COALESCE(excluded.bio, ${reports.bio})`,
        },
      })}`,
    sql`a AS ${db
      .insert(accounts)
      .values(accountRows)
      .onConflictDoUpdate({
        target: accounts.handle,
        set: {
          xUserId: sql`COALESCE(excluded.x_user_id, ${accounts.xUserId})`,
          updatedAt: sql`excluded.updated_at`,
        },
      })}`,
  ];
  if (labelRows.length > 0) {
    writes.push(
      sql`l AS ${db
        .insert(activeLabels)
        .values(labelRows)
        .onConflictDoUpdate({
          target: [activeLabels.installationId, activeLabels.handle],
          set: { label: sql`excluded.label`, updatedAt: sql`excluded.updated_at` },
        })}`,
    );
  }
  const healthUpsert = healthUpsertQuery(env, healthObservations, now);
  if (healthUpsert) {
    writes.push(sql`h AS ${healthUpsert}`);
  }
  const writeStatement = sql`WITH ${sql.join(writes, sql`, `)} SELECT 1`;
  await retryOnConflict(() => db.execute(writeStatement));

  // 从 active_labels 全量重算触及账号的正票、负票与分类，批量收敛一次完成。
  await refreshAccountsFromLabels(env, [...touchedHandles.keys()]);

  return { ok: true, results };
}
