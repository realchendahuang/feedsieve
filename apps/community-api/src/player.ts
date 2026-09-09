/**
 * 猎手档案：installation 哈希即匿名账号，邮箱验证码只负责「解锁自定义
 * 昵称 / 一句话介绍」（无密码、无会话）。邮箱仅用于发码，只存加盐哈希。
 *
 * 发信走 MAIL_WEBHOOK_URL（secret）：POST {to, subject, text} 的通用
 * webhook 契约，部署侧用任意出站实现对接（如 Cloudflare Email Workers /
 * SMTP 转发 Worker）。未配置时返回 dev_code 供本地开发自测，生产必须配置。
 */

import { sha256Hex } from './lib/hash';
import { markLeaderboardDirty } from './leaderboard';

export const PLAYER = {
  codeTtlSeconds: 600,
  codeMaxAttempts: 5,
  /** 同一邮箱每小时最多发码次数 */
  sendsPerHour: 3,
  displayNameMax: 16,
  bioMax: 60,
} as const;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Gmail 别名归一：user+tag / 加点变体收敛到同一邮箱，堵无限注册口子 */
export function normalizeEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  const at = email.lastIndexOf('@');
  if (at < 0) return email;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    return `${local.split('+')[0].replaceAll('.', '')}@gmail.com`;
  }
  return `${local.split('+')[0]}@${domain}`;
}

export async function hashEmail(salt: string, email: string): Promise<string> {
  if (typeof salt !== 'string' || salt.length < 16) {
    throw new Error('installation_salt_missing');
  }
  return sha256Hex(`email:${salt}:${email}`);
}

function isValidInstallationId(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 8 && value.length <= 128;
}

export function isValidEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 254 && EMAIL_PATTERN.test(value);
}

type PlayerResult<T> = { ok: true; value: T } | { ok: false; httpStatus: 400 | 403 | 429; error: string };

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/**
 * 出站邮件通用接口。MAIL_WEBHOOK_URL 未配置时静默失败（调用方决定是否
 * 降级为 dev_code）；网络失败不阻塞主流程——收不到码的 用户可重新发码。
 */
export async function sendMail(env: Cloudflare.Env, message: MailMessage): Promise<boolean> {
  const url = env.MAIL_WEBHOOK_URL?.trim();
  if (!url) return false;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(message),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function generateCode(): string {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return String(buffer[0] % 1_000_000).padStart(6, '0');
}

async function codeHash(salt: string, emailHash: string, code: string): Promise<string> {
  return sha256Hex(`email-code:${salt}:${emailHash}:${code}`);
}

export async function bindEmail(
  env: Cloudflare.Env,
  body: unknown,
): Promise<PlayerResult<{ sent: boolean; dev_code?: string }>> {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  if (!isValidInstallationId(b.installation_id)) {
    return { ok: false, httpStatus: 400, error: 'invalid_installation_id' };
  }
  if (!isValidEmail(b.email)) {
    return { ok: false, httpStatus: 400, error: 'invalid_email' };
  }
  const email = normalizeEmail(b.email);
  const emailHash = await hashEmail(env.INSTALLATION_SALT, email);
  const installHash = await sha256Hex(`${env.INSTALLATION_SALT}:${b.installation_id}`);
  const now = Math.floor(Date.now() / 1000);

  // 限频：同一邮箱滑动 1 小时窗口内 send_count 计数（UPSERT 覆盖行的单值存储）
  const recent = await env.DB.prepare(
    'SELECT send_count, created_at FROM email_codes WHERE email_hash = ?1',
  )
    .bind(emailHash)
    .first<{ send_count: number; created_at: number }>();
  if (recent && recent.created_at > now - 3600 && recent.send_count >= PLAYER.sendsPerHour) {
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
      installHash,
      await codeHash(env.INSTALLATION_SALT, emailHash, code),
      now,
      now + PLAYER.codeTtlSeconds,
      now - 3600,
    )
    .run();

  const sent = await sendMail(env, {
    to: email,
    subject: 'FeedSieve 验证码',
    text: `验证码 ${code}，10 分钟内有效。`,
  });
  return { ok: true, value: sent ? { sent: true } : { sent: false, dev_code: code } };
}

export async function verifyEmail(
  env: Cloudflare.Env,
  body: unknown,
): Promise<PlayerResult<{ email_verified: true }>> {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  if (!isValidInstallationId(b.installation_id)) {
    return { ok: false, httpStatus: 400, error: 'invalid_installation_id' };
  }
  if (!isValidEmail(b.email)) {
    return { ok: false, httpStatus: 400, error: 'invalid_email' };
  }
  const code = b.code;
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) {
    return { ok: false, httpStatus: 400, error: 'invalid_code' };
  }
  const emailHash = await hashEmail(env.INSTALLATION_SALT, normalizeEmail(b.email));
  const installHash = await sha256Hex(`${env.INSTALLATION_SALT}:${b.installation_id}`);
  const now = Math.floor(Date.now() / 1000);

  const row = await env.DB.prepare(
    'SELECT installer_hash, code_hash, attempts, expires_at FROM email_codes WHERE email_hash = ?1',
  )
    .bind(emailHash)
    .first<{ installer_hash: string; code_hash: string; attempts: number; expires_at: number }>();
  if (!row || row.expires_at < now) {
    await env.DB.prepare('DELETE FROM email_codes WHERE email_hash = ?1').bind(emailHash).run();
    return { ok: false, httpStatus: 400, error: 'invalid_or_expired_code' };
  }
  if (row.attempts >= PLAYER.codeMaxAttempts) {
    await env.DB.prepare('DELETE FROM email_codes WHERE email_hash = ?1').bind(emailHash).run();
    return { ok: false, httpStatus: 429, error: 'too_many_attempts' };
  }
  if (row.installer_hash !== installHash) {
    return { ok: false, httpStatus: 400, error: 'invalid_or_expired_code' };
  }
  if ((await codeHash(env.INSTALLATION_SALT, emailHash, code)) !== row.code_hash) {
    await env.DB.prepare(
      'UPDATE email_codes SET attempts = attempts + 1 WHERE email_hash = ?1',
    )
      .bind(emailHash)
      .run();
    return { ok: false, httpStatus: 400, error: 'invalid_or_expired_code' };
  }

  await env.DB.prepare('DELETE FROM email_codes WHERE email_hash = ?1').bind(emailHash).run();
  await env.DB.prepare(
    `INSERT INTO installations (id, first_seen_at, last_seen_at, email_hash, email_verified_at)
     VALUES (?1, ?2, ?2, ?3, ?2)
     ON CONFLICT(id) DO UPDATE SET
       last_seen_at = excluded.last_seen_at,
       email_hash = excluded.email_hash,
       email_verified_at = excluded.email_verified_at`,
  )
    .bind(installHash, now, emailHash)
    .run();
  return { ok: true, value: { email_verified: true } };
}

