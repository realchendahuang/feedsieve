/**
 * Agent 维护通道（/api/agent/*）：开发/自动化 Agent 使用的名单维护 API。
 *
 * 与人工后台（Cloudflare Access + 邮箱验证码）职责分离：
 * - 鉴权：请求头 `X-Agent-Key`，匹配部署配置 `AGENT_API_KEYS`（`id:secret` 逗号分隔），
 *   SHA-256 摘要后 timing-safe 比较，防侧信道。
 * - 范围：只能增改 / 撤销「维护者来源」条目并触发发布；不能伪造社区票、改票数、
 *   删除审计记录。发布复用 `publishAdminAccountDrafts`（即时通道 + R2 归档 + release 记录）。
 * - 审计：所有写操作记 `admin_audit_log`，actor 为 `agent:<id>`，与人工操作同表可查。
 */

import { listMaintainerEntries } from './maintainer-blocklist';
import {
  deactivateAdminAccountDraft,
  getAdminRelease,
  listAdminReleases,
  publishAdminAccountDrafts,
  recordAdminAudit,
  rollbackAdminAccountRelease,
  saveAdminAccountDraft,
} from './admin-accounts';
import {
  disableAdminKeyword,
  importKeywordCatalog,
  listAdminKeywords,
  publishAdminKeywords,
  rollbackAdminKeywordRelease,
  saveAdminKeywordPack,
  saveAdminKeywordRule,
} from './keyword-admin';
import { getDashboardMetrics } from './dashboard';
import { buildKillSwitch, getLatestSnapshotVersion } from './snapshot';
import { refreshAccountsFromLabels } from './labels';

/** id 短写（业务名），secret 至少 16 位，避免弱密钥。 */
const AGENT_KEY_PAIR = /^([A-Za-z0-9_-]{1,32}):(.{16,128})$/;

async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(a)),
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(b)),
  ]);
  const ba = new Uint8Array(ha);
  const bb = new Uint8Array(hb);
  if (ba.length !== bb.length) return false;
  let diff = 0;
  for (let index = 0; index < ba.length; index += 1) {
    diff |= ba[index] ^ bb[index];
  }
  return diff === 0;
}

/** 校验 X-Agent-Key；匹配返回 key id，否则 null。 */
export async function agentKeyIdentity(
  env: Cloudflare.Env,
  provided: string | null | undefined,
): Promise<string | null> {
  const configured = env.AGENT_API_KEYS?.trim();
  if (!configured || !provided) return null;
  for (const pair of configured.split(',')) {
    const match = pair.trim().match(AGENT_KEY_PAIR);
    if (!match) continue;
    const [, id, secret] = match;
    if (await timingSafeEqual(provided, secret)) return id;
  }
  return null;
}

/** 当前维护者条目（含已撤销，供 Agent 核对现状后决定增改/恢复/撤销）。 */
export async function listAgentMaintainerEntries(env: Cloudflare.Env) {
  return listMaintainerEntries(env, true);
}

export type AgentEntryResult =
  | {
      ok: true;
      action: 'add' | 'update';
      handle: string;
      snapshot_version: string;
      active_entries: number;
    }
  | { ok: false; error: string };

/** 新增/更新一条维护者条目并立即发布（agent 审计以 actor 身份入表）。 */
export async function upsertAgentMaintainerEntry(
  env: Cloudflare.Env,
  actor: string,
  raw: unknown,
): Promise<AgentEntryResult> {
  const saved = await saveAdminAccountDraft(env, raw);
  if (!saved.ok) return saved;
  const published = await publishAdminAccountDrafts(env, actor);
  await recordAdminAudit(env, actor, 'publish', 'accounts', saved.entry.handle, {
    kind: `entry:${saved.action}`,
    category: saved.entry.category,
    snapshot_version: published.snapshot_version,
  });
  return {
    ok: true,
    action: saved.action,
    handle: saved.entry.handle,
    snapshot_version: published.snapshot_version,
    active_entries: published.active_entries,
  };
}

export type AgentRemoveResult =
  | { ok: true; changed: boolean; snapshot_version?: string; active_entries?: number }
  | { ok: false; error: string };

