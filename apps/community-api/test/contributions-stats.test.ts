import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';

const ORIGIN = 'https://api.example.com';

async function report(installationId: string, handle: string) {
  const res = await worker.fetch(
    new Request(`${ORIGIN}/v1/reports`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        installation_id: installationId,
        reports: [{ handle, reason: 'copy_paste' }],
      }),
    }),
    env,
  );
  expect(res.status).toBe(200);
}

async function rescue(installationId: string, handle: string) {
  const res = await worker.fetch(
    new Request(`${ORIGIN}/v1/rescues`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        installation_id: installationId,
        rescues: [{ handle }],
      }),
    }),
    env,
  );
  expect(res.status).toBe(200);
}

async function stats(installationId: string): Promise<Record<string, number>> {
  const res = await worker.fetch(
    new Request(`${ORIGIN}/v1/contributions/stats`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ installation_id: installationId }),
    }),
    env,
  );
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, number>;
}

describe('POST /v1/contributions/stats', () => {
  it('返回该安装当前生效的黑名单 / 白名单 / 被采纳数', async () => {
    const install = 'stats-install-0001-ffffff';
    await report(install, 'stats_a');
    await report(install, 'stats_b');
    await rescue(install, 'stats_a');

    const s = await stats(install);
    // stats_a 已从拉黑改判为白名单，同一安装不再同时算正负两票。
    expect(s.reports).toBe(1);
    expect(s.rescues).toBe(1);
    // 上报过的账号尚未进快照（无 3 票），adopted = 0
    expect(s.adopted).toBe(0);
  });

  it('不同安装互不可见（隐私隔离）', async () => {
    const a = 'stats-install-aaaa-ffffff';
    const b = 'stats-install-bbbb-ffffff';
    await report(a, 'stats_shared');
    await report(b, 'stats_shared');

    const sa = await stats(a);
    const sb = await stats(b);
    expect(sa.reports).toBe(1);
    expect(sb.reports).toBe(1);
  });

  it('非法 installation_id 返回 400', async () => {
    const res = await worker.fetch(
      new Request(`${ORIGIN}/v1/contributions/stats`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ installation_id: 'short' }),
      }),
      env,
    );
    expect(res.status).toBe(400);
  });
});
