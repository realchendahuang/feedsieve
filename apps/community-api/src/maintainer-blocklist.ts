import { asc, desc, eq, inArray, and, sql } from 'drizzle-orm';
import { getDb, type DbOrTx } from './db/client';
import { maintainerBlocklist, maintainerBlocklistAudit } from './db/schema';
import { collateC, compareText, stripNul } from './lib/sql';
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

  const note = typeof input.note === 'string' ? stripNul(input.note).trim() : '';
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
  const rows = await getDb(env)
    .select({
      handle: maintainerBlocklist.handle,
      x_user_id: maintainerBlocklist.xUserId,
      category: maintainerBlocklist.category,
      note: maintainerBlocklist.reason,
      evidence_post_id: maintainerBlocklist.evidencePostId,
      active: maintainerBlocklist.active,
      created_at: maintainerBlocklist.createdAt,
      updated_at: maintainerBlocklist.updatedAt,
    })
    .from(maintainerBlocklist)
    .where(includeInactive ? undefined : eq(maintainerBlocklist.active, 1))
    .orderBy(
      desc(maintainerBlocklist.active),
      desc(maintainerBlocklist.updatedAt),
      asc(collateC(maintainerBlocklist.handle)),
    );
  return rows.map((row) => ({
    ...row,
    category: row.category as ReportReason,
    active: row.active === 1,
  }));
}

// 发布名单时在同一个事务里批量写入；下面三个函数同时是发布流程与语义测试共用的写入入口。
export interface MaintainerUpsertRow {
  handle: string;
  xUserId: string | null;
  category: string;
  note: string;
  evidencePostId: string | null;
}

/** 批量 upsert 并置为生效；已有行的 x_user_id 在新值为空时保留旧值。同一 handle 重复时后者生效。 */
export async function upsertMaintainerEntries(
  db: DbOrTx,
  rows: MaintainerUpsertRow[],
  time: number,
): Promise<void> {
  // 按主键排序：并发批量 UPSERT 以相同顺序锁行，避免死锁
  const unique = [...new Map(rows.map((row) => [row.handle, row] as const)).values()].sort((a, b) =>
    compareText(a.handle, b.handle),
  );
  if (unique.length === 0) return;
  await db
    .insert(maintainerBlocklist)
    .values(
      unique.map((row) => ({
        handle: row.handle,
        xUserId: row.xUserId,
        category: row.category,
        reason: row.note,
        evidencePostId: row.evidencePostId,
        active: 1,
        createdAt: time,
        updatedAt: time,
      })),
    )
    .onConflictDoUpdate({
      target: maintainerBlocklist.handle,
      set: {
        xUserId: sql`coalesce(excluded.x_user_id, ${maintainerBlocklist.xUserId})`,
        category: sql`excluded.category`,
        reason: sql`excluded.reason`,
        evidencePostId: sql`excluded.evidence_post_id`,
        active: 1,
        updatedAt: sql`excluded.updated_at`,
      },
    });
}

export interface MaintainerAuditRow {
  action: 'add' | 'remove' | 'update';
  handle: string;
  category: string | null;
  reason: string | null;
  evidencePostId: string | null;
}

export async function insertMaintainerAudits(
  db: DbOrTx,
  rows: MaintainerAuditRow[],
  time: number,
): Promise<void> {
  if (rows.length === 0) return;
  await db
    .insert(maintainerBlocklistAudit)
    .values(rows.map((row) => ({ ...row, createdAt: time })));
}

/** 停用仍生效的条目，返回实际被停用的 handle。 */
export async function deactivateMaintainerEntries(
  db: DbOrTx,
  handles: string[],
  time: number,
): Promise<string[]> {
  if (handles.length === 0) return [];
  const rows = await db
    .update(maintainerBlocklist)
    .set({ active: 0, updatedAt: time })
    .where(and(inArray(maintainerBlocklist.handle, handles), eq(maintainerBlocklist.active, 1)))
    .returning({ handle: maintainerBlocklist.handle });
  return rows.map((row) => row.handle);
}

export { REPORT_REASONS as MAINTAINER_CATEGORIES };
