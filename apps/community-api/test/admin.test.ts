import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';

const ORIGIN = 'https://api.example.com';

async function fetchApi(
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<Response> {
  return worker.fetch(new Request(`${ORIGIN}${path}`, init), env);
}

async function report(installationId: string, handle: string) {
  const response = await fetchApi('/v1/reports', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      installation_id: installationId,
      reports: [{ handle, reason: 'scam_phishing' }],
    }),
  });
  expect(response.status).toBe(200);
}

describe('管理后台安全边界', () => {
  it('retires the public string-HTML page and every legacy bearer-token endpoint', async () => {
    for (const path of ['/maintainer', '/admin/publish', '/admin/blocklist', '/admin/community-votes']) {
      const response = await fetchApi(path, {
        method: path === '/admin/publish' ? 'POST' : 'GET',
        headers: { authorization: 'Bearer ignored-even-if-present' },
      });
      expect(response.status).toBe(410);
      expect(await response.json()).toEqual({ error: 'admin_moved_to_access' });
    }
  });

  it('keeps the public community threshold independent from management access', async () => {
    const installs = [
      'uuuuuuuu-3001-4001-8000-uuuuuuuuuuuu',
      'uuuuuuuu-3002-4002-8000-uuuuuuuuuuuu',
      'uuuuuuuu-3003-4003-8000-uuuuuuuuuuuu',
    ];
    for (const id of installs) await report(id, 'review_user');

    const row = await env.DB.prepare('SELECT status, report_count FROM accounts WHERE handle = ?1')
      .bind('review_user')
      .first<{ status: string; report_count: number }>();
    expect(row).toEqual({ status: 'strong', report_count: 3 });
  });
});
