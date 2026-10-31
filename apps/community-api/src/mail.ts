/**
 * 出站邮件与邮箱工具（归一 / 哈希 / 格式校验 / 验证码模板）。
 *
 * 出站邮件四层降级：
 * 1. Cloudflare Email Service（send_email binding，`EMAIL.send()`）——域名在
 *    面板 onboarding 后可直接发任意收件人，零外部凭证；发件地址走 MAIL_FROM。
 * 2. SMTP 直连（SMTP_USER/SMTP_PASS，nodemailer 走 Workers TCP socket；
 *    host/port 未配时按账号域推断常见服务商）。
 * 3. MAIL_WEBHOOK_URL（POST {to, subject, text} 的通用 webhook 契约）。
 * 4. 都未配置 → 返回 false，调用方降级 dev_code（仅限本地开发自测）。
 */

import { sha256Hex, isUsableSalt } from './lib/hash';

interface EmailServiceBinding {
  send(message: {
    to: string;
    from: string;
    subject: string;
    text: string;
    html?: string;
  }): Promise<{ messageId?: string }>;
}

/** 验证码邮件模板展示的有效期；须与调用方（applications.ts）的实际 TTL 一致。 */
export const MAIL_CODE = {
  codeTtlSeconds: 600,
} as const;

/** 按账号域推断常见服务商的 SMTP 端点（省得手填 host/port） */
function inferSmtpEndpoint(email: string): { host: string; port: number; secure: boolean } | null {
  const domain = email.split('@')[1]?.toLowerCase();
  switch (domain) {
    case 'gmail.com':
    case 'googlemail.com':
      return { host: 'smtp.gmail.com', port: 465, secure: true };
    case 'outlook.com':
    case 'hotmail.com':
    case 'live.com':
      return { host: 'smtp-mail.outlook.com', port: 587, secure: false };
    case 'qq.com':
      return { host: 'smtp.qq.com', port: 465, secure: true };
    case '163.com':
      return { host: 'smtp.163.com', port: 465, secure: true };
    case 'icloud.com':
      return { host: 'smtp.mail.me.com', port: 587, secure: false };
    default:
      return null;
  }
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  /** 邮件 HTML 正文（webhook 通道只支持 text，自动忽略 html） */
  html?: string;
}

/** 验证码 HTML 模板复用：hono 无 HTML 转义内置需要，本地转义即可 */
function htmlFor(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll("'", '&#39;');
}

/** 福滤娃验证码邮件：官网托管头像当 logo；图片挂了也不影响读码（纯文字兜底） */
export function verificationCodeEmailHtml(code: string): string {
  const minutes = Math.round(MAIL_CODE.codeTtlSeconds / 60);
  return `<div style="margin:0;padding:24px 12px;background:#faf6ec;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:0;"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#fffdf7;border:1px solid #efe4c8;border-radius:16px;">
      <tr><td align="center" style="padding:28px 24px 8px;">
        <img src="https://feedsieve.win/assets/avatar.png" width="72" height="72" alt="福滤娃" style="display:block;border-radius:16px;border:0;" />
        <div style="margin-top:10px;font-size:17px;font-weight:700;color:#6b4d00;">福滤娃 · 验证码</div>
        <div style="margin-top:6px;font-size:13px;color:#8a7a55;">有人正在验证这个邮箱——是你吗？</div>
      </td></tr>
      <tr><td align="center" style="padding:18px 24px 6px;">
        <div style="display:inline-block;padding:12px 26px;background:#fff8e1;border:1px solid #f0d98c;border-radius:12px;font-size:30px;letter-spacing:9px;font-weight:800;color:#7a5800;font-family:Menlo,Consolas,monospace;">${htmlFor(code)}</div>
      </td></tr>
      <tr><td align="center" style="padding:14px 24px 26px;">
        <div style="font-size:12.5px;color:#8a7a55;">${minutes} 分钟内有效，过期作废（黄推可没有这待遇）。</div>
        <div style="margin-top:6px;font-size:12.5px;color:#8a7a55;">不是你在操作？无视即可，福滤娃不记仇。</div>
      </td></tr>
    </table>
  </td></tr></table>
</div>`;
}

/** 网络失败不阻塞主流程——收不到码的用户可以重新发码。 */
export async function sendMail(env: Cloudflare.Env, message: MailMessage): Promise<boolean> {
  // 1. Cloudflare Email Service（send_email 绑定；发件域名需在面板 onboarding）
  const emailService = (env as { EMAIL?: EmailServiceBinding }).EMAIL;
  const from = env.MAIL_FROM?.trim() || env.SMTP_FROM?.trim();
  if (emailService && typeof emailService.send === 'function' && from) {
    try {
      await emailService.send({
        to: message.to,
        from,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
      // send 不抛错即受理（部分版本响应不含 messageId，不以此判失败）
      return true;
    } catch (error) {
      console.error('[community-api] email-service send failed:', error);
    }
  }

  const smtpUser = env.SMTP_USER?.trim();
  const smtpPass = env.SMTP_PASS;
  if (smtpUser && smtpPass) {
    try {
      // nodemailer 支持 Workers（nodejs_compat + cloudflare:sockets）；
      // 动态 import：未配置 SMTP 的部署完全不加载，行为与旧版一致。
      const nodemailer = await import('nodemailer');
      const inferred = inferSmtpEndpoint(smtpUser);
      const host = env.SMTP_HOST?.trim() || inferred?.host;
      if (!host) return false;
      const secure = env.SMTP_PORT?.trim()
        ? Number(env.SMTP_PORT) === 465
        : (inferred?.secure ?? false);
      const port = env.SMTP_PORT?.trim()
        ? Number(env.SMTP_PORT)
        : (inferred?.port ?? (secure ? 465 : 587));
      const transport = nodemailer.createTransport({
        host,
        port,
        secure,
        auth: { user: smtpUser, pass: smtpPass },
      });
      await transport.sendMail({
        from: env.SMTP_FROM?.trim() || smtpUser,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
      return true;
    } catch (error) {
      console.error('[community-api] smtp send failed:', error);
      return false;
    }
  }

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

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Gmail 别名归一：user+tag / 加点变体收敛到同一邮箱，堵无限注册口子 */
export function normalizeEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  const at = email.lastIndexOf('@');
  if (at < 0) return email;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    return `${(local.split('+')[0] ?? '').replaceAll('.', '')}@gmail.com`;
  }
  return `${local.split('+')[0] ?? ''}@${domain}`;
}

export async function hashEmail(salt: string, email: string): Promise<string> {
  if (!isUsableSalt(salt)) {
    throw new Error('installation_salt_missing');
  }
  return sha256Hex(`email:${salt}:${email}`);
}

export function isValidEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 254 && EMAIL_PATTERN.test(value);
}
