import {
  MAINTAINER_AUDIT_INSERT_SQL,
  MAINTAINER_DEACTIVATE_SQL,
  MAINTAINER_UPSERT_SQL,
  validateMaintainerEntry,
} from './maintainer-blocklist';
import { generateSnapshot } from './snapshot';

export interface AccountDraft {
  handle: string;
  x_user_id: string | null;
  category: string;
  note: string;
  evidence_post_id: string | null;
  active: boolean;
  created_at: number;
  updated_at: number;
}

const now = () => Math.floor(Date.now() / 1000);

// D1 单条查询最多 100 个绑定参数，IN 分句与 batch 分片都按 100 切。
const D1_CHUNK = 100;

const DRAFT_COLUMNS = 'handle, x_user_id, category, note, evidence_post_id, active, created_at, updated_at';

function normalizeHandle(raw: string): string | null {
  const handle = raw.trim().replace(/^@+/, '').toLowerCase();
  return /^[a-z0-9_]{1,15}$/.test(handle) ? handle : null;
}

function asDraft(row: Omit<AccountDraft, 'active'> & { active: number }): AccountDraft {
  return { ...row, active: row.active === 1 };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

export interface ListDraftsOptions {
  /** 按账号或备注子串过滤（LIKE，忽略大小写）。 */
  q?: string;
  /** undefined = 不设上限（发布同步需要全量）；路由层固定传值。 */
  limit?: number | null;
}

export async function listAdminAccountDrafts(
  env: Cloudflare.Env,
  options: ListDraftsOptions = {},
): Promise<AccountDraft[]> {
  const q = options.q?.trim();
  const limit =
    typeof options.limit === 'number'
      ? `LIMIT ${Math.min(Math.max(Math.trunc(options.limit), 1), 500)}`
      : '';
  const sql = `SELECT ${DRAFT_COLUMNS}
     FROM admin_account_drafts
     ${q ? "WHERE handle LIKE ?1 ESCAPE '\\' OR note LIKE ?1 ESCAPE '\\'" : ''}
     ORDER BY active DESC, updated_at DESC, handle ASC
     ${limit}`;
  const result = await (q
    ? env.DB.prepare(sql).bind(`%${escapeLike(q)}%`)
    : env.DB.prepare(sql)
  ).all<Omit<AccountDraft, 'active'> & { active: number }>();
  return result.results.map(asDraft);
}

export async function saveAdminAccountDraft(
  env: Cloudflare.Env,
  raw: unknown,
): Promise<{ ok: true; action: 'add' | 'update'; entry: AccountDraft } | { ok: false; error: string }> {
  const validated = validateMaintainerEntry(raw);
  if (!validated.ok) return validated;
  const input = validated.value;
  // 主键探测一次即可区分 add/update；写入后用 RETURNING 直接拿回行，
  // 不再「写完整表再查一遍」。
  const prior = await env.DB.prepare('SELECT 1 AS present FROM admin_account_drafts WHERE handle = ?1')
    .bind(input.handle)
    .first<{ present: number }>();
  const time = now();
  const row = await env.DB.prepare(
    `INSERT INTO admin_account_drafts
       (${DRAFT_COLUMNS})
     VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?6)
     ON CONFLICT(handle) DO UPDATE SET
       x_user_id = COALESCE(excluded.x_user_id, admin_account_drafts.x_user_id),
       category = excluded.category,
       note = excluded.note,
       evidence_post_id = excluded.evidence_post_id,
       active = 1,
       updated_at = excluded.updated_at
     RETURNING ${DRAFT_COLUMNS}`,
  )
    .bind(input.handle, input.xUserId, input.category, input.note, input.evidencePostId, time)
    .first<Omit<AccountDraft, 'active'> & { active: number }>();
  if (!row) return { ok: false, error: 'write_failed' };
  return { ok: true, action: prior ? 'update' : 'add', entry: asDraft(row) };
}

export async function deactivateAdminAccountDraft(
  env: Cloudflare.Env,
  rawHandle: string,
): Promise<{ ok: true; changed: boolean } | { ok: false; error: string }> {
  const handle = normalizeHandle(rawHandle);
  if (!handle) return { ok: false, error: 'invalid_handle' };
  const result = await env.DB.prepare(
    'UPDATE admin_account_drafts SET active = 0, updated_at = ?2 WHERE handle = ?1 AND active = 1',
  )
    .bind(handle, now())
    .run();
  return { ok: true, changed: result.meta.changes > 0 };
}

function archiveKey(): string {
  return `admin-releases/accounts/${Date.now()}-${crypto.randomUUID()}.json`;
}

async function recordRelease(
  env: Cloudflare.Env,
  kind: 'accounts' | 'keywords',
  version: string,
  actorEmail: string,
  detail: Record<string, unknown>,
): Promise<number> {
  const result = await env.DB.prepare(
    `INSERT INTO admin_releases (kind, version, actor_email, detail, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5)`,
  )
    .bind(kind, version, actorEmail, JSON.stringify(detail), now())
    .run();
  return Number(result.meta.last_row_id);
}

export async function recordAdminAudit(
  env: Cloudflare.Env,
  actorEmail: string,
  action: string,
  targetType: string,
  targetId: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO admin_audit_log (actor_email, action, target_type, target_id, detail, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  )
    .bind(actorEmail, action, targetType, targetId, JSON.stringify(detail), now())
    .run();
}

/** 将维护者草稿同步到公开名单，且只在此处生成新的公开快照。 */
export async function publishAdminAccountDrafts(
  env: Cloudflare.Env,
  actorEmail: string,
): Promise<{ release_id: number; snapshot_version: string; active_entries: number }> {
  if (!env.KEYWORD_PACKS) throw new Error('release_archive_unavailable');
  const drafts = await listAdminAccountDrafts(env);
  const archive = JSON.stringify({ schema_version: 1, drafts }) + '\n';
  const key = archiveKey();
  await env.KEYWORD_PACKS.put(key, archive);

  const activeDrafts = drafts.filter((draft) => draft.active);
  const activeHandles = new Set(activeDrafts.map((draft) => draft.handle));
  const time = now();

  // 一次查出已发布行，diff 出需要停用的账号；不再逐行 await。
  const publishedRows = await env.DB.prepare(
    'SELECT handle, category, reason, evidence_post_id FROM maintainer_blocklist WHERE active = 1',
  ).all<{ handle: string; category: string; reason: string; evidence_post_id: string | null }>();

  // 已存在的账号决定审计动作（add/update）；按 D1 参数上限分批探测。
  const existingHandles = new Set<string>();
  const draftHandles = activeDrafts.map((draft) => draft.handle);
  for (let index = 0; index < draftHandles.length; index += D1_CHUNK) {
    const chunk = draftHandles.slice(index, index + D1_CHUNK);
    const placeholders = chunk.map((_, position) => `?${position + 1}`).join(',');
    const rows = await env.DB.prepare(
      `SELECT handle FROM maintainer_blocklist WHERE handle IN (${placeholders})`,
    )
      .bind(...chunk)
      .all<{ handle: string }>();
    for (const row of rows.results) existingHandles.add(row.handle);
  }

  const statements: D1PreparedStatement[] = [];
  for (const draft of activeDrafts) {
    statements.push(
      env.DB.prepare(MAINTAINER_UPSERT_SQL).bind(
        draft.handle,
        draft.x_user_id,
        draft.category,
        draft.note,
        draft.evidence_post_id,
        time,
      ),
    );
    statements.push(
      env.DB.prepare(MAINTAINER_AUDIT_INSERT_SQL).bind(
        existingHandles.has(draft.handle) ? 'update' : 'add',
        draft.handle,
        draft.category,
        draft.note,
        draft.evidence_post_id,
        time,
      ),
    );
  }
  for (const published of publishedRows.results) {
    if (activeHandles.has(published.handle)) continue;
    statements.push(
      env.DB.prepare(MAINTAINER_DEACTIVATE_SQL).bind(published.handle, time),
    );
    statements.push(
      env.DB.prepare(MAINTAINER_AUDIT_INSERT_SQL).bind(
        'remove',
        published.handle,
        published.category,
        published.reason,
        published.evidence_post_id,
        time,
      ),
    );
  }
  for (let index = 0; index < statements.length; index += D1_CHUNK) {
    await env.DB.batch(statements.slice(index, index + D1_CHUNK));
  }

  const snapshot = await generateSnapshot(env);
  const releaseId = await recordRelease(env, 'accounts', snapshot.version, actorEmail, {
    archive_key: key,
    active_entries: activeDrafts.length,
  });
  await recordAdminAudit(env, actorEmail, 'publish', 'accounts', snapshot.version, {
    release_id: releaseId,
    active_entries: activeDrafts.length,
  });
  return { release_id: releaseId, snapshot_version: snapshot.version, active_entries: activeDrafts.length };
}

export interface AdminRelease {
  id: number;
  kind: 'accounts' | 'keywords';
  version: string;
  actor_email: string;
  detail: Record<string, unknown>;
  created_at: number;
}

function parseReleaseDetail(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Old / malformed audit rows must not make the release page unavailable.
  }
  return {};
}

