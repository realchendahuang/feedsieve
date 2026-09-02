import type { CommunitySource, SnapshotBody, SnapshotManifest } from './types';

const SOURCES: readonly CommunitySource[] = ['community', 'maintainer'];
const CATEGORIES = new Set([
  'bot_spam',
  'copy_paste',
  'ai_slop',
  'advertising',
  'adult_gray_traffic',
  'scam_phishing',
  'engagement_bait',
  'other',
]);
const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
const USER_ID_RE = /^\d{1,20}$/;
const POST_ID_RE = /^\d{1,25}$/;
const VERSION_RE = /^\d{4}\.\d{2}\.\d{2}\.\d{1,4}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
/** 内容指纹（v0.4）：16 位小写十六进制，与 detector 的 fingerprintText 输出对应 */
const FINGERPRINT_RE = /^[0-9a-f]{16}$/;
const HOSTNAME_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
/** 快照单条目指纹/域名证据上限（与服务端 MAX_EVIDENCE_PER_ENTRY 对应） */
const MAX_EVIDENCE = 5;

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value));
}

function validEvidenceList(value: unknown, itemCheck: (item: string) => boolean): string[] | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (
    !Array.isArray(value) ||
    value.length > MAX_EVIDENCE ||
    !value.every((item) => typeof item === 'string' && itemCheck(item))
  ) {
    return null;
  }
  return value as string[];
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseManifest(raw: unknown): ParseResult<SnapshotManifest> {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: 'manifest_not_object' };
  }
  const m = raw as Record<string, unknown>;
  if (m.schema_version !== 2) {
    return { ok: false, error: 'unsupported_schema_version' };
  }
  if (typeof m.snapshot_version !== 'string' || !VERSION_RE.test(m.snapshot_version)) {
    return { ok: false, error: 'invalid_snapshot_version' };
  }
  if (!isIsoDate(m.generated_at)) {
    return { ok: false, error: 'invalid_generated_at' };
  }
  if (!Array.isArray(m.files) || m.files.length === 0) {
    return { ok: false, error: 'manifest_files_empty' };
  }
  const files = [];
  for (const f of m.files) {
    if (typeof f !== 'object' || f === null) {
      return { ok: false, error: 'invalid_manifest_file' };
    }
    const file = f as Record<string, unknown>;
    if (
      typeof file.path !== 'string' ||
      typeof file.sha256 !== 'string' ||
      !SHA256_RE.test(file.sha256) ||
      typeof file.entries !== 'number' ||
      !Number.isInteger(file.entries) ||
      file.entries < 0
    ) {
      return { ok: false, error: 'invalid_manifest_file' };
    }
    files.push({
      path: file.path,
      sha256: file.sha256,
      entries: file.entries,
    });
  }
  return {
    ok: true,
    value: {
      schema_version: 2,
      snapshot_version: m.snapshot_version,
      generated_at: m.generated_at,
      files,
    },
  };
}

/** 严格逐条校验；任一坏条目都会使整份快照失败，避免部分脏数据替换 last-known-good。 */
export function parseSnapshotBody(text: string): ParseResult<SnapshotBody> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'snapshot_not_json' };
  }
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: 'snapshot_not_object' };
  }
  const s = raw as Record<string, unknown>;
  if (s.schema_version !== 2) {
    return { ok: false, error: 'unsupported_schema_version' };
  }
  if (typeof s.snapshot_version !== 'string' || !VERSION_RE.test(s.snapshot_version)) {
    return { ok: false, error: 'invalid_snapshot_version' };
  }
  if (!isIsoDate(s.generated_at)) {
    return { ok: false, error: 'invalid_generated_at' };
  }
  if (!Array.isArray(s.entries)) {
    return { ok: false, error: 'entries_not_array' };
  }

  const entries = [];
  const handles = new Set<string>();
  for (const item of s.entries) {
    const entry = validateEntry(item);
    if (!entry) return { ok: false, error: 'invalid_snapshot_entry' };
    if (handles.has(entry.handle)) return { ok: false, error: 'duplicate_snapshot_handle' };
    handles.add(entry.handle);
    entries.push(entry);
  }
  return {
    ok: true,
    value: {
      schema_version: 2,
      snapshot_version: s.snapshot_version,
      generated_at: s.generated_at,
      entries,
    },
  };
}

