import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { getDb, type DbOrTx } from './db/client';
import { maintainerWhitelist, maintainerWhitelistAudit } from './db/schema';
import { collateC, compareText, stripNul } from './lib/sql';

/**
 * 推荐白名单（金刚防护罩）的维护者通道。
 *
 * 与 maintainer-blocklist 同构但语义相反：维护者在 GitHub 公开维护
 * community/lists/whitelist.yaml（PR 提交、维护者审核合并），发布脚本
 * （scripts/publish-community-whitelist.sh）把文件内容同步进本表。
 * 白名单账号一票否决：任何检测来源都不得标注或拉黑它们。
 */
export interface MaintainerWhitelistEntry {
  handle: string;
  x_user_id: string | null;
  name: string | null;
  avatar_url: string | null;
  note: string;
  active: boolean;
  created_at: number;
  updated_at: number;
}

export type WhitelistEntryValidation =
  | {
      ok: true;
      value: {
        handle: string;
        xUserId: string | null;
        name: string | null;
        avatarUrl: string | null;
        note: string;
      };
    }
  | { ok: false; error: string };

const HANDLE_RE = /^@?([A-Za-z0-9_]{1,15})$/;
const USER_ID_RE = /^\d{1,20}$/;
const NAME_RE = /^.{1,40}$/;
const AVATAR_URL_RE = /^https:\/\/pbs\.twimg\.com\/profile_images\/[\w\-./]+$/;

/** 入册条目校验：handle 必须合法，note 是公开问责说明（与黑名单同样的 4-240 字口径）。 */
export function validateWhitelistEntry(raw: unknown): WhitelistEntryValidation {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: 'entry_must_be_object' };
  }
  const input = raw as Record<string, unknown>;
  if (typeof input.handle !== 'string' || !HANDLE_RE.test(input.handle)) {
    return { ok: false, error: 'invalid_handle' };
  }
  const xUserId =
    typeof input.x_user_id === 'string' && USER_ID_RE.test(input.x_user_id)
      ? input.x_user_id
      : input.x_user_id === undefined || input.x_user_id === null
        ? null
        : undefined;
  if (xUserId === undefined) {
    return { ok: false, error: 'invalid_x_user_id' };
  }
  const note = typeof input.note === 'string' ? stripNul(input.note).trim() : '';
  if (note.length < 4 || note.length > 240) {
    return { ok: false, error: 'invalid_note' };
  }
  const name =
    input.name === undefined || input.name === null
      ? null
      : typeof input.name === 'string' && NAME_RE.test(input.name)
        ? input.name
        : undefined;
  if (name === undefined) {
    return { ok: false, error: 'invalid_name' };
  }
  const avatarUrl =
    input.avatar_url === undefined || input.avatar_url === null
      ? null
      : typeof input.avatar_url === 'string' && AVATAR_URL_RE.test(input.avatar_url)
        ? input.avatar_url
        : undefined;
  if (avatarUrl === undefined) {
    return { ok: false, error: 'invalid_avatar_url' };
  }
  return {
    ok: true,
    value: { handle: input.handle.toLowerCase(), xUserId, name, avatarUrl, note },
  };
}

export async function listMaintainerWhitelist(
  env: Cloudflare.Env,
  includeInactive = false,
): Promise<MaintainerWhitelistEntry[]> {
  const rows = await getDb(env)
    .select({
      handle: maintainerWhitelist.handle,
      x_user_id: maintainerWhitelist.xUserId,
      name: maintainerWhitelist.name,
      avatar_url: maintainerWhitelist.avatarUrl,
      note: maintainerWhitelist.note,
      active: maintainerWhitelist.active,
      created_at: maintainerWhitelist.createdAt,
      updated_at: maintainerWhitelist.updatedAt,
    })
    .from(maintainerWhitelist)
    .where(includeInactive ? undefined : eq(maintainerWhitelist.active, 1))
    .orderBy(
      desc(maintainerWhitelist.active),
      desc(maintainerWhitelist.updatedAt),
      asc(collateC(maintainerWhitelist.handle)),
    );
  return rows.map((row) => ({ ...row, active: row.active === 1 }));
}

export interface MaintainerWhitelistUpsertRow {
  handle: string;
  xUserId: string | null;
  name: string | null;
  avatarUrl: string | null;
  note: string;
}

/**
 * 发布脚本批量写入用：upsert 并置为生效；已有行的 x_user_id / name / avatar_url
 * 在新值为空时保留旧值。同一 handle 重复时后者生效。
 */
export async function upsertMaintainerWhitelist(
  db: DbOrTx,
  rows: MaintainerWhitelistUpsertRow[],
  time: number,
): Promise<void> {
  // 按主键排序：并发批量 UPSERT 以相同顺序锁行，避免死锁
  const unique = [...new Map(rows.map((row) => [row.handle, row] as const)).values()].sort((a, b) =>
    compareText(a.handle, b.handle),
  );
  if (unique.length === 0) return;
  await db
    .insert(maintainerWhitelist)
    .values(
      unique.map((row) => ({
        handle: row.handle,
        xUserId: row.xUserId,
        name: row.name,
        avatarUrl: row.avatarUrl,
        note: row.note,
        active: 1,
        createdAt: time,
        updatedAt: time,
      })),
    )
    .onConflictDoUpdate({
      target: maintainerWhitelist.handle,
      set: {
        xUserId: sql`coalesce(excluded.x_user_id, ${maintainerWhitelist.xUserId})`,
        name: sql`coalesce(excluded.name, ${maintainerWhitelist.name})`,
        avatarUrl: sql`coalesce(excluded.avatar_url, ${maintainerWhitelist.avatarUrl})`,
        note: sql`excluded.note`,
        active: 1,
        updatedAt: sql`excluded.updated_at`,
      },
    });
}

export async function insertMaintainerWhitelistAudits(
  db: DbOrTx,
  rows: Array<{ action: 'add' | 'remove' | 'update'; handle: string; note: string | null }>,
  time: number,
): Promise<void> {
  if (rows.length === 0) return;
  await db
    .insert(maintainerWhitelistAudit)
    .values(rows.map((row) => ({ ...row, createdAt: time })));
}

/** 停用仍生效的条目，返回实际被停用的 handle。 */
export async function deactivateMaintainerWhitelist(
  db: DbOrTx,
  handles: string[],
  time: number,
): Promise<string[]> {
  if (handles.length === 0) return [];
  const rows = await db
    .update(maintainerWhitelist)
    .set({ active: 0, updatedAt: time })
    .where(and(inArray(maintainerWhitelist.handle, handles), eq(maintainerWhitelist.active, 1)))
    .returning({ handle: maintainerWhitelist.handle });
  return rows.map((row) => row.handle);
}
