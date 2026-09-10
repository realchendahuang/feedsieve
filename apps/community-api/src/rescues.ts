import { validateRescue } from './lib/validate';
import { POLICY } from './reports';
import {
  installationHash,
  refreshAccountsFromLabels,
  batchStatements,
  batchReads,
  type AccountLabel,
} from './labels';

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

function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

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
  const clientVersion = typeof b.client_version === 'string' ? b.client_version.slice(0, 20) : null;

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

  const identity = await installationHash(env, installationId);
  const installHash = identity.hash;
  const today = utcToday();
  const now = nowSeconds();

  // 客户端在网络超时后可能重试整个批次：只有还未生效当前 allowed 标签的 handle
  // 才消耗每日抢救额度；重试保持幂等，不会把瞬时失败变成额度锁死。
  const uniqueHandles = [...new Set(valid.map(({ rescue }) => rescue.handle))];
  const existingAllowed = await env.DB.prepare(
    `SELECT handle FROM active_labels
     WHERE installation_id = ?1
       AND label = 'allowed'
       AND handle IN (${uniqueHandles.map((_, index) => `?${index + 2}`).join(', ')})`,
  )
    .bind(installHash, ...uniqueHandles)
    .all<{ handle: string }>();
  const existingAllowedHandles = new Set(existingAllowed.results.map((row) => row.handle));
  const quotaUnits = uniqueHandles.filter((handle) => !existingAllowedHandles.has(handle)).length;

  // 原子预留本批额度：条件 UPSERT 本身即门禁，杜绝并发请求同时通过限额检查。
  if (quotaUnits > 0) {
    const reserved = await env.DB.prepare(
      `INSERT INTO installations (id, first_seen_at, last_seen_at, rescues_day, rescues_today)
       VALUES (?1, ?2, ?2, ?3, ?4)
       ON CONFLICT(id) DO UPDATE SET
         last_seen_at = excluded.last_seen_at,
         rescues_day = excluded.rescues_day,
         rescues_today = CASE
           WHEN installations.rescues_day = excluded.rescues_day
             THEN installations.rescues_today + excluded.rescues_today
           ELSE excluded.rescues_today
         END
       WHERE (
         CASE
           WHEN installations.rescues_day = excluded.rescues_day THEN installations.rescues_today
           ELSE 0
         END
         + excluded.rescues_today
       ) <= MAX(?5, ROUND(?6 * installations.trust))`,
    )
      .bind(installHash, now, today, quotaUnits, POLICY.minDailyLimit, POLICY.rescueDailyLimit)
      .run();
    if ((reserved.meta.changes ?? 0) === 0) {
      return { ok: false, httpStatus: 429, error: 'rate_limited' };
    }
  }

  // 批处理（与逐条执行行为一致，仅合并 D1 往返；语句在 batch 内按原顺序执行）：
  //   1) 换号追踪的正主读取一次 batch 完成，同 x_user_id 共享一次读取 + 内存镜像；
  //   2) 当前标签读取一次 batch 完成，是否变化按条目顺序内存推演 —— 批内同
  //      canonical 的后续条目与逐条执行一样得到 duplicate；
  //   3) rescues 落库与 active_labels 写入合并为两个 batch（两表互不相干）；
  //   4) 别名写入路径保持逐条：直接追加（无配额），且频率低，属冷路径。
  interface KnownAccount {
    handle: string;
    aliases: string;
  }
  const xUserIds = [
    ...new Set(valid.map(({ rescue }) => rescue.xUserId).filter((id): id is string => id !== null)),
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
    let canonical = item.rescue.handle;
    const known = item.rescue.xUserId
      ? (knownByXUserId.get(item.rescue.xUserId) ?? null)
      : null;
    if (known && known.handle !== item.rescue.handle) {
      canonical = known.handle;
    }
    canonicalByResultIndex.set(item.resultIndex, canonical);
  }

  // 当前标签读取（每个 distinct canonical 一次；首次出现前无本请求写入会改动 active_labels）。
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
  // 别名镜像：同 x_user_id 的后续条目要与逐条执行一样看到前面已追加的别名。
  const aliasMirror = new Map<string, string[]>();
  // 先记下需要刷新计数的账号，批量收敛（逐账号刷新会把 D1 调用放大 N×10 倍）。
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
        await env.DB.prepare('UPDATE accounts SET aliases = ?2 WHERE handle = ?1')
          .bind(known.handle, JSON.stringify(aliases))
          .run();
      }
    }

    writeStatements.push(
      env.DB.prepare(
        `INSERT INTO rescues
           (handle, x_user_id, evidence_post_id, installation_id, client_version, created_at,
            detection_source, rule_id, detection_reason)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(installation_id, handle) DO UPDATE SET
           x_user_id = COALESCE(excluded.x_user_id, rescues.x_user_id),
           evidence_post_id = COALESCE(excluded.evidence_post_id, rescues.evidence_post_id),
           client_version = excluded.client_version,
           created_at = excluded.created_at,
           detection_source = COALESCE(excluded.detection_source, rescues.detection_source),
           rule_id = COALESCE(excluded.rule_id, rescues.rule_id),
           detection_reason = COALESCE(excluded.detection_reason, rescues.detection_reason)`,
      )
        .bind(
          canonical,
          r.xUserId,
          r.evidencePostId,
          installHash,
          clientVersion,
          now,
          r.detectionSource,
          r.ruleId,
          r.detectionReason,
        ),
    );

    // 标签是否变化的内存推演：与 setActiveLabel 的「同标签幂等」语义一致。
    if (labelState.get(canonical) !== 'allowed') {
      writeStatements.push(
        env.DB.prepare(
          `INSERT INTO active_labels (installation_id, handle, label, updated_at)
           VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT(installation_id, handle) DO UPDATE SET
             label = excluded.label,
             updated_at = excluded.updated_at`,
        )
          .bind(installHash, canonical, 'allowed', now),
      );
      labelState.set(canonical, 'allowed');
      refreshingHandles.push(canonical);
      existsCheckIndexes.set(item.resultIndex, canonical);
    } else {
      // resultIndex 与 results 一同构造，下标必然有效。
      results[item.resultIndex]!.status = 'duplicate';
    }
  }
  await batchStatements(env, writeStatements);

  const existingHandles = await refreshAccountsFromLabels(env, refreshingHandles);
  for (const [resultIndex, canonical] of existsCheckIndexes) {
    if (!existingHandles.has(canonical)) {
      // 名单里没有这个账号：负标签仍保存在 active_labels，后续一旦有正票建档便立即生效。
      results[resultIndex]!.status = 'unknown';
    }
  }

  return { ok: true, results };
}