/** 撤销一条维护者条目并立即发布（幂等：已撤销/不存在也返回 ok）。 */
export async function removeAgentMaintainerEntry(
  env: Cloudflare.Env,
  actor: string,
  rawHandle: string,
): Promise<AgentRemoveResult> {
  const deactivated = await deactivateAdminAccountDraft(env, rawHandle);
  if (!deactivated.ok) return deactivated;
  if (!deactivated.changed) {
    return { ok: true, changed: false };
  }
  const published = await publishAdminAccountDrafts(env, actor);
  await recordAdminAudit(env, actor, 'publish', 'accounts', rawHandle.trim().toLowerCase(), {
    kind: 'entry:remove',
    snapshot_version: published.snapshot_version,
  });
  return {
    ok: true,
    changed: true,
    snapshot_version: published.snapshot_version,
    active_entries: published.active_entries,
  };
}

/**
 * 全量重算 accounts 衍生字段（计票 + 分类推理）。
 *
 * 分类推理上线前的存量行仍是旧「票面多数」值（可能被历史回声票钉在 other）；
 * 快照发布时按证据独立推理不受影响，这里让 admin/候选池与快照口径对齐。
 * 分页 + 分块收敛；重算幂等，期间并发写入的行由下一次上报/发布自然收敛。
 */
export async function recomputeAllAccountCategories(
  env: Cloudflare.Env,
  actor: string,
): Promise<{ accounts: number }> {
  const CHUNK = 100;
  let offset = 0;
  let total = 0;
  for (;;) {
    const rows = await env.DB.prepare(
      'SELECT handle FROM accounts ORDER BY handle ASC LIMIT ?1 OFFSET ?2',
    )
      .bind(CHUNK, offset)
      .all<{ handle: string }>();
    const handles = rows.results.map((row) => row.handle);
    if (handles.length === 0) break;
    await refreshAccountsFromLabels(env, handles);
    total += handles.length;
    if (handles.length < CHUNK) break;
    offset += CHUNK;
  }
  await recordAdminAudit(env, actor, 'recompute_categories', 'accounts', 'all', {
    accounts: total,
  });
  return { accounts: total };
}

// ---------------------------------------------------------------------------
// 词库（关键词名单）维护 —— 复用 keyword-admin 的保存即发布语义。
// ---------------------------------------------------------------------------

export async function listAgentKeywords(env: Cloudflare.Env) {
  return listAdminKeywords(env, { limit: null });
}

export type AgentKeywordResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

/** 新增/更新词库分类（pack）；保存即发布由路由层随后调用。 */
export async function upsertAgentKeywordPack(
  env: Cloudflare.Env,
  actor: string,
  raw: unknown,
): Promise<AgentKeywordResult> {
  const result = await saveAdminKeywordPack(env, raw, actor);
  if (!result) return { ok: false, error: 'invalid_pack' };
  return { ok: true, id: result.id };
}

/** 新增/更新词库规则（rule）；pack 必须存在且 active。 */
export async function upsertAgentKeywordRule(
  env: Cloudflare.Env,
  actor: string,
  raw: unknown,
): Promise<AgentKeywordResult> {
  const result = await saveAdminKeywordRule(env, raw, actor);
  if (!result) return { ok: false, error: 'invalid_rule' };
  return { ok: true, id: result.id };
}

export type AgentKeywordRemoveResult =
  | { ok: true; changed: boolean }
  | { ok: false; error: string };

/** 停用词库分类/规则（幂等）。 */
export async function removeAgentKeyword(
  env: Cloudflare.Env,
  actor: string,
  kind: 'packs' | 'rules',
  id: string,
): Promise<AgentKeywordRemoveResult> {
  const table = kind === 'packs' ? 'admin_keyword_packs' : 'admin_keyword_rules';
  const changed = await disableAdminKeyword(env, table, id, actor);
  return { ok: true, changed };
}

/** 发布词库（签名 + R2 产物 + release/audit 记录）。 */
export async function publishAgentKeywords(env: Cloudflare.Env, actor: string) {
  return publishAdminKeywords(env, actor);
}

