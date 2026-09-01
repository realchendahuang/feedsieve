import { validateRescue } from './lib/validate';
import { POLICY, effectiveDailyLimit } from './reports';
import { installationHash, refreshAccountFromLabels, setActiveLabel } from './labels';

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

  const identity = await installationHash(env, installationId);
  const installHash = identity.hash;
  // owner（维护者）特权（v0.5）：owner 的抢救 = 最终裁决 —— 账号永久退出名单
  // （dismissed），后续普通举报不复活（auto-rate 只看 new/candidate/strong）。
  const today = utcToday();
  const now = nowSeconds();

  const installRow = await env.DB.prepare(
    'SELECT rescues_day, rescues_today, trust FROM installations WHERE id = ?1',
  )
    .bind(installHash)
    .first<{ rescues_day: string; rescues_today: number; trust: number }>();
  const trust = installRow?.trust ?? 1;
  const usedToday = installRow && installRow.rescues_day === today ? installRow.rescues_today : 0;
  if (usedToday + valid.length > effectiveDailyLimit(POLICY.rescueDailyLimit, trust)) {
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

  for (const item of valid) {
    const r = item.rescue;
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
      )
      .run();

    const labelChanged = await setActiveLabel(env, installHash, canonical, 'allowed', now);
    if (!labelChanged) {
      results[item.resultIndex].status = 'duplicate';
      continue;
    }
    const exists = await refreshAccountFromLabels(env, canonical, identity.ownerHash);
    if (!exists) {
      // 名单里没有这个账号：负标签仍保存在 active_labels，后续一旦有正票建档便立即生效。
      results[item.resultIndex].status = 'unknown';
    }
  }

  return { ok: true, results };
}
