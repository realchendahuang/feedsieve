import { and, count, countDistinct, eq, inArray, sql } from 'drizzle-orm';
import { hashInstallationId } from './lib/hash';
import { deriveStatus } from './rating';
import {
  computeConsensusV2,
  EMPTY_CONSENSUS_V2_INPUT,
  loadConsensusV2InputsByHandles,
} from './lib/consensus-v2';
import { inferCategory, type CategoryVoteRow } from './category-inference';
import { syncConsensusEvents, type ConsensusTransition } from './consensus-events';
import { validateRescue } from './lib/validate';
import { getDb, retryOnConflict } from './db/client';
import { compareText } from './lib/sql';
import { accounts, activeLabels, installations, reports } from './db/schema';

const MAX_LABEL_BATCH = 50;
/** 单安装每日撤回上限：报告/撤回无限对拍会反复打脏快照 */
const RETRACT_DAILY_LIMIT = 50;

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
 * 这里只保留批量版：3 条聚合查询读、1 条 UPDATE … FROM (VALUES …) 写回，任意数量账号都是
 * 固定次数的往返；改动单个账号的语义（全量重算防计数漂移）保持不变。
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
  const db = getDb(env);

  const [accountRows, labelRows, voteRows, evidence] = await Promise.all([
    db
      .select({ handle: accounts.handle, xUserId: accounts.xUserId })
      .from(accounts)
      .where(inArray(accounts.handle, unique)),
    db
      .select({
        handle: activeLabels.handle,
        blocked: sql<number>`count(*) filter (where ${activeLabels.label} = 'blocked')`.mapWith(
          Number,
        ),
        allowed: sql<number>`count(*) filter (where ${activeLabels.label} = 'allowed')`.mapWith(
          Number,
        ),
      })
      .from(activeLabels)
      .where(inArray(activeLabels.handle, unique))
      .groupBy(activeLabels.handle),
    db
      .select({
        handle: activeLabels.handle,
        reason: reports.reason,
        detectionSource: reports.detectionSource,
        n: count(),
      })
      .from(activeLabels)
      .innerJoin(
        reports,
        and(
          eq(reports.installationId, activeLabels.installationId),
          eq(reports.handle, activeLabels.handle),
        ),
      )
      .where(and(inArray(activeLabels.handle, unique), eq(activeLabels.label, 'blocked')))
      .groupBy(activeLabels.handle, reports.reason, reports.detectionSource),
    loadConsensusV2InputsByHandles(env, unique),
  ]);

  const existingHandles = new Set(accountRows.map((row) => row.handle));
  const xUserIdByHandle = new Map(accountRows.map((row) => [row.handle, row.xUserId] as const));
  // 共识锚点同步：本次收敛进/出 strong 的账号写入或删除共识事件（供死账号探活定位新进共识账号）
  const consensusTransitions = new Map<string, ConsensusTransition>();
  const labelCounts = new Map(labelRows.map((row) => [row.handle, row] as const));
  // 分类用证据推理，不再原样取票面多数（回声票会把 'other' 越滚越大）
  const votesByHandle = new Map<string, CategoryVoteRow[]>();
  for (const row of voteRows) {
    const list = votesByHandle.get(row.handle) ?? [];
    list.push({ reason: row.reason, detectionSource: row.detectionSource, count: row.n });
    votesByHandle.set(row.handle, list);
  }

  const now = Math.floor(Date.now() / 1000);
  const updates: ReturnType<typeof sql>[] = [];
  // 按主键排序：并发请求以相同顺序锁行，避免死锁
  for (const handle of [...existingHandles].sort(compareText)) {
    const reportCount = labelCounts.get(handle)?.blocked ?? 0;
    const rescueCount = labelCounts.get(handle)?.allowed ?? 0;
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
    updates.push(
      sql`(${handle}::text, ${reportCount}::int, ${rescueCount}::int, ${status}::text, ${category}::text, ${v2.status}::text, ${v2.score}::double precision)`,
    );
  }
  if (updates.length > 0) {
    const updateStatement = sql`
      UPDATE ${accounts} AS a SET
        report_count = v.report_count,
        rescue_count = v.rescue_count,
        owner_votes = 0,
        status = v.status,
        category = v.category,
        status_v2 = v.status_v2,
        consensus_v2 = v.consensus_v2,
        updated_at = ${now}
      FROM (VALUES ${sql.join(updates, sql`, `)})
        AS v(handle, report_count, rescue_count, status, category, status_v2, consensus_v2)
      WHERE a.handle = v.handle`;
    await retryOnConflict(() => db.execute(updateStatement));
  }
  await retryOnConflict(() => syncConsensusEvents(env, consensusTransitions));
  return existingHandles;
}

