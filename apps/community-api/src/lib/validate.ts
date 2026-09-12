import { CATEGORIES, HANDLE_INPUT_RE } from '@feedsieve/shared';

// 分类词表唯一权威源在 @feedsieve/shared（客户端/服务端/后台共用）；这里保留历史导出名。
export const REPORT_REASONS = CATEGORIES;

export type ReportReason = (typeof REPORT_REASONS)[number];

export interface ValidReport {
  handle: string; // 归一化：去 @、小写
  xUserId: string | null;
  reason: ReportReason;
  evidencePostId: string | null;
  /** 内容指纹（v0.4）：客户端归一化话术文本后的 64bit 哈希 */
  contentFingerprint: string | null;
  /** 外链 hostname（v0.4）：去重后小写数组；无效项在客户端即被过滤，这里兜底再滤一次 */
  linkDomains: string[];
  /** 检测来源（v0.7.6）：手动标记 = manual；检测器命中标记各自来源；旧客户端缺省为 null */
  detectionSource: string | null;
  /** 击杀时刻探活结果（#2 定稿）：扩展在用户浏览器对该 handle 做的一次 guest 存活探测；旧客户端缺省为 null */
  liveness: 'alive' | 'dead' | null;
  /** 判定材料（2026-09-12 拍板随票上报，推文本就是公开内容）：推文原文 / 作者昵称 / 简介原文。
   * 旧客户端缺省 null；纯分析用，不进快照公开面。 */
  tweetText: string | null;
  displayName: string | null;
  bio: string | null;
}

const HANDLE_RE = HANDLE_INPUT_RE; // 共享正则（与 admin 表单、extension 手动输入同源）
const USER_ID_RE = /^\d{1,20}$/;
const POST_ID_RE = /^\d{1,25}$/;
/** 与 packages/detector 的 fingerprintText 输出格式对应：16 位小写十六进制 */
const FINGERPRINT_RE = /^[0-9a-f]{16}$/;
const HOSTNAME_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
/** 自家/媒体域名无信息量，拒绝入库（防污染快照 domains 列表） */
const SELF_DOMAINS = ['x.com', 'twitter.com', 't.co', 'twimg.com'];
const MAX_LINK_DOMAINS = 5;

function isSelfDomain(hostname: string): boolean {
  return SELF_DOMAINS.some((d) => hostname === d || hostname.endsWith(`.${d}`));
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

export type ReportValidation = { ok: true; report: ValidReport } | { ok: false; error: string };

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
  if (typeof r.reason !== 'string' || !REPORT_REASONS.includes(r.reason as ReportReason)) {
    return { ok: false, error: 'invalid_reason' };
  }
  let evidencePostId: string | null = null;
  if (r.evidence_post_id !== undefined && r.evidence_post_id !== null) {
    if (typeof r.evidence_post_id !== 'string' || !POST_ID_RE.test(r.evidence_post_id)) {
      return { ok: false, error: 'invalid_evidence_post_id' };
    }
    evidencePostId = r.evidence_post_id;
  }

  let contentFingerprint: string | null = null;
  if (r.content_fingerprint !== undefined && r.content_fingerprint !== null) {
    if (typeof r.content_fingerprint !== 'string' || !FINGERPRINT_RE.test(r.content_fingerprint)) {
      return { ok: false, error: 'invalid_content_fingerprint' };
    }
    contentFingerprint = r.content_fingerprint;
  }
  const domains = sanitizeLinkDomains(r.link_domains);
  if (!domains.ok) {
    return { ok: false, error: 'invalid_link_domains' };
  }
  let detectionSource: string | null = null;
  if (r.detection_source !== undefined && r.detection_source !== null) {
    if (
      typeof r.detection_source !== 'string' ||
      !REPORT_DETECTION_SOURCES.includes(r.detection_source as (typeof REPORT_DETECTION_SOURCES)[number])
    ) {
      return { ok: false, error: 'invalid_detection_source' };
    }
    detectionSource = r.detection_source;
  }

  let liveness: 'alive' | 'dead' | null = null;
  if (r.liveness !== undefined && r.liveness !== null) {
    if (r.liveness !== 'alive' && r.liveness !== 'dead') {
      return { ok: false, error: 'invalid_liveness' };
    }
    liveness = r.liveness;
  }

  // 判定材料（公开推文原文/昵称/简介）：可选，长度上限防 D1 膨胀；坏类型整条拒收
  const violation = validateEvidenceText(r.tweet_text, MAX_TWEET_TEXT_LENGTH, 'tweet_text');
  if (violation) return { ok: false, error: violation };
  const tweetText = asTrimmedOrNull(r.tweet_text);
  const displayNameViolation = validateEvidenceText(
    r.display_name,
    MAX_DISPLAY_NAME_LENGTH,
    'display_name',
  );
  if (displayNameViolation) return { ok: false, error: displayNameViolation };
  const displayName = asTrimmedOrNull(r.display_name);
  const bioViolation = validateEvidenceText(r.bio, MAX_BIO_TEXT_LENGTH, 'bio');
  if (bioViolation) return { ok: false, error: bioViolation };
  const bio = asTrimmedOrNull(r.bio);

  return {
    ok: true,
    report: {
      handle: r.handle.replace(/^@/, '').toLowerCase(),
      xUserId: typeof r.x_user_id === 'string' ? r.x_user_id : null,
      reason: r.reason as ReportReason,
      evidencePostId,
      contentFingerprint,
      linkDomains: domains.domains,
      detectionSource,
      liveness,
      tweetText,
      displayName,
      bio,
    },
  };
}

