import {
  deactivateMaintainerEntry,
  listMaintainerEntries,
  upsertMaintainerEntry,
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

function normalizeHandle(raw: string): string | null {
  const handle = raw.trim().replace(/^@+/, '').toLowerCase();
  return /^[a-z0-9_]{1,15}$/.test(handle) ? handle : null;
}

function asDraft(row: Omit<AccountDraft, 'active'> & { active: number }): AccountDraft {
  return { ...row, active: row.active === 1 };
}

/**
 * 迁移前已经公开的人工条目，第一次打开后台时作为当前草稿的初始值。
 * 后续草稿（包括撤销）拥有优先级，因而不会被这条兼容同步重新覆盖。
 */
export async function ensureAccountDrafts(env: Cloudflare.Env): Promise<void> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO admin_account_drafts
       (handle, x_user_id, category, note, evidence_post_id, active, created_at, updated_at)
     SELECT handle, x_user_id, category, reason, evidence_post_id, active, created_at, updated_at
     FROM maintainer_blocklist`,
  ).run();
}

export async function listAdminAccountDrafts(env: Cloudflare.Env): Promise<AccountDraft[]> {
  await ensureAccountDrafts(env);
  const result = await env.DB.prepare(
    `SELECT handle, x_user_id, category, note, evidence_post_id, active, created_at, updated_at
     FROM admin_account_drafts
     ORDER BY active DESC, updated_at DESC, handle ASC`,
  ).all<Omit<AccountDraft, 'active'> & { active: number }>();
  return result.results.map(asDraft);
}

export async function saveAdminAccountDraft(
  env: Cloudflare.Env,
  raw: unknown,
): Promise<{ ok: true; action: 'add' | 'update'; entry: AccountDraft } | { ok: false; error: string }> {
  const validated = validateMaintainerEntry(raw);
  if (!validated.ok) return validated;
  await ensureAccountDrafts(env);
  const input = validated.value;
  const prior = await env.DB.prepare('SELECT handle FROM admin_account_drafts WHERE handle = ?1')
    .bind(input.handle)
    .first<{ handle: string }>();
  const time = now();
  await env.DB.prepare(
    `INSERT INTO admin_account_drafts
       (handle, x_user_id, category, note, evidence_post_id, active, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?6)
     ON CONFLICT(handle) DO UPDATE SET
       x_user_id = COALESCE(excluded.x_user_id, admin_account_drafts.x_user_id),
       category = excluded.category,
       note = excluded.note,
       evidence_post_id = excluded.evidence_post_id,
       active = 1,
       updated_at = excluded.updated_at`,
  )
    .bind(input.handle, input.xUserId, input.category, input.note, input.evidencePostId, time)
    .run();
  const entry = (await listAdminAccountDrafts(env)).find((item) => item.handle === input.handle);
  return entry
    ? { ok: true, action: prior ? 'update' : 'add', entry }
    : { ok: false, error: 'write_failed' };
}

export async function deactivateAdminAccountDraft(
  env: Cloudflare.Env,
  rawHandle: string,
): Promise<{ ok: true; changed: boolean } | { ok: false; error: string }> {
  const handle = normalizeHandle(rawHandle);
  if (!handle) return { ok: false, error: 'invalid_handle' };
  await ensureAccountDrafts(env);
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

  const activeDrafts = new Map(drafts.filter((draft) => draft.active).map((draft) => [draft.handle, draft]));
  for (const draft of activeDrafts.values()) {
    const saved = await upsertMaintainerEntry(env, {
      handle: draft.handle,
      x_user_id: draft.x_user_id,
      category: draft.category,
      note: draft.note,
      evidence_post_id: draft.evidence_post_id,
    });
    if (!saved.ok) throw new Error(saved.error);
  }

  for (const published of await listMaintainerEntries(env, true)) {
    if (published.active && !activeDrafts.has(published.handle)) {
      const result = await deactivateMaintainerEntry(env, published.handle);
      if (!result.ok) throw new Error(result.error);
    }
  }

  const snapshot = await generateSnapshot(env);
  const releaseId = await recordRelease(env, 'accounts', snapshot.version, actorEmail, {
    archive_key: key,
    active_entries: activeDrafts.size,
  });
  await recordAdminAudit(env, actorEmail, 'publish', 'accounts', snapshot.version, {
    release_id: releaseId,
    active_entries: activeDrafts.size,
  });
  return { release_id: releaseId, snapshot_version: snapshot.version, active_entries: activeDrafts.size };
}

export interface AdminRelease {
  id: number;
  kind: 'accounts' | 'keywords';
  version: string;
  actor_email: string;
  detail: Record<string, unknown>;
  created_at: number;
}

export async function listAdminReleases(env: Cloudflare.Env): Promise<AdminRelease[]> {
  const result = await env.DB.prepare(
    `SELECT id, kind, version, actor_email, detail, created_at
     FROM admin_releases
     ORDER BY created_at DESC, id DESC
     LIMIT 100`,
  ).all<Omit<AdminRelease, 'detail' | 'kind'> & { kind: 'accounts' | 'keywords'; detail: string }>();
  return result.results.map((release) => {
    let detail: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(release.detail) as unknown;
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        detail = parsed as Record<string, unknown>;
      }
    } catch {
      // Old / malformed audit rows must not make the release page unavailable.
    }
    return { ...release, detail };
  });
}

export async function rollbackAdminAccountRelease(
  env: Cloudflare.Env,
  releaseId: number,
  actorEmail: string,
): Promise<{ rollback_of: number; snapshot_version: string }> {
  if (!Number.isInteger(releaseId) || releaseId <= 0 || !env.KEYWORD_PACKS) {
    throw new Error('invalid_release');
  }
  const release = await env.DB.prepare(
    `SELECT detail FROM admin_releases WHERE id = ?1 AND kind = 'accounts'`,
  )
    .bind(releaseId)
    .first<{ detail: string }>();
  if (!release) throw new Error('release_not_found');
  let detail: { archive_key?: unknown };
  try {
    detail = JSON.parse(release.detail) as { archive_key?: unknown };
  } catch {
    throw new Error('release_archive_invalid');
  }
  const key = typeof detail.archive_key === 'string' ? detail.archive_key : '';
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
  for (let index = 0; index < restored.length; index += 100) {
    await env.DB.batch(
      restored.slice(index, index + 100).map((draft) =>
        env.DB.prepare(
          `INSERT INTO admin_account_drafts
             (handle, x_user_id, category, note, evidence_post_id, active, created_at, updated_at)
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
