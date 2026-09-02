import { REPORT_REASONS, validateReport, type ReportReason } from './lib/validate';

export interface MaintainerBlocklistEntry {
  handle: string;
  x_user_id: string | null;
  category: ReportReason;
  note: string;
  evidence_post_id: string | null;
  active: boolean;
  created_at: number;
  updated_at: number;
}

export type MaintainerEntryValidation =
  | {
      ok: true;
      value: {
        handle: string;
        xUserId: string | null;
        category: ReportReason;
        note: string;
        evidencePostId: string | null;
      };
    }
  | { ok: false; error: string };

export function validateMaintainerEntry(raw: unknown): MaintainerEntryValidation {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: 'entry_must_be_object' };
  }
  const input = raw as Record<string, unknown>;
  const report = validateReport({
    handle: input.handle,
    x_user_id: input.x_user_id,
    reason: input.category,
    evidence_post_id: input.evidence_post_id,
  });
  if (!report.ok) return report;

  const note = typeof input.note === 'string' ? input.note.trim() : '';
  if (note.length < 4 || note.length > 240) {
    return { ok: false, error: 'invalid_note' };
  }
  return {
    ok: true,
    value: {
      handle: report.report.handle,
      xUserId: report.report.xUserId,
      category: report.report.reason,
      note,
      evidencePostId: report.report.evidencePostId,
    },
  };
}

export async function listMaintainerEntries(
  env: Cloudflare.Env,
  includeInactive = false,
): Promise<MaintainerBlocklistEntry[]> {
  const result = await env.DB.prepare(
    `SELECT handle, x_user_id, category, reason AS note, evidence_post_id,
            active, created_at, updated_at
     FROM maintainer_blocklist
     ${includeInactive ? '' : 'WHERE active = 1'}
     ORDER BY active DESC, updated_at DESC, handle ASC`,
  ).all<{
    handle: string;
    x_user_id: string | null;
    category: ReportReason;
    note: string;
    evidence_post_id: string | null;
    active: number;
    created_at: number;
    updated_at: number;
  }>();
  return result.results.map((row) => ({ ...row, active: row.active === 1 }));
}

export async function upsertMaintainerEntry(
  env: Cloudflare.Env,
  raw: unknown,
): Promise<
  | { ok: true; action: 'add' | 'update'; entry: MaintainerBlocklistEntry }
  | { ok: false; error: string }
> {
  const validated = validateMaintainerEntry(raw);
  if (!validated.ok) return validated;
  const input = validated.value;
  const previous = await env.DB.prepare('SELECT handle FROM maintainer_blocklist WHERE handle = ?1')
    .bind(input.handle)
    .first<{ handle: string }>();
  const action = previous ? 'update' : 'add';
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO maintainer_blocklist
       (handle, x_user_id, category, reason, evidence_post_id, active, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?6)
     ON CONFLICT(handle) DO UPDATE SET
       x_user_id = COALESCE(excluded.x_user_id, maintainer_blocklist.x_user_id),
       category = excluded.category,
       reason = excluded.reason,
       evidence_post_id = excluded.evidence_post_id,
       active = 1,
       updated_at = excluded.updated_at`,
  )
    .bind(input.handle, input.xUserId, input.category, input.note, input.evidencePostId, now)
    .run();
  await env.DB.prepare(
    `INSERT INTO maintainer_blocklist_audit
       (action, handle, category, reason, evidence_post_id, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  )
    .bind(action, input.handle, input.category, input.note, input.evidencePostId, now)
    .run();
  const entry = (await listMaintainerEntries(env, true)).find(
    (candidate) => candidate.handle === input.handle,
  );
  if (!entry) return { ok: false, error: 'write_failed' };
  return { ok: true, action, entry };
}

export async function deactivateMaintainerEntry(
  env: Cloudflare.Env,
  handle: string,
): Promise<{ ok: true; changed: boolean } | { ok: false; error: string }> {
  const normalized = handle.trim().replace(/^@+/, '').toLowerCase();
  if (!/^[a-z0-9_]{1,15}$/.test(normalized)) {
    return { ok: false, error: 'invalid_handle' };
  }
  const current = await env.DB.prepare(
    `SELECT category, reason, evidence_post_id, active
     FROM maintainer_blocklist WHERE handle = ?1`,
  )
    .bind(normalized)
    .first<{
      category: string;
      reason: string;
      evidence_post_id: string | null;
      active: number;
    }>();
  if (!current || current.active !== 1) return { ok: true, changed: false };
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    'UPDATE maintainer_blocklist SET active = 0, updated_at = ?2 WHERE handle = ?1',
  )
    .bind(normalized, now)
    .run();
  await env.DB.prepare(
    `INSERT INTO maintainer_blocklist_audit
       (action, handle, category, reason, evidence_post_id, created_at)
     VALUES ('remove', ?1, ?2, ?3, ?4, ?5)`,
  )
    .bind(normalized, current.category, current.reason, current.evidence_post_id, now)
    .run();
  return { ok: true, changed: true };
}

export { REPORT_REASONS as MAINTAINER_CATEGORIES };