const MAX_TWEET_TEXT_LENGTH = 500;
const MAX_DISPLAY_NAME_LENGTH = 100;
const MAX_BIO_TEXT_LENGTH = 500;

function validateEvidenceText(value: unknown, max: number, field: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    return `invalid_${field}`;
  }
  if (value.trim().length === 0 || value.length > max) {
    return `invalid_${field}`;
  }
  return null;
}

function asTrimmedOrNull(value: unknown): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed ? trimmed : null;
}

export type RescueValidation =
  | {
      ok: true;
      handle: string;
      xUserId: string | null;
      evidencePostId: string | null;
      detectionSource: string | null;
      ruleId: string | null;
      detectionReason: string | null;
    }
  | { ok: false; error: string };

const DETECTION_SOURCES = [
  'community-list',
  'builtin-list',
  'heuristic',
  'fingerprint',
  'domain',
  'ai',
  'blocked',
] as const;
/** 举报侧额外允许「人工」来源：用户手动标记 ≠ 检测器命中，规则质量分析据此区分。 */
const REPORT_DETECTION_SOURCES = [...DETECTION_SOURCES, 'manual'] as const;
const RULE_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_DETECTION_REASON_LENGTH = 240;

/**
 * 抢救/误标反馈：handle 必填；检测来源、规则与当时的人类可读理由可选。
 * 旧版客户端只传 handle，仍然完全兼容。
 */
export function validateRescue(raw: unknown): RescueValidation {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: 'rescue_must_be_object' };
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
  let evidencePostId: string | null = null;
  if (r.evidence_post_id !== undefined && r.evidence_post_id !== null) {
    if (typeof r.evidence_post_id !== 'string' || !POST_ID_RE.test(r.evidence_post_id)) {
      return { ok: false, error: 'invalid_evidence_post_id' };
    }
    evidencePostId = r.evidence_post_id;
  }
  let detectionSource: string | null = null;
  if (r.detection_source !== undefined && r.detection_source !== null) {
    if (
      typeof r.detection_source !== 'string' ||
      !DETECTION_SOURCES.includes(r.detection_source as (typeof DETECTION_SOURCES)[number])
    ) {
      return { ok: false, error: 'invalid_detection_source' };
    }
    detectionSource = r.detection_source;
  }
  let ruleId: string | null = null;
  if (r.rule_id !== undefined && r.rule_id !== null) {
    if (typeof r.rule_id !== 'string' || !RULE_ID_RE.test(r.rule_id)) {
      return { ok: false, error: 'invalid_rule_id' };
    }
    ruleId = r.rule_id;
  }
  let detectionReason: string | null = null;
  if (r.detection_reason !== undefined && r.detection_reason !== null) {
    if (
      typeof r.detection_reason !== 'string' ||
      r.detection_reason.length === 0 ||
      r.detection_reason.length > MAX_DETECTION_REASON_LENGTH
    ) {
      return { ok: false, error: 'invalid_detection_reason' };
    }
    detectionReason = r.detection_reason;
  }
  return {
    ok: true,
    handle: r.handle.replace(/^@/, '').toLowerCase(),
    xUserId: typeof r.x_user_id === 'string' ? r.x_user_id : null,
    evidencePostId,
    detectionSource,
    ruleId,
    detectionReason,
  };
}
