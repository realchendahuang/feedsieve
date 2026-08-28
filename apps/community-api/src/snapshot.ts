import { sha256Hex } from './lib/hash';
import { computeScore } from './lib/score';

export const SNAPSHOT_SCHEMA_VERSION = 1;
export const SNAPSHOT_PACK = 'official.json';

export interface SnapshotEntry {
  handle: string;
  x_user_id: string | null;
  category: string;
  status: string;
  community_score: number;
  report_count: number;
  rescue_count: number;
  first_seen_at: string;
  updated_at: string;
  evidence_post_ids: string[];
}

interface AccountRow {
  handle: string;
  x_user_id: string | null;
  category: string;
  status: string;
  report_count: number;
  rescue_count: number;
  first_report_at: number;
  updated_at: number;
}

export interface SnapshotFile {
  path: string;
  sha256: string;
  entries: number;
  body: string; // 序列化好的最终 JSON，原样分发
}

export interface PublishedSnapshot {
  version: string;
  manifest: Record<string, unknown>;
  files: Record<string, SnapshotFile>;
}

function nextVersion(existing: string | null, dateStamp: string): string {
  if (existing && existing.startsWith(`${dateStamp}.`)) {
    const n = Number.parseInt(existing.split('.')[3] ?? '0', 10);
    return `${dateStamp}.${n + 1}`;
  }
  return `${dateStamp}.1`;
}

// 键按固定顺序写入（JS 字符串键保持插入序）+ 条目按 handle 排序 => 同一数据必然产出同字节 JSON
function buildEntry(row: AccountRow, evidence: string[], distinctDays: number) {
  return {
    handle: row.handle,
    x_user_id: row.x_user_id,
    category: row.category,
    status: row.status,
    community_score: computeScore({
      reportCount: row.report_count,
      rescueCount: row.rescue_count,
      distinctDays,
    }),
    report_count: row.report_count,
    rescue_count: row.rescue_count,
    first_seen_at: new Date(row.first_report_at * 1000).toISOString(),
    updated_at: new Date(row.updated_at * 1000).toISOString(),
    evidence_post_ids: evidence,
  };
}

async function collectEvidence(
  env: Cloudflare.Env,
  handle: string,
): Promise<string[]> {
  const res = await env.DB.prepare(
    `SELECT DISTINCT evidence_post_id FROM reports
     WHERE handle = ?1 AND evidence_post_id IS NOT NULL LIMIT 5`,
  )
    .bind(handle)
    .all<{ evidence_post_id: string }>();
  return res.results.map((r) => r.evidence_post_id);
}

export async function generateSnapshot(
  env: Cloudflare.Env,
): Promise<PublishedSnapshot> {
  const now = new Date();
  const dateStamp = now.toISOString().slice(0, 10).replaceAll('-', '.');

  const latest = await env.DB.prepare(
    "SELECT version FROM snapshots WHERE version LIKE ?1 ORDER BY version DESC LIMIT 1",
  )
    .bind(`${dateStamp}.%`)
    .first<{ version: string }>();
  const version = nextVersion(latest?.version ?? null, dateStamp);

  const accounts = await env.DB.prepare(
    `SELECT handle, x_user_id, category, status, report_count, rescue_count,
            first_report_at, updated_at
     FROM accounts
     WHERE status IN ('candidate', 'recommended', 'strong')
     ORDER BY handle ASC`,
  ).all<AccountRow>();

  const entries = [];
  const dayRows = await env.DB.prepare(
    `SELECT handle, COUNT(DISTINCT date(created_at, 'unixepoch')) AS days
     FROM reports GROUP BY handle`,
  ).all<{ handle: string; days: number }>();
  const daysByHandle = new Map(
    dayRows.results.map((r) => [r.handle, r.days] as const),
  );
  for (const row of accounts.results) {
    const evidence = await collectEvidence(env, row.handle);
    entries.push(
      buildEntry(row, evidence, daysByHandle.get(row.handle) ?? 1),
    );
  }

  const body = JSON.stringify({
    schema_version: SNAPSHOT_SCHEMA_VERSION,
    snapshot_version: version,
    generated_at: now.toISOString(),
    entries,
  });

  const file: SnapshotFile = {
    path: SNAPSHOT_PACK,
    sha256: await sha256Hex(body),
    entries: entries.length,
    body,
  };

  const manifest = {
    schema_version: SNAPSHOT_SCHEMA_VERSION,
    snapshot_version: version,
    generated_at: now.toISOString(),
    files: [{ path: file.path, sha256: file.sha256, entries: file.entries }],
  };

  await env.DB.prepare(
    `INSERT INTO snapshots (version, manifest_json, files_json, created_at)
     VALUES (?1, ?2, ?3, ?4)`,
  )
    .bind(
      version,
      JSON.stringify(manifest),
      JSON.stringify({ [file.path]: file }),
      Math.floor(now.getTime() / 1000),
    )
    .run();

  return { version, manifest, files: { [file.path]: file } };
}

export async function getLatestSnapshot(
  env: Cloudflare.Env,
): Promise<{ manifest: string } | null> {
  const row = await env.DB.prepare(
    'SELECT manifest_json FROM snapshots ORDER BY created_at DESC, version DESC LIMIT 1',
  ).first<{ manifest_json: string }>();
  return row ? { manifest: row.manifest_json } : null;
}

export async function getSnapshotFile(
  env: Cloudflare.Env,
  version: string,
  path: string,
): Promise<string | null> {
  if (!/^\d{4}\.\d{2}\.\d{2}\.\d{1,4}$/.test(version) || path !== SNAPSHOT_PACK) {
    return null;
  }
  const row = await env.DB.prepare(
    'SELECT files_json FROM snapshots WHERE version = ?1',
  )
    .bind(version)
    .first<{ files_json: string }>();
  if (!row) return null;
  const files = JSON.parse(row.files_json) as Record<string, SnapshotFile>;
  return files[path]?.body ?? null;
}
