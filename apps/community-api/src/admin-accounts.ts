import { and, asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { getDb } from './db/client';
import { adminAccountDrafts, adminAuditLog, adminReleases, maintainerBlocklist } from './db/schema';
import {
  deactivateMaintainerEntries,
  insertMaintainerAudits,
  upsertMaintainerEntries,
  validateMaintainerEntry,
  type MaintainerAuditRow,
} from './maintainer-blocklist';
import { generateSnapshot } from './snapshot';
import { collateC, escapeLike } from './lib/sql';

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

/** 批量写入、IN 探测的分片大小（单条语句参数上限 65535，远未触及，按 1000 切足够稳）。 */
const CHUNK = 1000;

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += CHUNK)
    out.push(items.slice(index, index + CHUNK));
  return out;
}

const DRAFT_SELECT = {
  handle: adminAccountDrafts.handle,
  x_user_id: adminAccountDrafts.xUserId,
  category: adminAccountDrafts.category,
  note: adminAccountDrafts.note,
  evidence_post_id: adminAccountDrafts.evidencePostId,
  active: adminAccountDrafts.active,
  created_at: adminAccountDrafts.createdAt,
  updated_at: adminAccountDrafts.updatedAt,
};

function normalizeHandle(raw: string): string | null {
  const handle = raw.trim().replace(/^@+/, '').toLowerCase();
  return /^[a-z0-9_]{1,15}$/.test(handle) ? handle : null;
}

function asDraft(row: Omit<AccountDraft, 'active'> & { active: number }): AccountDraft {
  return { ...row, active: row.active === 1 };
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
  const pattern = q ? `%${escapeLike(q)}%` : null;
  const query = getDb(env)
    .select(DRAFT_SELECT)
    .from(adminAccountDrafts)
    .where(
      pattern
        ? or(ilike(adminAccountDrafts.handle, pattern), ilike(adminAccountDrafts.note, pattern))
        : undefined,
    )
    .orderBy(
      desc(adminAccountDrafts.active),
      desc(adminAccountDrafts.updatedAt),
      asc(collateC(adminAccountDrafts.handle)),
    );
  const rows =
    typeof options.limit === 'number'
      ? await query.limit(Math.min(Math.max(Math.trunc(options.limit), 1), 500))
      : await query;
  return rows.map(asDraft);
}

export async function saveAdminAccountDraft(
  env: Cloudflare.Env,
  raw: unknown,
): Promise<
  { ok: true; action: 'add' | 'update'; entry: AccountDraft } | { ok: false; error: string }
> {
  const validated = validateMaintainerEntry(raw);
  if (!validated.ok) return validated;
  const input = validated.value;
  const db = getDb(env);
  // 主键探测一次即可区分 add/update；写入后用 RETURNING 直接拿回行，
  // 不再「写完整表再查一遍」。
  const [prior] = await db
    .select({ handle: adminAccountDrafts.handle })
    .from(adminAccountDrafts)
    .where(eq(adminAccountDrafts.handle, input.handle));
  const time = now();
  const [row] = await db
    .insert(adminAccountDrafts)
    .values({
      handle: input.handle,
      xUserId: input.xUserId,
      category: input.category,
      note: input.note,
      evidencePostId: input.evidencePostId,
      active: 1,
      createdAt: time,
      updatedAt: time,
    })
    .onConflictDoUpdate({
      target: adminAccountDrafts.handle,
      set: {
        xUserId: sql`coalesce(excluded.x_user_id, ${adminAccountDrafts.xUserId})`,
        category: sql`excluded.category`,
        note: sql`excluded.note`,
        evidencePostId: sql`excluded.evidence_post_id`,
        active: 1,
        updatedAt: sql`excluded.updated_at`,
      },
    })
    .returning(DRAFT_SELECT);
  if (!row) return { ok: false, error: 'write_failed' };
  return { ok: true, action: prior ? 'update' : 'add', entry: asDraft(row) };
}

export async function deactivateAdminAccountDraft(
  env: Cloudflare.Env,
  rawHandle: string,
): Promise<{ ok: true; changed: boolean } | { ok: false; error: string }> {
  const handle = normalizeHandle(rawHandle);
  if (!handle) return { ok: false, error: 'invalid_handle' };
  const changed = await getDb(env)
    .update(adminAccountDrafts)
    .set({ active: 0, updatedAt: now() })
    .where(and(eq(adminAccountDrafts.handle, handle), eq(adminAccountDrafts.active, 1)))
    .returning({ handle: adminAccountDrafts.handle });
  return { ok: true, changed: changed.length > 0 };
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
  const [row] = await getDb(env)
    .insert(adminReleases)
    .values({ kind, version, actorEmail, detail: JSON.stringify(detail), createdAt: now() })
    .returning({ id: adminReleases.id });
  return row!.id;
}

