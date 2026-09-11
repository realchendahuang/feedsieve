/**
 * 公示申请（官网名单页）：博主自荐进白名单（whitelist）/ 被公示账号申诉误伤（appeal）。
 *
 * 流程：提交（发邮箱验证码）→ verify → 进维护者队列（/api/admin/applications）。
 * 裁决（approved/rejected）只落库 + 审计，公开名单的变更仍走维护者既有发布链路
 * （whitelist.yaml / 草稿发布），不因申请直改名单。
 *
 * 邮箱验证码复用 email_codes 表：申请通道没有安装语义，写入占位哈希标识通道；
 * 验证只凭邮箱 + 码（同一个收件箱持有者才收得到码，与玩家档案通道同为邮箱所有权
 * 证明；同邮箱被另一通道重发码时以最后一次为准）。
 * 限流：每 IP 每日提交上限（application_ip_usage，条件 UPSERT 即门禁，同 ip_usage）
 * + 每邮箱每小时发码上限（email_codes.send_count，同 player）。
 * 同 handle + kind 已有未决申请时不重复建行：pending 重新提交视为重发验证码。
 */
import { normalizeHandle, isApplicationKind } from '@feedsieve/shared';
import { hashIp, sha256Hex } from './lib/hash';
import { hashEmail, isValidEmail, normalizeEmail, sendMail } from './player';

export const APPLICATION = {
  statementMin: 8,
  statementMax: 500,
  /** 单 IP 每日提交上限（含重试） */
  submissionsPerIpPerDay: 20,
  /** 同一邮箱每小时最多发码次数 */
  sendsPerHour: 3,
  codeTtlSeconds: 600,
  codeMaxAttempts: 5,
  decisionNoteMax: 200,
} as const;

/** 申请通道在 email_codes.installer_hash 里的占位标识（固定哈希，无安装语义） */
function applicationChannelHash(salt: string): Promise<string> {
  return sha256Hex(`application-channel:${salt}`);
}

function generateCode(): string {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return String((buffer[0] ?? 0) % 1_000_000).padStart(6, '0');
}

async function codeHash(salt: string, emailHash: string, code: string): Promise<string> {
  return sha256Hex(`email-code:${salt}:${emailHash}:${code}`);
}

export interface ApplicationResult {
  id: number;
  handle: string;
  kind: string;
  status: string;
  created_at: number;
}

type ApplicationCallResult<T> =
  | { ok: true; value: T }
  | { ok: false; httpStatus: 400 | 404 | 409 | 429 | 503; error: string };

interface ApplicationRow {
  id: number;
  handle: string;
  kind: string;
  statement: string;
  email_hash: string;
  status: string;
  created_at: number;
  verified_at: number | null;
  decided_at: number | null;
  decided_by: string | null;
  decision_note: string | null;
}

