import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';

const ORIGIN = 'https://api.example.com';
const ADMIN = env.ADMIN_TOKEN;

async function adminFetch(
  path: string,
  init: { method?: string; body?: string; token?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  if (init.body) headers['content-type'] = 'application/json';
  return worker.fetch(
    new Request(`${ORIGIN}${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body,
    }),
    env,
  );
}

async function report(installationId: string, handle: string) {
  const res = await worker.fetch(
    new Request(`${ORIGIN}/v1/reports`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        installation_id: installationId,
        reports: [{ handle, reason: 'scam_phishing' }],
      }),
    }),
    env,
  );
  expect(res.status).toBe(200);
}

describe('admin candidates（只读透明度）', () => {
  it('rejects unauthenticated access', async () => {
    expect((await adminFetch('/admin/candidates')).status).toBe(401);
  });

  it('auto-rate: 3 独立安装自动升 strong（零人工）并离开待审队列', async () => {
    const installs = [
      'uuuuuuuu-3001-4001-8000-uuuuuuuuuuuu',
      'uuuuuuuu-3002-4002-8000-uuuuuuuuuuuu',
      'uuuuuuuu-3003-4003-8000-uuuuuuuuuuuu',
    ];
    for (const id of installs) await report(id, 'review_user');

    // 上传时已按阈值定级：3 票 → strong（不再需要人工 promote）
    const row = await env.DB.prepare(
      'SELECT status, report_count FROM accounts WHERE handle = ?1',
    )
      .bind('review_user')
      .first<{ status: string; report_count: number }>();
    expect(row?.status).toBe('strong');
    expect(row?.report_count).toBe(3);

    const queue = (await (
      await adminFetch('/admin/candidates', { token: ADMIN })
    ).json()) as {
      candidates: { handle: string; status: string; report_count: number }[];
    };
    expect(queue.candidates.some((c) => c.handle === 'review_user')).toBe(false);
  });

  it('2 独立安装自动升 candidate（默认档可见）', async () => {
    await report('vvvvvvvv-3001-4001-8000-vvvvvvvvvvvv', 'auto_cand');
    await report('vvvvvvvv-3002-4002-8000-vvvvvvvvvvvv', 'auto_cand');
    const row = await env.DB.prepare(
      'SELECT status FROM accounts WHERE handle = ?1',
    )
      .bind('auto_cand')
      .first<{ status: string }>();
    expect(row?.status).toBe('candidate');
  });
});