export interface RetractResult {
  handle: string;
  status: 'retracted' | 'absent' | 'rejected';
  error?: string;
}

export type RetractBatchResult =
  | { ok: true; results: RetractResult[] }
  | { ok: false; httpStatus: 400 | 413 | 429; error: string };

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

  const db = getDb(env);
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
    const [active] = await db
      .select({ n: countDistinct(activeLabels.handle) })
      .from(activeLabels)
      .where(
        and(
          eq(activeLabels.installationId, identity.hash),
          inArray(activeLabels.handle, validatedHandles),
        ),
      );
    quotaUnits = active?.n ?? 0;
  }
  if (quotaUnits > 0) {
    const usedToday = sql`CASE WHEN ${installations.retractsDay} = excluded.retracts_day THEN ${installations.retractsToday} ELSE 0 END`;
    const reserved = await db
      .insert(installations)
      .values({
        id: identity.hash,
        firstSeenAt: now,
        lastSeenAt: now,
        retractsDay: today,
        retractsToday: quotaUnits,
      })
      .onConflictDoUpdate({
        target: installations.id,
        set: {
          lastSeenAt: sql`excluded.last_seen_at`,
          retractsDay: sql`excluded.retracts_day`,
          retractsToday: sql`${usedToday} + excluded.retracts_today`,
        },
        setWhere: sql`${usedToday} + excluded.retracts_today <= ${RETRACT_DAILY_LIMIT}`,
      })
      .returning({ id: installations.id });
    if (reserved.length === 0) {
      return { ok: false, httpStatus: 429, error: 'rate_limited' };
    }
  }

  // 归一化两阶段：直查命中主键索引（IN 点读）→ 未命中的才走别名展开
  // （aliases 是 JSON 数组、无索引，扫一次总比每 handle 扫一次强）。
  const canonicalByHandle = new Map<string, string>();
  if (validatedHandles.length > 0) {
    const direct = await db
      .select({ handle: accounts.handle })
      .from(accounts)
      .where(inArray(accounts.handle, validatedHandles));
    for (const row of direct) canonicalByHandle.set(row.handle, row.handle);
    const unresolved = validatedHandles.filter((handle) => !canonicalByHandle.has(handle));
    if (unresolved.length > 0) {
      const aliased = await db.execute<{ alias: string; handle: string }>(sql`
        SELECT je.alias, a.handle
        FROM ${accounts} a CROSS JOIN LATERAL jsonb_array_elements_text(
          CASE WHEN jsonb_typeof(a.aliases::jsonb) = 'array' THEN a.aliases::jsonb ELSE '[]'::jsonb END
        ) AS je(alias)
        WHERE je.alias IN ${unresolved}`);
      for (const row of aliased) {
        if (!canonicalByHandle.has(row.alias)) canonicalByHandle.set(row.alias, row.handle);
      }
    }
  }

  // 一条 DELETE 删掉本安装在这些 handle（及其规范名）上的标签，再按请求顺序分配结果：
  // 同一行标签只算给第一个命中它的 handle，后面的记 absent（与逐条删除的语义一致）。
  if (validatedHandles.length > 0) {
    const targets = new Set<string>();
    for (const handle of validatedHandles) {
      targets.add(handle);
      targets.add(canonicalByHandle.get(handle) ?? handle);
    }
    const deleted = await db
      .delete(activeLabels)
      .where(
        and(
          eq(activeLabels.installationId, identity.hash),
          inArray(activeLabels.handle, [...targets]),
        ),
      )
      .returning({ handle: activeLabels.handle });
    const unclaimed = new Set(deleted.map((row) => row.handle));
    for (const validatedHandle of validatedHandles) {
      const canonical = canonicalByHandle.get(validatedHandle) ?? validatedHandle;
      const hits = [validatedHandle, canonical].filter((handle) => unclaimed.has(handle));
      if (hits.length === 0) {
        results.push({ handle: validatedHandle, status: 'absent' });
        continue;
      }
      for (const handle of hits) unclaimed.delete(handle);
      refreshingHandles.push(canonical, validatedHandle);
      results.push({ handle: validatedHandle, status: 'retracted' });
    }
  }
  // 批量收敛计数：单账号逐次刷新在批量撤回时会把查询放大几十倍
  await refreshAccountsFromLabels(env, refreshingHandles);
  return { ok: true, results };
}