const RELEASE_COLUMNS = 'id, kind, version, actor_email, detail, created_at';

type ReleaseRow = Omit<AdminRelease, 'detail' | 'kind'> & {
  kind: 'accounts' | 'keywords';
  detail: string;
};

function toRelease(row: ReleaseRow): AdminRelease {
  return { ...row, detail: parseReleaseDetail(row.detail) };
}

export async function listAdminReleases(env: Cloudflare.Env): Promise<AdminRelease[]> {
  const result = await env.DB.prepare(
    `SELECT ${RELEASE_COLUMNS}
     FROM admin_releases
     ORDER BY created_at DESC, id DESC
     LIMIT 100`,
  ).all<ReleaseRow>();
  return result.results.map(toRelease);
}

export async function getAdminRelease(env: Cloudflare.Env, id: number): Promise<AdminRelease | null> {
  const row = await env.DB.prepare(`SELECT ${RELEASE_COLUMNS} FROM admin_releases WHERE id = ?1`)
    .bind(id)
    .first<ReleaseRow>();
  return row ? toRelease(row) : null;
}

export async function rollbackAdminAccountRelease(
  env: Cloudflare.Env,
  releaseId: number,
  actorEmail: string,
): Promise<{ rollback_of: number; snapshot_version: string }> {
  if (!Number.isInteger(releaseId) || releaseId <= 0 || !env.KEYWORD_PACKS) {
    throw new Error('invalid_release');
  }
  const release = await getAdminRelease(env, releaseId);
  if (!release || release.kind !== 'accounts') throw new Error('release_not_found');
  const key = typeof release.detail.archive_key === 'string' ? release.detail.archive_key : '';
  const object = key ? await env.KEYWORD_PACKS.get(key) : null;
  if (!object) throw new Error('release_archive_missing');
  const payload = JSON.parse(await object.text()) as { drafts?: unknown };
  if (!Array.isArray(payload.drafts)) throw new Error('release_archive_invalid');

  const restored = payload.drafts
    .filter((item): item is AccountDraft => typeof item === 'object' && item !== null && typeof (item as AccountDraft).handle === 'string')
    .map((item) => ({ ...item, handle: normalizeHandle(item.handle) }))
    .filter((item): item is Omit<AccountDraft, 'handle'> & { handle: string } => Boolean(item.handle));

  await env.DB.prepare('DELETE FROM admin_account_drafts').run();
  const time = now();
  for (let index = 0; index < restored.length; index += D1_CHUNK) {
    await env.DB.batch(
      restored.slice(index, index + D1_CHUNK).map((draft) =>
        env.DB.prepare(
          `INSERT INTO admin_account_drafts
             (${DRAFT_COLUMNS})
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)`,
        ).bind(
          draft.handle,
          draft.x_user_id ?? null,
          draft.category,
          draft.note,
          draft.evidence_post_id ?? null,
          draft.active ? 1 : 0,
          time,
        ),
      ),
    );
  }
  const published = await publishAdminAccountDrafts(env, actorEmail);
  await recordAdminAudit(env, actorEmail, 'rollback', 'accounts', String(releaseId), {
    snapshot_version: published.snapshot_version,
  });
  return { rollback_of: releaseId, snapshot_version: published.snapshot_version };
}

export { recordRelease };