export async function submitApplication(
  env: Cloudflare.Env,
  body: unknown,
  ip: string | undefined,
): Promise<ApplicationCallResult<{ sent: boolean; dev_code?: string; application: ApplicationResult }>> {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const handle = typeof b.handle === 'string' ? normalizeHandle(b.handle.trim()) : null;
  if (!handle) return { ok: false, httpStatus: 400, error: 'invalid_handle' };
  if (!isApplicationKind(typeof b.kind === 'string' ? b.kind : '')) {
    return { ok: false, httpStatus: 400, error: 'invalid_kind' };
  }
  const kind = b.kind as string;
  if (!isValidEmail(b.email)) return { ok: false, httpStatus: 400, error: 'invalid_email' };
  const statement = typeof b.statement === 'string' ? b.statement.trim() : '';
  if (statement.length < APPLICATION.statementMin || statement.length > APPLICATION.statementMax) {
    return { ok: false, httpStatus: 400, error: 'invalid_statement' };
  }
  if (!ip) return { ok: false, httpStatus: 400, error: 'ip_missing' };

  const email = normalizeEmail(b.email as string);
  const emailHash = await hashEmail(env.INSTALLATION_SALT, email);
  const ipHash = await hashIp(env.INSTALLATION_SALT, ip);
  const now = Math.floor(Date.now() / 1000);
  const today = new Date().toISOString().slice(0, 10);

  // IP 门禁：条件 UPSERT 本身即闸口，并发请求无法同时通过
  const reserved = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO application_ip_usage (ip_hash, day, submissions_today)
       VALUES (?1, ?2, 1)
       ON CONFLICT(ip_hash) DO UPDATE SET
         submissions_today = CASE
           WHEN application_ip_usage.day = excluded.day THEN application_ip_usage.submissions_today + 1
           ELSE 1
         END,
         day = excluded.day
       WHERE (
         CASE WHEN application_ip_usage.day = excluded.day THEN application_ip_usage.submissions_today ELSE 0 END
       ) < ?3`,
    ).bind(ipHash, today, APPLICATION.submissionsPerIpPerDay),
    env.DB.prepare('DELETE FROM application_ip_usage WHERE day < ?1').bind(today),
  ]);
  if ((reserved[0]?.meta.changes ?? 0) === 0) {
    return { ok: false, httpStatus: 429, error: 'too_many_submissions' };
  }

  // 幂等：同 handle + kind 已有未决申请 → 不重复建行；pending 视为重发验证码
  const open = await env.DB.prepare(
    `SELECT id, status FROM applications
     WHERE handle = ?1 AND kind = ?2 AND status IN ('pending', 'verified')
     ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(handle, kind)
    .first<{ id: number; status: string }>();
  if (open?.status === 'verified') {
    return { ok: false, httpStatus: 409, error: 'application_pending' };
  }

  let applicationId: number;
  if (open) {
    applicationId = open.id;
    await env.DB.prepare(
      `UPDATE applications
       SET statement = ?2, email_hash = ?3, created_at = ?4
       WHERE id = ?1`,
    ).bind(applicationId, statement, emailHash, now).run();
  } else {
    const inserted = await env.DB.prepare(
      `INSERT INTO applications (handle, kind, statement, email_hash, status, ip_hash, created_at)
       VALUES (?1, ?2, ?3, ?4, 'pending', ?5, ?6)`,
    )
      .bind(handle, kind, statement, emailHash, ipHash, now)
      .run();
    applicationId = Number(inserted.meta.last_row_id);
  }

  // 发码限频（同邮箱滑动 1 小时窗口），复用 email_codes 行上的 send_count
  const recent = await env.DB.prepare(
    'SELECT send_count, created_at FROM email_codes WHERE email_hash = ?1',
  )
    .bind(emailHash)
    .first<{ send_count: number; created_at: number }>();
  if (recent && recent.created_at > now - 3600 && recent.send_count >= APPLICATION.sendsPerHour) {
    return { ok: false, httpStatus: 429, error: 'too_many_code_requests' };
  }

  const code = generateCode();
  await env.DB.prepare(
    `INSERT INTO email_codes (email_hash, installer_hash, code_hash, attempts, send_count, created_at, expires_at)
     VALUES (?1, ?2, ?3, 0, 1, ?4, ?5)
     ON CONFLICT(email_hash) DO UPDATE SET
       installer_hash = excluded.installer_hash,
       code_hash = excluded.code_hash,
       attempts = 0,
       send_count = CASE WHEN email_codes.created_at > ?6 THEN email_codes.send_count + 1 ELSE 1 END,
       created_at = excluded.created_at,
       expires_at = excluded.expires_at`,
  )
    .bind(
      emailHash,
      await applicationChannelHash(env.INSTALLATION_SALT),
      await codeHash(env.INSTALLATION_SALT, emailHash, code),
      now,
      now + APPLICATION.codeTtlSeconds,
      now - 3600,
    )
    .run();

  const sent = await sendMail(env, {
    to: email,
    subject: 'FeedSieve 名单申请验证码',
    text: `验证码 ${code}，10 分钟内有效。`,
  });
  if (!sent) {
    if (env.WORKER_ENV === 'production') {
      return { ok: false, httpStatus: 503, error: 'mail_unconfigured' };
    }
    return {
      ok: true,
      value: {
        sent: false,
        dev_code: code,
        application: { id: applicationId, handle, kind, status: 'pending', created_at: now },
      },
    };
  }
  return {
    ok: true,
    value: {
      sent: true,
      application: { id: applicationId, handle, kind, status: 'pending', created_at: now },
    },
  };
}

