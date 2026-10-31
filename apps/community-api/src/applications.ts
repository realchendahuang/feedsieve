/**
 * 公示申请（官网名单页）：博主自荐进白名单（whitelist）/ 被公示账号申诉误伤（appeal）。
 *
 * 流程：提交（发邮箱验证码）→ verify → 进维护者队列（/api/admin/applications）。
 * 裁决（approved/rejected）只落库 + 审计，公开名单的变更仍走维护者既有发布链路
 * （whitelist.yaml / 草稿发布），不因申请直改名单。
 *
 * 邮箱验证码复用 email_codes 表：申请通道没有安装语义，写入占位哈希标识通道；
 * 验证只凭邮箱 + 码（同一个收件箱持有者才收得到码，即邮箱所有权
 * 证明；同邮箱重发码时以最后一次为准）。
 * 限流：每 IP 每日提交上限（application_ip_usage，条件 UPSERT 即门禁，同 ip_usage）
 * + 每邮箱每小时发码上限（email_codes.send_count）。
 * 同 handle + kind 已有未决申请时不重复建行：pending 重新提交视为重发验证码。
 */
import { normalizeHandle, isApplicationKind } from '@feedsieve/shared';
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { getDb } from './db/client';
import { applicationIpUsage, applications, emailCodes } from './db/schema';
import { hashIp, sha256Hex } from './lib/hash';
import { stripNul } from './lib/sql';
import { emailCodeHash, generateEmailCode } from './lib/email-code';
import { hashEmail, isValidEmail, normalizeEmail, sendMail } from './mail';

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

export interface ApplicationResult {
  id: number;
  handle: string;
  kind: string;
  status: string;
  created_at: number;
}

type ApplicationCallResult<T> =
  { ok: true; value: T } | { ok: false; httpStatus: 400 | 404 | 409 | 429 | 503; error: string };

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
): Promise<
  ApplicationCallResult<{ sent: boolean; dev_code?: string; application: ApplicationResult }>
