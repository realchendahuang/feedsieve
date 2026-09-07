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
  publishAdminAccountDrafts,
  recordAdminAudit,
  saveAdminAccountDraft,
} from './admin-accounts';

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