/** 首次导入词库（仅在空库时生效，幂等）。 */
export async function importAgentKeywordCatalog(env: Cloudflare.Env) {
  return importKeywordCatalog(env);
}

// ---------------------------------------------------------------------------
// 发布记录 / 审计 / 状态 / 资产 —— Agent 巡检与运维。
// ---------------------------------------------------------------------------

export async function listAgentReleases(env: Cloudflare.Env) {
  return listAdminReleases(env);
}

export type AgentRollbackResult =
  | { ok: true; kind: 'accounts' | 'keywords'; detail: Record<string, unknown> }
  | { ok: false; error: string };

/** 按发布记录类型分发回滚（accounts 用 release_id，keywords 用 version）。 */
export async function rollbackAgentRelease(
  env: Cloudflare.Env,
  actor: string,
  releaseId: number,
): Promise<AgentRollbackResult> {
  const release = await getAdminRelease(env, releaseId);
  if (!release) return { ok: false, error: 'release_not_found' };
  try {
    if (release.kind === 'accounts') {
      const detail = await rollbackAdminAccountRelease(env, releaseId, actor);
      return { ok: true, kind: 'accounts', detail };
    }
    const detail = await rollbackAdminKeywordRelease(env, release.version, actor);
    return { ok: true, kind: 'keywords', detail };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'rollback_failed' };
  }
}

/** 审计流水（倒序，limit ≤500）。 */
export async function listAgentAudit(env: Cloudflare.Env, limit = 50): Promise<unknown[]> {
  const bounded = Math.min(Math.max(Math.trunc(limit), 1), 500);
  const rows = await env.DB.prepare(
    `SELECT actor_email, action, target_type, target_id, detail, created_at
     FROM admin_audit_log
     ORDER BY id DESC
     LIMIT ?1`,
  )
    .bind(bounded)
    .all();
  return rows.results;
}

/** 汇总状态：快照 / 官方暂停 / 词库 / 名单 / 候选池指标，供 Agent 巡检一次拿全。 */
export async function agentStatus(env: Cloudflare.Env) {
  const [dashboard, snapshotVersion, activeEntries, keywordManifest] = await Promise.all([
    getDashboardMetrics(env),
    getLatestSnapshotVersion(env),
    listMaintainerEntries(env),
    env.KEYWORD_PACKS?.get('keyword-packs/latest.json'),
  ]);
  let keywords: {
    pack_version?: string;
    files?: Array<{ packs?: number; rules?: number }>;
    signature?: unknown;
  } = {};
  try {
    if (keywordManifest) {
      keywords = JSON.parse(await keywordManifest.text()) as typeof keywords;
    }
  } catch {
    // 损坏的旧 manifest 不影响状态汇总
  }
  return {
    snapshot: {
      version: snapshotVersion,
      entries: dashboard.public_entries,
      lag_seconds: dashboard.snapshot_lag_seconds,
    },
    kill_switch: buildKillSwitch(env.DESTRUCTIVE_KILL_SWITCH, new Date().toISOString()) ?? null,
    community: {
      listed: dashboard.community_listed,
      candidates: dashboard.community_candidates,
      maintainer_entries: dashboard.maintainer_entries,
      active_maintainer_handles: activeEntries.length,
    },
    keywords: {
      pack_version: keywords.pack_version ?? null,
      packs: keywords.files?.[0]?.packs ?? 0,
      rules: keywords.files?.[0]?.rules ?? 0,
      signed: Boolean(keywords.signature),
    },
    generated_at: new Date().toISOString(),
  };
}

/** R2 资产清单（词库产物 + 发布归档；按 prefix 过滤，上限 1000）。 */
export async function listAgentAssets(env: Cloudflare.Env, prefix: string | null) {
  if (!env.KEYWORD_PACKS) return { assets: [] };
  const listed = await env.KEYWORD_PACKS.list({
    ...(prefix ? { prefix } : {}),
    limit: 1000,
  });
  return {
    assets: listed.objects.map((object) => ({
      key: object.key,
      size: object.size,
      uploaded: object.uploaded.toISOString(),
    })),
  };
}