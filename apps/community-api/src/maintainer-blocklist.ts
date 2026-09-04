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

// 发布名单时用 DB.batch 批量写入；单条 upsert/deactivate 的旧函数已删除，
// SQL 抽成常量保证 batch 与语义测试走同一份语句。
export const MAINTAINER_UPSERT_SQL = `
  INSERT INTO maintainer_blocklist
    (handle, x_user_id, category, reason, evidence_post_id, active, created_at, updated_at)
  VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?6)
  ON CONFLICT(handle) DO UPDATE SET
    x_user_id = COALESCE(excluded.x_user_id, maintainer_blocklist.x_user_id),
    category = excluded.category,
    reason = excluded.reason,
    evidence_post_id = excluded.evidence_post_id,
    active = 1,
    updated_at = excluded.updated_at`;

export const MAINTAINER_AUDIT_INSERT_SQL = `
  INSERT INTO maintainer_blocklist_audit
    (action, handle, category, reason, evidence_post_id, created_at)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6)`;

export const MAINTAINER_DEACTIVATE_SQL =
  'UPDATE maintainer_blocklist SET active = 0, updated_at = ?2 WHERE handle = ?1 AND active = 1';

export { REPORT_REASONS as MAINTAINER_CATEGORIES };
