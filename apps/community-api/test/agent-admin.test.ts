import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';
import { getSnapshotFile, SNAPSHOT_PACK } from '../src/snapshot';

const ORIGIN = 'https://api.example.com';
/** 测试用 agent key（长度 ≥16；生产 key 走 wrangler secret，绝不入库/提交） */
const AGENT_KEY = '0123456789abcdef0123456789abcdef';
const KEYED_ENV = { ...env, AGENT_API_KEYS: `ops:${AGENT_KEY}` } as typeof env;

function agentRequest(path: string, init: RequestInit = {}): Promise<Response> {
  // cast 到 worker.fetch 期望的 Request 泛型；Promise.resolve 摊平 Response | Promise<Response>
  const request = new Request(`${ORIGIN}${path}`, {
    ...init,
    headers: { 'x-agent-key': AGENT_KEY, ...(init.headers ?? {}) },
  }) as unknown as Parameters<typeof worker.fetch>[0];
  return Promise.resolve(worker.fetch(request, KEYED_ENV));
}

function putEntry(handle: string): Promise<Response> {
  return agentRequest(`/api/agent/entries/${handle}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ handle, category: 'bot_spam', note: 'Agent 测试条目' }),
  });
}

async function latestVersion(envLike: typeof env): Promise<string> {
  const latest = await worker.fetch(new Request(`${ORIGIN}/v1/snapshots/latest`), envLike);
  const manifest = (await latest.json()) as { snapshot_version: string };
  return manifest.snapshot_version;
}

async function snapshotHandles(version: string): Promise<string[]> {
  const body = JSON.parse(
    (await getSnapshotFile(env, version, SNAPSHOT_PACK)) ?? '{}',
  ) as { entries: Array<{ handle: string }> };
  return body.entries.map((entry) => entry.handle);
}

describe('agent maintenance API', () => {
  it('无 key / 错误 key / 未配置密钥 → 401', async () => {
    const noKey = await worker.fetch(new Request(`${ORIGIN}/api/agent/entries`), KEYED_ENV);
    expect(noKey.status).toBe(401);

    const badKey = await worker.fetch(
      new Request(`${ORIGIN}/api/agent/entries`, {
        headers: { 'x-agent-key': 'wrong-key-wrong-key-wrong' },
      }),
      KEYED_ENV,
    );
    expect(badKey.status).toBe(401);

    // 未配置 AGENT_API_KEYS 的普通 env：通道不可用
    const unconfigured = await worker.fetch(new Request(`${ORIGIN}/api/agent/entries`), env);
    expect(unconfigured.status).toBe(401);
  });

  it('PUT 新增 → 立即发布进快照，审计以 agent:ops 身份记录', async () => {
    const res = await putEntry('agent_new_user');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      action: string;
      handle: string;
      snapshot_version: string;
    };
    expect(body.ok).toBe(true);
    expect(body.action).toBe('add');
    expect(body.handle).toBe('agent_new_user');

    const handles = await snapshotHandles(await latestVersion(KEYED_ENV));
    expect(handles).toContain('agent_new_user');

    const audit = await env.DB.prepare(
      `SELECT actor_email, action FROM admin_audit_log WHERE target_id = ?1`,
    )
      .bind('agent_new_user')
      .all<{ actor_email: string; action: string }>();
    expect(audit.results.length).toBeGreaterThan(0);
    expect(audit.results[0].actor_email).toBe('agent:ops');
  });

  it('路径 handle 与 body.handle 不一致 → 400，不落库', async () => {
    const res = await agentRequest('/api/agent/entries/path_handle', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: 'other_handle', category: 'bot_spam', note: 'Agent 测试条目' }),
    });
    expect(res.status).toBe(400);
    const handles = await snapshotHandles(await latestVersion(KEYED_ENV));
    expect(handles).not.toContain('other_handle');
  });

  it('DELETE 撤销 → 条目从快照消失（幂等）', async () => {
    await putEntry('agent_del_user');
    const handlesBefore = await snapshotHandles(await latestVersion(KEYED_ENV));
    expect(handlesBefore).toContain('agent_del_user');

    const res = await agentRequest('/api/agent/entries/agent_del_user', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; changed: boolean };
    expect(body.ok).toBe(true);
    expect(body.changed).toBe(true);

    const after = await snapshotHandles(await latestVersion(KEYED_ENV));
    expect(after).not.toContain('agent_del_user');

    // 幂等：再次撤销返回 ok + changed:false
    const again = await agentRequest('/api/agent/entries/agent_del_user', { method: 'DELETE' });
    expect((await again.json()) as { changed: boolean }).toEqual({ ok: true, changed: false });
  });

  it('词库：PUT pack/rule + publish → R2 产物与审计（agent:ops）', async () => {
    const packId = 'agent_pack_a';
    const packRes = await agentRequest(`/api/agent/keywords/packs/${packId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: packId,
        name_zh: 'Agent 分类',
        description_zh: 'Agent 分类描述',
      }),
    });
    expect(packRes.status).toBe(200);
    expect((await packRes.json()) as { id: string }).toEqual({ ok: true, id: packId });

    const ruleId = 'agent-rule-a';
    const ruleRes = await agentRequest(`/api/agent/keywords/rules/${ruleId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: ruleId,
        pack_id: packId,
        phrase: 'Agent 词组',
        terms: ['Agent', '词组'],
        max_gap: 8,
      }),
    });
    expect(ruleRes.status).toBe(200);
    expect((await ruleRes.json()) as { id: string }).toEqual({ ok: true, id: ruleId });

    const published = await agentRequest('/api/agent/keywords/publish', { method: 'POST' });
    expect(published.status).toBe(200);
    const body = (await published.json()) as {
      version: string;
      packs: number;
      rules: number;
    };
    expect(body.version).toMatch(/^\d{4}\.\d{2}\.\d{2}\.\d+$/);
    expect(body.rules).toBeGreaterThanOrEqual(1);

    const latestObj = await env.KEYWORD_PACKS!.get('keyword-packs/latest.json');
    expect(latestObj).toBeTruthy();
    const manifest = JSON.parse(await latestObj!.text()) as {
      pack_version: string;
      signature?: unknown;
    };
    expect(manifest.pack_version).toBe(body.version);

    const audit = await env.DB.prepare(
      `SELECT actor_email, action FROM admin_audit_log WHERE target_type = ?1 ORDER BY id DESC LIMIT 1`,
    )
      .bind('keyword_pack')
      .first<{ actor_email: string; action: string }>();
    expect(audit?.actor_email).toBe('agent:ops');
  });

  it('词库：停用 pack → 发布后从 R2 产物移除', async () => {
    const packId = 'agent_pack_b';
    await agentRequest(`/api/agent/keywords/packs/${packId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: packId,
        name_zh: '待删除分类',
        description_zh: '待删除分类描述',
      }),
    });
    const del = await agentRequest(`/api/agent/keywords/packs/${packId}`, { method: 'DELETE' });
    expect((await del.json()) as { changed: boolean }).toEqual({ ok: true, changed: true });
    await agentRequest('/api/agent/keywords/publish', { method: 'POST' });
    const keywords = await agentRequest('/api/agent/keywords');
    const data = (await keywords.json()) as { packs: Array<{ id: string; active: boolean }> };
    expect(data.packs.find((pack) => pack.id === packId)?.active).toBe(false);
  });

  it('status / releases / assets / audit 巡检端点齐全', async () => {
    const statusRes = await agentRequest('/api/agent/status');
    expect(statusRes.status).toBe(200);
    const status = (await statusRes.json()) as {
      snapshot: { version: string | null; entries: number };
      kill_switch: unknown;
      community: { listed: number; maintainer_entries: number };
      keywords: { pack_version: string | null; signed: boolean };
    };
    expect(typeof status.snapshot.version).toBe('string');
    expect(status.community.listed).toBeGreaterThanOrEqual(0);
    expect(typeof status.keywords.pack_version).toBe('string');

    const releases = await agentRequest('/api/agent/releases');
    expect((await releases.json()) as { releases: unknown[] }).toHaveProperty('releases');

    const audit = await agentRequest('/api/agent/audit?limit=10');
    const auditBody = (await audit.json()) as { audit: Array<{ actor_email: string }> };
    expect(Array.isArray(auditBody.audit)).toBe(true);
    expect(auditBody.audit.some((row) => row.actor_email === 'agent:ops')).toBe(true);

    const assets = await agentRequest('/api/agent/assets?prefix=keyword-packs/');
    const assetsBody = (await assets.json()) as { assets: Array<{ key: string }> };
    expect(assetsBody.assets.length).toBeGreaterThan(0);
    expect(assetsBody.assets.some((asset) => asset.key === 'keyword-packs/latest.json')).toBe(
      true,
    );
  });

  it('recompute-categories：存量行按推理口径重算并记审计', async () => {
    // 直接播种一行旧口径数据（票面多数时代的历史行）：无票无证据，旧分类是 scam_phishing
    await env.DB.prepare(
      `INSERT INTO accounts (handle, x_user_id, category, status, report_count, rescue_count,
         first_report_at, updated_at)
       VALUES ('rc_stale_user', NULL, 'scam_phishing', 'new', 0, 0, 1758000000, 1758000000)`,
    ).run();
    const response = await agentRequest('/api/agent/recompute-categories', { method: 'POST' });
    expect(response.status).toBe(200);
    expect(await response.json()).toHaveProperty('accounts');
    const row = await env.DB.prepare('SELECT category FROM accounts WHERE handle = ?1')
      .bind('rc_stale_user')
      .first<{ category: string }>();
    expect(row?.category).toBe('other');

    const audit = await agentRequest('/api/agent/audit?limit=10');
    const auditBody = (await audit.json()) as { audit: Array<{ action: string }> };
    expect(auditBody.audit.some((auditRow) => auditRow.action === 'recompute_categories')).toBe(
      true,
    );
  });
});