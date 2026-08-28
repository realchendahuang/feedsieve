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
}

const HANDLE_RE = /^@?([A-Za-z0-9_]{1,15})$/;
const USER_ID_RE = /^\d{1,20}$/;
const POST_ID_RE = /^\d{1,25}$/;

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

  return {
    ok: true,
    report: {
      handle: r.handle.replace(/^@/, '').toLowerCase(),
      xUserId: typeof r.x_user_id === 'string' ? r.x_user_id : null,
      reason: r.reason as ReportReason,
      evidencePostId,
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