export async function recordAdminAudit(
  env: Cloudflare.Env,
  actorEmail: string,
  action: string,
  targetType: string,
  targetId: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  await getDb(env)
    .insert(adminAuditLog)
    .values({
      actorEmail,
      action,
      targetType,
      targetId,
      detail: JSON.stringify(detail),
      createdAt: now(),
    });
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

  const db = getDb(env);
  // 一次查出已发布行，diff 出需要停用的账号；不再逐行 await。
  const publishedRows = await db
    .select({
      handle: maintainerBlocklist.handle,
      category: maintainerBlocklist.category,
      reason: maintainerBlocklist.reason,
      evidencePostId: maintainerBlocklist.evidencePostId,
    })
    .from(maintainerBlocklist)
    .where(eq(maintainerBlocklist.active, 1));

  // 已存在的账号决定审计动作（add/update）。
  const existingHandles = new Set<string>();
  for (const chunk of chunks(activeDrafts.map((draft) => draft.handle))) {
    const rows = await db
      .select({ handle: maintainerBlocklist.handle })
      .from(maintainerBlocklist)
      .where(inArray(maintainerBlocklist.handle, chunk));
    for (const row of rows) existingHandles.add(row.handle);
  }

  const removed = publishedRows.filter((published) => !activeHandles.has(published.handle));
  // upsert / 审计 / 停用在同一个事务里提交，发布要么全部生效要么全不生效。
  await db.transaction(async (tx) => {
    for (const chunk of chunks(activeDrafts)) {
      await upsertMaintainerEntries(
        tx,
        chunk.map((draft) => ({
          handle: draft.handle,
          xUserId: draft.x_user_id,
          category: draft.category,
          note: draft.note,
          evidencePostId: draft.evidence_post_id,
        })),
        time,
      );
    }
    const audits: MaintainerAuditRow[] = [
      ...activeDrafts.map((draft): MaintainerAuditRow => ({
        action: existingHandles.has(draft.handle) ? 'update' : 'add',
        handle: draft.handle,
        category: draft.category,
        reason: draft.note,
        evidencePostId: draft.evidence_post_id,
      })),
      ...removed.map((published): MaintainerAuditRow => ({
        action: 'remove',
        handle: published.handle,
        category: published.category,
        reason: published.reason,
        evidencePostId: published.evidencePostId,
      })),
    ];
    for (const chunk of chunks(audits)) await insertMaintainerAudits(tx, chunk, time);
    for (const chunk of chunks(removed.map((published) => published.handle))) {
      await deactivateMaintainerEntries(tx, chunk, time);
    }
  });

  // 维护者显式发布走即时通道（bypassDailyOnce）：与社区投票的自动化高频变化不同，
  // 人工发布是低频、可审计的，不应被 day-once 守卫顺延到次日。
  const snapshot = await generateSnapshot(env, 0, { bypassDailyOnce: true });
  const releaseId = await recordRelease(env, 'accounts', snapshot.version, actorEmail, {
    archive_key: key,
    active_entries: activeDrafts.length,
  });
  await recordAdminAudit(env, actorEmail, 'publish', 'accounts', snapshot.version, {
    release_id: releaseId,
    active_entries: activeDrafts.length,
  });
  return {
    release_id: releaseId,
    snapshot_version: snapshot.version,
    active_entries: activeDrafts.length,
  };
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

const RELEASE_SELECT = {
  id: adminReleases.id,
  kind: adminReleases.kind,
  version: adminReleases.version,
  actor_email: adminReleases.actorEmail,
  detail: adminReleases.detail,
  created_at: adminReleases.createdAt,
};

type ReleaseRow = Omit<AdminRelease, 'detail'> & { detail: string };

function toRelease(row: ReleaseRow): AdminRelease {
  return { ...row, detail: parseReleaseDetail(row.detail) };
}

export async function listAdminReleases(env: Cloudflare.Env): Promise<AdminRelease[]> {
  const rows = await getDb(env)
    .select(RELEASE_SELECT)
    .from(adminReleases)
    .orderBy(desc(adminReleases.createdAt), desc(adminReleases.id))
    .limit(100);
  return rows.map(toRelease);
}

export async function getAdminRelease(
  env: Cloudflare.Env,
  id: number,
): Promise<AdminRelease | null> {
  const [row] = await getDb(env)
    .select(RELEASE_SELECT)
    .from(adminReleases)
    .where(eq(adminReleases.id, id));
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
    .filter(
      (item): item is AccountDraft =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as AccountDraft).handle === 'string',
    )
    .map((item) => ({ ...item, handle: normalizeHandle(item.handle) }))
    .filter((item): item is Omit<AccountDraft, 'handle'> & { handle: string } =>
      Boolean(item.handle),
    );

  const time = now();
  // 清空并回填草稿放在同一个事务里，中途失败不会留下半张表。
  await getDb(env).transaction(async (tx) => {
    await tx.delete(adminAccountDrafts);
    for (const chunk of chunks(restored)) {
      await tx.insert(adminAccountDrafts).values(
        chunk.map((draft) => ({
          handle: draft.handle,
          xUserId: draft.x_user_id ?? null,
          category: draft.category,
          note: draft.note,
          evidencePostId: draft.evidence_post_id ?? null,
          active: draft.active ? 1 : 0,
          createdAt: time,
          updatedAt: time,
        })),
      );
    }
  });
  const published = await publishAdminAccountDrafts(env, actorEmail);
  await recordAdminAudit(env, actorEmail, 'rollback', 'accounts', String(releaseId), {
    snapshot_version: published.snapshot_version,
  });
  return { rollback_of: releaseId, snapshot_version: published.snapshot_version };
}

export { recordRelease };