export async function verifyApplication(
  env: Cloudflare.Env,
  body: unknown,
): Promise<ApplicationCallResult<{ handle: string; kind: string; status: 'verified' }>> {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  if (!isValidEmail(b.email)) return { ok: false, httpStatus: 400, error: 'invalid_email' };
  const code = b.code;
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) {
    return { ok: false, httpStatus: 400, error: 'invalid_code' };
  }
  const emailHash = await hashEmail(env.INSTALLATION_SALT, normalizeEmail(b.email as string));
  const now = Math.floor(Date.now() / 1000);

  const row = await env.DB.prepare(
    'SELECT code_hash, attempts, expires_at FROM email_codes WHERE email_hash = ?1',
  )
    .bind(emailHash)
    .first<{ code_hash: string; attempts: number; expires_at: number }>();
  if (!row || row.expires_at < now) {
    await env.DB.prepare('DELETE FROM email_codes WHERE email_hash = ?1').bind(emailHash).run();
    return { ok: false, httpStatus: 400, error: 'invalid_or_expired_code' };
  }
  if (row.attempts >= APPLICATION.codeMaxAttempts) {
    await env.DB.prepare('DELETE FROM email_codes WHERE email_hash = ?1').bind(emailHash).run();
    return { ok: false, httpStatus: 429, error: 'too_many_attempts' };
  }
  if ((await codeHash(env.INSTALLATION_SALT, emailHash, code)) !== row.code_hash) {
    // 错码计数原子递增（并发错猜不能共享读数翻倍上限），同 player.verifyEmail
    const bumped = await env.DB.prepare(
      'UPDATE email_codes SET attempts = attempts + 1 WHERE email_hash = ?1 AND attempts < ?2',
    )
      .bind(emailHash, APPLICATION.codeMaxAttempts)
      .run();
    if ((bumped.meta.changes ?? 0) === 0) {
      await env.DB.prepare('DELETE FROM email_codes WHERE email_hash = ?1').bind(emailHash).run();
      return { ok: false, httpStatus: 429, error: 'too_many_attempts' };
    }
    return { ok: false, httpStatus: 400, error: 'invalid_or_expired_code' };
  }
  await env.DB.prepare('DELETE FROM email_codes WHERE email_hash = ?1').bind(emailHash).run();

  // 一次验证只推进该邮箱最新的一份未决申请（防同邮箱批量灌队列）
  const pending = await env.DB.prepare(
    `SELECT id, handle, kind FROM applications
     WHERE email_hash = ?1 AND status = 'pending'
     ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(emailHash)
    .first<{ id: number; handle: string; kind: string }>();
  if (!pending) return { ok: false, httpStatus: 400, error: 'application_not_found' };

  await env.DB.prepare(
    `UPDATE applications SET status = 'verified', verified_at = ?2 WHERE id = ?1 AND status = 'pending'`,
  )
    .bind(pending.id, now)
    .run();
  return { ok: true, value: { handle: pending.handle, kind: pending.kind, status: 'verified' } };
}

/** 维护者队列：按状态筛选，创建时间倒序。 */
export async function listApplications(
  env: Cloudflare.Env,
  options: { status?: string; limit?: number } = {},
): Promise<{ entries: ApplicationRow[] }> {
  const where: string[] = [];
  const binds: Array<string | number> = [];
  if (options.status) {
    where.push(`status = ?${binds.length + 1}`);
    binds.push(options.status);
  }
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 200) || 200, 1), 1000);
  const rows = await env.DB.prepare(
    `SELECT id, handle, kind, statement, email_hash, status, created_at,
            verified_at, decided_at, decided_by, decision_note
     FROM applications
     ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY created_at DESC, id DESC
     LIMIT ${limit}`,
  )
    .bind(...binds)
    .all<ApplicationRow>();
  return { entries: rows.results };
}

export async function decideApplication(
  env: Cloudflare.Env,
  id: number,
  decision: string,
  note: string | null,
  maintainerEmail: string,
): Promise<{ ok: boolean; error?: string; changed?: boolean }> {
  if (decision !== 'approved' && decision !== 'rejected') {
    return { ok: false, error: 'invalid_decision' };
  }
  const trimmedNote = note?.trim() ?? '';
  if (trimmedNote.length > APPLICATION.decisionNoteMax) {
    return { ok: false, error: 'invalid_decision_note' };
  }
  const now = Math.floor(Date.now() / 1000);
  const updated = await env.DB.prepare(
    `UPDATE applications
     SET status = ?2, decided_at = ?3, decided_by = ?4, decision_note = ?5
     WHERE id = ?1 AND status IN ('pending', 'verified')`,
  )
    .bind(id, decision, now, maintainerEmail, trimmedNote || null)
    .run();
  if ((updated.meta.changes ?? 0) === 0) {
    const exists = await env.DB.prepare('SELECT 1 AS x FROM applications WHERE id = ?1')
      .bind(id)
      .first();
    return exists
      ? { ok: false, error: 'application_already_decided' }
      : { ok: false, error: 'application_not_found' };
  }
  return { ok: true, changed: true };
}
