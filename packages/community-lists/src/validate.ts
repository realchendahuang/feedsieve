import type { CommunityStatus, SnapshotBody, SnapshotManifest } from './types';

const STATUSES: readonly string[] = ['candidate', 'recommended', 'strong'];
const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
const USER_ID_RE = /^\d{1,20}$/;
const POST_ID_RE = /^\d{1,25}$/;
const VERSION_RE = /^\d{4}\.\d{2}\.\d{2}\.\d{1,4}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseManifest(raw: unknown): ParseResult<SnapshotManifest> {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: 'manifest_not_object' };
  }
  const m = raw as Record<string, unknown>;
  if (m.schema_version !== 1) {
    return { ok: false, error: 'unsupported_schema_version' };
  }
  if (
    typeof m.snapshot_version !== 'string' ||
    !VERSION_RE.test(m.snapshot_version)
  ) {
    return { ok: false, error: 'invalid_snapshot_version' };
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
      schema_version: 1,
      snapshot_version: m.snapshot_version,
      generated_at: typeof m.generated_at === 'string' ? m.generated_at : '',
      files,
    },
  };
}

/** 逐条校验；坏条目直接跳过（服务器才是质量源头，这里只防脏数据进索引） */
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
  if (s.schema_version !== 1) {
    return { ok: false, error: 'unsupported_schema_version' };
  }
  if (
    typeof s.snapshot_version !== 'string' ||
    !VERSION_RE.test(s.snapshot_version)
  ) {
    return { ok: false, error: 'invalid_snapshot_version' };
  }
  if (!Array.isArray(s.entries)) {
    return { ok: false, error: 'entries_not_array' };
  }

  const entries = [];
  for (const item of s.entries) {
    const entry = validateEntry(item);
    if (entry) {
      entries.push(entry);
    }
  }
  return {
    ok: true,
    value: {
      schema_version: 1,
      snapshot_version: s.snapshot_version,
      generated_at: typeof s.generated_at === 'string' ? s.generated_at : '',
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
    !STATUSES.includes(e.status as string) ||
    typeof e.report_count !== 'number' ||
    typeof e.rescue_count !== 'number' ||
    !Array.isArray(e.evidence_post_ids) ||
    !e.evidence_post_ids.every(
      (id) => typeof id === 'string' && POST_ID_RE.test(id),
    )
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
  if (
    e.community_score !== undefined &&
    e.community_score !== null &&
    (typeof e.community_score !== 'number' ||
      !Number.isFinite(e.community_score) ||
      e.community_score < 0 ||
      e.community_score > 1)
  ) {
    return null;
  }
  if (
    e.aliases !== undefined &&
    e.aliases !== null &&
    (!Array.isArray(e.aliases) ||
      !e.aliases.every(
        (a) => typeof a === 'string' && HANDLE_RE.test(a),
      ))
  ) {
    return null;
  }
  return {
    handle: e.handle.toLowerCase(),
    x_user_id: typeof e.x_user_id === 'string' ? e.x_user_id : null,
    category: e.category,
    status: e.status as CommunityStatus,
    ...(typeof e.community_score === 'number'
      ? { community_score: e.community_score }
      : {}),
    report_count: e.report_count,
    rescue_count: e.rescue_count,
    ...(Array.isArray(e.aliases)
      ? { aliases: e.aliases.map((a) => (a as string).toLowerCase()) }
      : {}),
    first_seen_at: typeof e.first_seen_at === 'string' ? e.first_seen_at : '',
    updated_at: typeof e.updated_at === 'string' ? e.updated_at : '',
    evidence_post_ids: e.evidence_post_ids,
  };
}