/** 当前档案（设置页展示）。installation 哈希即凭证，返回纯展示字段。 */
export async function getProfile(
  env: Cloudflare.Env,
  body: unknown,
): Promise<
  PlayerResult<{
    display_name: string | null;
    bio: string | null;
    title: string | null;
    email_verified: boolean;
  }>
> {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  if (!isValidInstallationId(b.installation_id)) {
    return { ok: false, httpStatus: 400, error: 'invalid_installation_id' };
  }
  const installHash = await sha256Hex(`${env.INSTALLATION_SALT}:${b.installation_id}`);
  const row = await env.DB.prepare(
    'SELECT display_name, bio, title, email_verified_at FROM installations WHERE id = ?1',
  )
    .bind(installHash)
    .first<{
      display_name: string | null;
      bio: string | null;
      title: string | null;
      email_verified_at: number | null;
    }>();
  return {
    ok: true,
    value: {
      display_name: row?.display_name ?? null,
      bio: row?.bio ?? null,
      title: row?.title ?? null,
      email_verified: row?.email_verified_at != null,
    },
  };
}

export async function updateProfile(
  env: Cloudflare.Env,
  body: unknown,
): Promise<PlayerResult<{ display_name: string | null; bio: string | null }>> {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  if (!isValidInstallationId(b.installation_id)) {
    return { ok: false, httpStatus: 400, error: 'invalid_installation_id' };
  }
  const displayName = typeof b.display_name === 'string' ? b.display_name.trim() : null;
  const bio = typeof b.bio === 'string' ? b.bio.trim() : null;
  if (displayName != null && (displayName.length === 0 || displayName.length > PLAYER.displayNameMax)) {
    return { ok: false, httpStatus: 400, error: 'invalid_display_name' };
  }
  if (bio != null && bio.length > PLAYER.bioMax) {
    return { ok: false, httpStatus: 400, error: 'invalid_bio' };
  }
  const installHash = await sha256Hex(`${env.INSTALLATION_SALT}:${b.installation_id}`);

  const row = await env.DB.prepare(
    'SELECT email_verified_at FROM installations WHERE id = ?1',
  )
    .bind(installHash)
    .first<{ email_verified_at: number | null }>();
  if (!row || row.email_verified_at == null) {
    return { ok: false, httpStatus: 403, error: 'email_verification_required' };
  }

  await env.DB.prepare(
    'UPDATE installations SET display_name = ?2, bio = ?3 WHERE id = ?1',
  )
    .bind(installHash, displayName, bio)
    .run();
  await markLeaderboardDirty(env);
  return { ok: true, value: { display_name: displayName, bio } };
}
