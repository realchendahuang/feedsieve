export const REPORT_REASONS = [
  'bot_spam',
  'copy_paste',
  'ai_slop',
  'advertising',
  'adult_gray_traffic',
  'scam_phishing',
  'engagement_bait',
  'other',
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number];

export interface ValidReport {
  handle: string; // 归一化：去 @、小写
  xUserId: string | null;
  reason: ReportReason;
  evidencePostId: string | null;
  /** 内容指纹（v0.4）：客户端归一化话术文本后的 64bit 哈希，原文不出设备 */
  contentFingerprint: string | null;
  /** 外链 hostname（v0.4）：去重后小写数组；无效项在客户端即被过滤，这里兜底再滤一次 */
  linkDomains: string[];
}

const HANDLE_RE = /^@?([A-Za-z0-9_]{1,15})$/;
const USER_ID_RE = /^\d{1,20}$/;
const POST_ID_RE = /^\d{1,25}$/;
/** 与 packages/detector 的 fingerprintText 输出格式对应：16 位小写十六进制 */
const FINGERPRINT_RE = /^[0-9a-f]{16}$/;
const HOSTNAME_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
/** 自家/媒体域名无信息量，拒绝入库（防污染快照 domains 列表） */
const SELF_DOMAINS = ['x.com', 'twitter.com', 't.co', 'twimg.com'];
const MAX_LINK_DOMAINS = 5;

function isSelfDomain(hostname: string): boolean {
  return SELF_DOMAINS.some(
    (d) => hostname === d || hostname.endsWith(`.${d}`),
  );
}

/** 逐项过滤（坏 hostname 丢弃不拒票）；非数组/超限视为客户端 bug，交由上层拒收 */
function sanitizeLinkDomains(value: unknown): { ok: true; domains: string[] } | { ok: false } {
  if (value === undefined || value === null) {
    return { ok: true, domains: [] };
  }
  if (!Array.isArray(value) || value.length > MAX_LINK_DOMAINS) {
    return { ok: false };
  }
  const domains: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      continue;
    }
    const hostname = item.trim().toLowerCase();
    if (!HOSTNAME_RE.test(hostname) || isSelfDomain(hostname)) {
      continue;
    }
    if (!domains.includes(hostname)) {
      domains.push(hostname);
    }
  }
  return { ok: true, domains };
}

export type ReportValidation =
  | { ok: true; report: ValidReport }
  | { ok: false; error: string };

export function validateReport(raw: unknown): ReportValidation {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: 'report_must_be_object' };
  }
  const r = raw as Record<string, unknown>;

  if (typeof r.handle !== 'string' || !HANDLE_RE.test(r.handle)) {
    return { ok: false, error: 'invalid_handle' };
  }
  if (
    r.x_user_id !== undefined &&
    r.x_user_id !== null &&
    (typeof r.x_user_id !== 'string' || !USER_ID_RE.test(r.x_user_id))
  ) {
    return { ok: false, error: 'invalid_x_user_id' };
  }
  if (
    typeof r.reason !== 'string' ||
    !REPORT_REASONS.includes(r.reason as ReportReason)
  ) {
    return { ok: false, error: 'invalid_reason' };
  }
  let evidencePostId: string | null = null;
  if (r.evidence_post_id !== undefined && r.evidence_post_id !== null) {
    if (
      typeof r.evidence_post_id !== 'string' ||
      !POST_ID_RE.test(r.evidence_post_id)
    ) {
      return { ok: false, error: 'invalid_evidence_post_id' };
    }
    evidencePostId = r.evidence_post_id;
  }

  let contentFingerprint: string | null = null;
  if (r.content_fingerprint !== undefined && r.content_fingerprint !== null) {
    if (
      typeof r.content_fingerprint !== 'string' ||
      !FINGERPRINT_RE.test(r.content_fingerprint)
    ) {
      return { ok: false, error: 'invalid_content_fingerprint' };
    }
    contentFingerprint = r.content_fingerprint;
  }
  const domains = sanitizeLinkDomains(r.link_domains);
  if (!domains.ok) {
    return { ok: false, error: 'invalid_link_domains' };
  }

  return {
    ok: true,
    report: {
      handle: r.handle.replace(/^@/, '').toLowerCase(),
      xUserId: typeof r.x_user_id === 'string' ? r.x_user_id : null,
      reason: r.reason as ReportReason,
      evidencePostId,
      contentFingerprint,
      linkDomains: domains.domains,
    },
  };
}

export type RescueValidation =
  | { ok: true; handle: string; evidencePostId: string | null }
  | { ok: false; error: string };

/** 抢救票不需要 reason / x_user_id：handle 必填 + 可选证据即可 */
export function validateRescue(raw: unknown): RescueValidation {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: 'rescue_must_be_object' };
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.handle !== 'string' || !HANDLE_RE.test(r.handle)) {
    return { ok: false, error: 'invalid_handle' };
  }
  let evidencePostId: string | null = null;
  if (r.evidence_post_id !== undefined && r.evidence_post_id !== null) {
    if (
      typeof r.evidence_post_id !== 'string' ||
      !POST_ID_RE.test(r.evidence_post_id)
    ) {
      return { ok: false, error: 'invalid_evidence_post_id' };
    }
    evidencePostId = r.evidence_post_id;
  }
  return {
    ok: true,
    handle: r.handle.replace(/^@/, '').toLowerCase(),
    evidencePostId,
  };
}
