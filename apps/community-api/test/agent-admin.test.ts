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
});