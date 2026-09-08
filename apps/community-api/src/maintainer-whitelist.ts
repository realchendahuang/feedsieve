/**
 * 公开白名单（金刚防护罩）的维护者通道。
 *
 * 与 maintainer-blocklist 同构但语义相反：维护者在 GitHub 公开维护
 * community/lists/whitelist.yaml（PR 提交、维护者审核合并），发布脚本
 * （scripts/publish-community-whitelist.sh）把文件内容同步进本表。
 * 白名单账号一票否决：任何检测来源都不得标注或拉黑它们。
 */
export interface MaintainerWhitelistEntry {
  handle: string;
  x_user_id: string | null;
  note: string;
  active: boolean;
  created_at: number;
  updated_at: number;
}

export type WhitelistEntryValidation =
  | { ok: true; value: { handle: string; xUserId: string | null; note: string } }
  | { ok: false; error: string };

const HANDLE_RE = /^@?([A-Za-z0-9_]{1,15})$/;
const USER_ID_RE = /^\d{1,20}$/;

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
  const note = typeof input.note === 'string' ? input.note.trim() : '';
  if (note.length < 4 || note.length > 240) {
    return { ok: false, error: 'invalid_note' };
  }
  return {
    ok: true,
    value: { handle: input.handle.toLowerCase(), xUserId, note },
  };
}

export async function listMaintainerWhitelist(
  env: Cloudflare.Env,
  includeInactive = false,
): Promise<MaintainerWhitelistEntry[]> {
  const result = await env.DB.prepare(
    `SELECT handle, x_user_id, note, active, created_at, updated_at
     FROM maintainer_whitelist
     ${includeInactive ? '' : 'WHERE active = 1'}
     ORDER BY active DESC, updated_at DESC, handle ASC`,
  ).all<{
    handle: string;
    x_user_id: string | null;
    note: string;
    active: number;
    created_at: number;
    updated_at: number;
  }>();
  return result.results.map((row) => ({ ...row, active: row.active === 1 }));
}

/** 发布脚本批量写入用；SQL 抽成常量保证脚本与语义测试走同一份语句。 */
export const MAINTAINER_WHITELIST_UPSERT_SQL = `
  INSERT INTO maintainer_whitelist
    (handle, x_user_id, note, active, created_at, updated_at)
  VALUES (?1, ?2, ?3, 1, ?4, ?4)
  ON CONFLICT(handle) DO UPDATE SET
    x_user_id = COALESCE(excluded.x_user_id, maintainer_whitelist.x_user_id),
    note = excluded.note,
    active = 1,
    updated_at = excluded.updated_at`;

export const MAINTAINER_WHITELIST_AUDIT_INSERT_SQL = `
  INSERT INTO maintainer_whitelist_audit
    (action, handle, note, created_at)
  VALUES (?1, ?2, ?3, ?4)`;

export const MAINTAINER_WHITELIST_DEACTIVATE_SQL =
  'UPDATE maintainer_whitelist SET active = 0, updated_at = ?2 WHERE handle = ?1 AND active = 1';