function validateEntry(item: unknown): import('./types').CommunityEntry | null {
  if (typeof item !== 'object' || item === null) {
    return null;
  }
  const e = item as Record<string, unknown>;
  if (
    typeof e.handle !== 'string' ||
    !HANDLE_RE.test(e.handle) ||
    typeof e.category !== 'string' ||
    !CATEGORIES.has(e.category) ||
    !Array.isArray(e.sources) ||
    e.sources.length === 0 ||
    !e.sources.every((source) => SOURCES.includes(source as CommunitySource)) ||
    new Set(e.sources).size !== e.sources.length ||
    typeof e.community_score !== 'number' ||
    !Number.isFinite(e.community_score) ||
    e.community_score < 0 ||
    e.community_score > 1 ||
    typeof e.report_count !== 'number' ||
    !Number.isInteger(e.report_count) ||
    e.report_count < 0 ||
    typeof e.rescue_count !== 'number' ||
    !Number.isInteger(e.rescue_count) ||
    e.rescue_count < 0 ||
    typeof e.net_votes !== 'number' ||
    !Number.isInteger(e.net_votes) ||
    e.net_votes !== e.report_count - e.rescue_count ||
    !Array.isArray(e.evidence_post_ids) ||
    e.evidence_post_ids.length > MAX_EVIDENCE ||
    !e.evidence_post_ids.every((id) => typeof id === 'string' && POST_ID_RE.test(id))
  ) {
    return null;
  }
  if (
    e.x_user_id !== null &&
    e.x_user_id !== undefined &&
    (typeof e.x_user_id !== 'string' || !USER_ID_RE.test(e.x_user_id))
  ) {
    return null;
  }
  const sources = e.sources as CommunitySource[];
  if (
    sources.includes('maintainer') &&
    (typeof e.maintainer_note !== 'string' ||
      e.maintainer_note.trim().length < 4 ||
      e.maintainer_note.length > 240)
  ) {
    return null;
  }
  if (e.maintainer_note !== undefined && typeof e.maintainer_note !== 'string') {
    return null;
  }
  if (!sources.includes('maintainer') && e.maintainer_note !== undefined) {
    return null;
  }
  if (!isIsoDate(e.first_seen_at) || !isIsoDate(e.updated_at)) {
    return null;
  }
  if (
    e.aliases !== undefined &&
    e.aliases !== null &&
    (!Array.isArray(e.aliases) ||
      !e.aliases.every((a) => typeof a === 'string' && HANDLE_RE.test(a)))
  ) {
    return null;
  }
  // v0.4 内容证据：字段存在但内容非法 → 整条丢弃（防脏数据进索引）
  const fingerprints = validEvidenceList(e.fingerprints, (item) => FINGERPRINT_RE.test(item));
  if (e.fingerprints != null && fingerprints === null) {
    return null;
  }
  const domains = validEvidenceList(e.domains, (item) => HOSTNAME_RE.test(item.toLowerCase()));
  if (e.domains != null && domains === null) {
    return null;
  }
  // v0.5 campaign：entry_id 是 handle 格式、size 是正整数；非法 → 整条丢弃
  if (
    e.campaign_entry_id !== undefined &&
    e.campaign_entry_id !== null &&
    (typeof e.campaign_entry_id !== 'string' || !HANDLE_RE.test(e.campaign_entry_id))
  ) {
    return null;
  }
  if (
    e.campaign_size !== undefined &&
    e.campaign_size !== null &&
    (typeof e.campaign_size !== 'number' ||
      !Number.isInteger(e.campaign_size) ||
      e.campaign_size < 2)
  ) {
    return null;
  }
  return {
    handle: e.handle.toLowerCase(),
    x_user_id: typeof e.x_user_id === 'string' ? e.x_user_id : null,
    category: e.category,
    sources,
    ...(typeof e.maintainer_note === 'string' ? { maintainer_note: e.maintainer_note.trim() } : {}),
    community_score: e.community_score as number,
    report_count: e.report_count,
    rescue_count: e.rescue_count,
    net_votes: e.net_votes as number,
    ...(Array.isArray(e.aliases)
      ? { aliases: e.aliases.map((a) => (a as string).toLowerCase()) }
      : {}),
    ...(fingerprints ? { fingerprints } : {}),
    ...(domains ? { domains: domains.map((d) => d.toLowerCase()) } : {}),
    ...(typeof e.campaign_entry_id === 'string'
      ? { campaign_entry_id: e.campaign_entry_id.toLowerCase() }
      : {}),
    ...(typeof e.campaign_size === 'number' ? { campaign_size: e.campaign_size } : {}),
    first_seen_at: typeof e.first_seen_at === 'string' ? e.first_seen_at : '',
    updated_at: typeof e.updated_at === 'string' ? e.updated_at : '',
    evidence_post_ids: e.evidence_post_ids,
  };
}