> {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const handle = typeof b.handle === 'string' ? normalizeHandle(b.handle.trim()) : null;
  if (!handle) return { ok: false, httpStatus: 400, error: 'invalid_handle' };
  if (!isApplicationKind(typeof b.kind === 'string' ? b.kind : '')) {
    return { ok: false, httpStatus: 400, error: 'invalid_kind' };
  }
  const kind = b.kind as string;
  if (!isValidEmail(b.email)) return { ok: false, httpStatus: 400, error: 'invalid_email' };
  const statement = typeof b.statement === 'string' ? stripNul(b.statement).trim() : '';
  if (statement.length < APPLICATION.statementMin || statement.length > APPLICATION.statementMax) {
    return { ok: false, httpStatus: 400, error: 'invalid_statement' };
  }
  if (!ip) return { ok: false, httpStatus: 400, error: 'ip_missing' };

  const email = normalizeEmail(b.email as string);
  const emailHash = await hashEmail(env.INSTALLATION_SALT, email);
  const ipHash = await hashIp(env.INSTALLATION_SALT, ip);
  const now = Math.floor(Date.now() / 1000);
  const today = new Date().toISOString().slice(0, 10);

  const db = getDb(env);

  // IP 门禁：条件 UPSERT 本身即闸口，并发请求无法同时通过
  const usedToday = sql`CASE WHEN ${applicationIpUsage.day} = excluded.day THEN ${applicationIpUsage.submissionsToday} ELSE 0 END`;
  const reserved = await db
    .insert(applicationIpUsage)
    .values({ ipHash, day: today, submissionsToday: 1 })
    .onConflictDoUpdate({
      target: applicationIpUsage.ipHash,
      set: {
        submissionsToday: sql`${usedToday} + 1`,
        day: sql`excluded.day`,
      },
      setWhere: sql`${usedToday} < ${APPLICATION.submissionsPerIpPerDay}`,
    })
    .returning({ ipHash: applicationIpUsage.ipHash });
  await db.delete(applicationIpUsage).where(lt(applicationIpUsage.day, today));
  if (reserved.length === 0) {
    return { ok: false, httpStatus: 429, error: 'too_many_submissions' };
  }

  // 幂等：同 handle + kind 已有未决申请 → 不重复建行；pending 视为重发验证码
  const [open] = await db
    .select({ id: applications.id, status: applications.status })
    .from(applications)
    .where(
      and(
        eq(applications.handle, handle),
        eq(applications.kind, kind),
        inArray(applications.status, ['pending', 'verified']),
      ),
    )
    .orderBy(desc(applications.createdAt))
    .limit(1);
  if (open?.status === 'verified') {
    return { ok: false, httpStatus: 409, error: 'application_pending' };
  }

  let applicationId: number;
  if (open) {
    applicationId = open.id;
    await db
      .update(applications)
      .set({ statement, emailHash, createdAt: now })
      .where(eq(applications.id, applicationId));
  } else {
    const [inserted] = await db
      .insert(applications)
      .values({ handle, kind, statement, emailHash, status: 'pending', ipHash, createdAt: now })
      .returning({ id: applications.id });
    applicationId = inserted!.id;
  }

  // 发码限频（同邮箱滑动 1 小时窗口），复用 email_codes 行上的 send_count
  const [recent] = await db
    .select({ sendCount: emailCodes.sendCount, createdAt: emailCodes.createdAt })
    .from(emailCodes)
    .where(eq(emailCodes.emailHash, emailHash));
  if (recent && recent.createdAt > now - 3600 && recent.sendCount >= APPLICATION.sendsPerHour) {
    return { ok: false, httpStatus: 429, error: 'too_many_code_requests' };
  }

  const code = generateEmailCode();
  await db
    .insert(emailCodes)
    .values({
      emailHash,
      installerHash: await applicationChannelHash(env.INSTALLATION_SALT),
      codeHash: await emailCodeHash(env.INSTALLATION_SALT, emailHash, code),
      attempts: 0,
      sendCount: 1,
      createdAt: now,
      expiresAt: now + APPLICATION.codeTtlSeconds,
    })
    .onConflictDoUpdate({
      target: emailCodes.emailHash,
      set: {
        installerHash: sql`excluded.installer_hash`,
        codeHash: sql`excluded.code_hash`,
        attempts: 0,
        sendCount: sql`CASE WHEN ${emailCodes.createdAt} > ${now - 3600} THEN ${emailCodes.sendCount} + 1 ELSE 1 END`,
        createdAt: sql`excluded.created_at`,
        expiresAt: sql`excluded.expires_at`,
      },
    });

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

  const db = getDb(env);
  const clearCode = () => db.delete(emailCodes).where(eq(emailCodes.emailHash, emailHash));
  const [row] = await db
    .select({
      codeHash: emailCodes.codeHash,
      attempts: emailCodes.attempts,
      expiresAt: emailCodes.expiresAt,
    })
    .from(emailCodes)
    .where(eq(emailCodes.emailHash, emailHash));
  if (!row || row.expiresAt < now) {
    await clearCode();
    return { ok: false, httpStatus: 400, error: 'invalid_or_expired_code' };
  }
  if (row.attempts >= APPLICATION.codeMaxAttempts) {
    await clearCode();
    return { ok: false, httpStatus: 429, error: 'too_many_attempts' };
  }
  if ((await emailCodeHash(env.INSTALLATION_SALT, emailHash, code)) !== row.codeHash) {
    // 错码计数原子递增（并发错猜不能共享读数翻倍上限）
    const bumped = await db
      .update(emailCodes)
      .set({ attempts: sql`${emailCodes.attempts} + 1` })
      .where(
        and(
          eq(emailCodes.emailHash, emailHash),
          lt(emailCodes.attempts, APPLICATION.codeMaxAttempts),
        ),
      )
      .returning({ emailHash: emailCodes.emailHash });
    if (bumped.length === 0) {
      await clearCode();
      return { ok: false, httpStatus: 429, error: 'too_many_attempts' };
    }
    return { ok: false, httpStatus: 400, error: 'invalid_or_expired_code' };
  }
  await clearCode();

  // 一次验证只推进该邮箱最新的一份未决申请（防同邮箱批量灌队列）
  const [pending] = await db
    .select({ id: applications.id, handle: applications.handle, kind: applications.kind })
    .from(applications)
    .where(and(eq(applications.emailHash, emailHash), eq(applications.status, 'pending')))
    .orderBy(desc(applications.createdAt))
    .limit(1);
  if (!pending) return { ok: false, httpStatus: 400, error: 'application_not_found' };

  await db
    .update(applications)
    .set({ status: 'verified', verifiedAt: now })
    .where(and(eq(applications.id, pending.id), eq(applications.status, 'pending')));
  return { ok: true, value: { handle: pending.handle, kind: pending.kind, status: 'verified' } };
}

/** 维护者队列：按状态筛选，创建时间倒序。 */
export async function listApplications(
  env: Cloudflare.Env,
  options: { status?: string; limit?: number } = {},
): Promise<{ entries: ApplicationRow[] }> {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 200) || 200, 1), 1000);
  const entries = await getDb(env)
    .select({
      id: applications.id,
      handle: applications.handle,
      kind: applications.kind,
      statement: applications.statement,
      email_hash: applications.emailHash,
      status: applications.status,
      created_at: applications.createdAt,
      verified_at: applications.verifiedAt,
      decided_at: applications.decidedAt,
      decided_by: applications.decidedBy,
      decision_note: applications.decisionNote,
    })
    .from(applications)
    .where(options.status ? eq(applications.status, options.status) : undefined)
    .orderBy(desc(applications.createdAt), desc(applications.id))
    .limit(limit);
  return { entries };
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
  const trimmedNote = note ? stripNul(note).trim() : '';
  if (trimmedNote.length > APPLICATION.decisionNoteMax) {
    return { ok: false, error: 'invalid_decision_note' };
  }
  const now = Math.floor(Date.now() / 1000);
  const db = getDb(env);
  const updated = await db
    .update(applications)
    .set({
      status: decision,
      decidedAt: now,
      decidedBy: maintainerEmail,
      decisionNote: trimmedNote || null,
    })
    .where(and(eq(applications.id, id), inArray(applications.status, ['pending', 'verified'])))
    .returning({ id: applications.id });
  if (updated.length === 0) {
    const [exists] = await db
      .select({ id: applications.id })
      .from(applications)
      .where(eq(applications.id, id));
    return exists
      ? { ok: false, error: 'application_already_decided' }
      : { ok: false, error: 'application_not_found' };
  }
  return { ok: true, changed: true };
}
