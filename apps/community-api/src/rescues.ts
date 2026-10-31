import { validateRescue } from './lib/validate';
import { POLICY } from './reports';
import { nowSeconds, utcToday } from './lib/time';
import { collateC, compareText, stripNul } from './lib/sql';
import { installationHash, refreshAccountsFromLabels, type AccountLabel } from './labels';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { getDb, retryOnConflict } from './db/client';
import { accounts, activeLabels, installations, rescues } from './db/schema';

interface ValidRescue {
  handle: string;
  xUserId: string | null;
  evidencePostId: string | null;
  detectionSource: string | null;
  ruleId: string | null;
  detectionReason: string | null;
}

export interface RescueResult {
  handle: string;
  status: 'recorded' | 'duplicate' | 'rejected' | 'unknown';
  error?: string;
}

export type ProcessRescueResult =
  { ok: true; results: RescueResult[] } | { ok: false; httpStatus: 400 | 413 | 429; error: string };

/**
 * 误标票：认为某条社区标注可能误伤时投出。
 * 一个安装对一个 handle 只有一个当前选择；误标票只作用于已存在的账号。
 * 每次改判后统一按 report_count - rescue_count >= 3 重算社区来源。
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
    typeof b.client_version === 'string' ? stripNul(b.client_version).slice(0, 20) : null;

  if (!Array.isArray(b.rescues) || b.rescues.length === 0) {
    return { ok: false, httpStatus: 400, error: 'rescues_must_be_non_empty_array' };
  }
  if (b.rescues.length > POLICY.maxBatch) {
    return { ok: false, httpStatus: 413, error: 'batch_too_large' };
  }

  const results: RescueResult[] = [];
  const valid: Array<{ rescue: ValidRescue; resultIndex: number }> = [];
  for (const raw of b.rescues) {
    const v = validateRescue(raw);
    if (v.ok) {
      results.push({ handle: v.handle, status: 'recorded' });
      valid.push({
        resultIndex: results.length - 1,
        rescue: {
          handle: v.handle,
          xUserId: v.xUserId,
          evidencePostId: v.evidencePostId,
          detectionSource: v.detectionSource,
          ruleId: v.ruleId,
          detectionReason: v.detectionReason,
        },
      });
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
  const uniqueHandles = [...new Set(valid.map(({ rescue }) => rescue.handle))];
  interface KnownAccount {
    handle: string;
    aliases: string;
  }
  const xUserIds = [
    ...new Set(valid.map(({ rescue }) => rescue.xUserId).filter((id): id is string => id !== null)),
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

  // 客户端在网络超时后可能重试整个批次：只有还未生效当前 allowed 标签的 handle
  // 才消耗每日抢救额度；重试保持幂等，不会把瞬时失败变成额度锁死。
  const quotaUnits = uniqueHandles.filter((handle) => labelState.get(handle) !== 'allowed').length;

  // 原子预留本批额度：条件 UPSERT 本身即门禁，杜绝并发请求同时通过限额检查。
  if (quotaUnits > 0) {
    // 限额 = max(下限, round(基数 × trust))；按 numeric 取整（四舍五入，与原 SQLite ROUND 一致）。
    const usedToday = sql`(CASE WHEN ${installations.rescuesDay} = excluded.rescues_day THEN ${installations.rescuesToday} ELSE 0 END)`;
    const reserved = await db
      .insert(installations)
      .values({
        id: installHash,
        firstSeenAt: now,
        lastSeenAt: now,
        rescuesDay: today,
        rescuesToday: quotaUnits,
      })
      .onConflictDoUpdate({
        target: installations.id,
        set: {
          lastSeenAt: sql`excluded.last_seen_at`,
          rescuesDay: sql`excluded.rescues_day`,
          rescuesToday: sql`${usedToday} + excluded.rescues_today`,
        },
        setWhere: sql`${usedToday} + excluded.rescues_today <= GREATEST(${POLICY.minDailyLimit}::numeric, ROUND((${POLICY.rescueDailyLimit}::int * ${installations.trust})::numeric))`,
      })
      .returning({ id: installations.id });
    if (reserved.length === 0) {
      return { ok: false, httpStatus: 429, error: 'rate_limited' };
    }
  }

  // 批处理（与逐条执行行为一致，仅合并数据库往返）：
  //   1) 换号追踪的正主、当前标签已在上面并发读出，同 x_user_id 共享内存镜像；
  //   2) 是否变化按条目顺序内存推演 —— 批内同 canonical 的后续条目与逐条执行一样得到 duplicate；
  //   3) rescues 与 active_labels 的写入合成一条 CTE 语句，一次往返、整体原子；
  //      批内同 canonical 的 rescues 行先在内存里折叠成最终值（与逐条 UPSERT 的
  //      COALESCE 叠加结果一致），避免一条语句里同一行被更新两次；
  //   4) 别名写入路径保持逐条：直接追加（无配额），且频率低，属冷路径。

  // 正主归一（纯内存计算，不依赖任何写入）。
  const canonicalByResultIndex = new Map<number, string>();
  for (const item of valid) {
    let canonical = item.rescue.handle;
    const known = item.rescue.xUserId ? (knownByXUserId.get(item.rescue.xUserId) ?? null) : null;
    if (known && known.handle !== item.rescue.handle) {
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

  const rescueRows = new Map<string, typeof rescues.$inferInsert>();
  const labelRows: (typeof activeLabels.$inferInsert)[] = [];
  // 别名镜像：同 x_user_id 的后续条目要与逐条执行一样看到前面已追加的别名。
  const aliasMirror = new Map<string, string[]>();
  // 先记下需要刷新计数的账号，批量收敛（逐账号刷新会把往返放大 N×10 倍）。
  const refreshingHandles: string[] = [];
  const existsCheckIndexes = new Map<number, string>();
  for (const item of valid) {
    const r = item.rescue;
    const canonical = canonicalByResultIndex.get(item.resultIndex)!;

    const xUserId = r.xUserId;
    const known = xUserId ? (knownByXUserId.get(xUserId) ?? null) : null;
    if (xUserId && known && known.handle !== r.handle) {
      let aliases = aliasMirror.get(xUserId);
      if (!aliases) {
        aliases = JSON.parse(known.aliases) as string[];
        aliasMirror.set(xUserId, aliases);
      }
      if (!aliases.includes(r.handle)) {
        aliases.push(r.handle);
        await db
          .update(accounts)
          .set({ aliases: JSON.stringify(aliases) })
          .where(eq(accounts.handle, known.handle));
      }
    }

    // 同一 (installation_id, handle) 的后续条目叠加在前一条之上：
    // client_version / created_at 取后者，其余字段 COALESCE(后者, 前者)。
    const incoming: typeof rescues.$inferInsert = {
      handle: canonical,
      xUserId: r.xUserId,
      evidencePostId: r.evidencePostId,
      installationId: installHash,
      clientVersion,
      createdAt: now,
      detectionSource: r.detectionSource,
      ruleId: r.ruleId,
      detectionReason: r.detectionReason,
    };
    const previous = rescueRows.get(canonical);
    rescueRows.set(
      canonical,
      previous
        ? {
            ...incoming,
            xUserId: incoming.xUserId ?? previous.xUserId ?? null,
            evidencePostId: incoming.evidencePostId ?? previous.evidencePostId ?? null,
            detectionSource: incoming.detectionSource ?? previous.detectionSource ?? null,
            ruleId: incoming.ruleId ?? previous.ruleId ?? null,
            detectionReason: incoming.detectionReason ?? previous.detectionReason ?? null,
          }
        : incoming,
    );

    // 标签是否变化的内存推演：与 setActiveLabel 的「同标签幂等」语义一致。
    if (labelState.get(canonical) !== 'allowed') {
      labelRows.push({
        installationId: installHash,
        handle: canonical,
        label: 'allowed',
        updatedAt: now,
      });
      labelState.set(canonical, 'allowed');
      refreshingHandles.push(canonical);
      existsCheckIndexes.set(item.resultIndex, canonical);
    } else {
      // resultIndex 与 results 一同构造，下标必然有效。
      results[item.resultIndex]!.status = 'duplicate';
    }
  }

  // 多行写入按主键排序：并发请求以相同顺序锁行，避免死锁
  const sortedRescueRows = [...rescueRows.values()].sort((a, b) => compareText(a.handle, b.handle));
  labelRows.sort((a, b) => compareText(a.handle, b.handle));
  const rescuesUpsert = db
    .insert(rescues)
    .values(sortedRescueRows)
    .onConflictDoUpdate({
      target: [rescues.installationId, rescues.handle],
      set: {
        xUserId: sql`COALESCE(excluded.x_user_id, ${rescues.xUserId})`,
        evidencePostId: sql`COALESCE(excluded.evidence_post_id, ${rescues.evidencePostId})`,
        clientVersion: sql`excluded.client_version`,
        createdAt: sql`excluded.created_at`,
        detectionSource: sql`COALESCE(excluded.detection_source, ${rescues.detectionSource})`,
        ruleId: sql`COALESCE(excluded.rule_id, ${rescues.ruleId})`,
        detectionReason: sql`COALESCE(excluded.detection_reason, ${rescues.detectionReason})`,
      },
    });
  if (labelRows.length === 0) {
    await retryOnConflict(async () => {
      await rescuesUpsert;
    });
  } else {
    const labelsUpsert = db
      .insert(activeLabels)
      .values(labelRows)
      .onConflictDoUpdate({
        target: [activeLabels.installationId, activeLabels.handle],
        set: { label: sql`excluded.label`, updatedAt: sql`excluded.updated_at` },
      });
    const writeStatement = sql`WITH r AS ${rescuesUpsert}, l AS ${labelsUpsert} SELECT 1`;
    await retryOnConflict(() => db.execute(writeStatement));
  }

  const existingHandles = await refreshAccountsFromLabels(env, refreshingHandles);
  for (const [resultIndex, canonical] of existsCheckIndexes) {
    if (!existingHandles.has(canonical)) {
      // 名单里没有这个账号：负标签仍保存在 active_labels，后续一旦有正票建档便立即生效。
      results[resultIndex]!.status = 'unknown';
    }
  }

  return { ok: true, results };
}
