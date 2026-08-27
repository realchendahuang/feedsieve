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

describe('admin candidates & promote', () => {
  it('rejects unauthenticated access', async () => {
    expect((await adminFetch('/admin/candidates')).status).toBe(401);
    expect(
      (
        await adminFetch('/admin/promote', {
          method: 'POST',
          body: JSON.stringify({ handle: 'x', status: 'strong' }),
        })
      ).status,
    ).toBe(401);
  });

  it('promote validates status and account existence', async () => {
    expect(
      (
        await adminFetch('/admin/promote', {
          method: 'POST',
          token: ADMIN,
          body: JSON.stringify({ handle: 'a_user', status: 'candidate' }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await adminFetch('/admin/promote', {
          method: 'POST',
          token: ADMIN,
          body: JSON.stringify({ handle: 'nobody_here', status: 'strong' }),
        })
      ).status,
    ).toBe(404);
  });

  it('human promote: candidate -> strong, then leaves the review queue', async () => {
    const installs = ['uuuuuuuu-3001-4001-8000-uuuuuuuuuuuu', 'uuuuuuuu-3002-4002-8000-uuuuuuuuuuuu', 'uuuuuuuu-3003-4003-8000-uuuuuuuuuuuu'];
    for (const id of installs) await report(id, 'review_user');

    const queue = (await (
      await adminFetch('/admin/candidates', { token: ADMIN })
    ).json()) as {
      candidates: { handle: string; status: string; report_count: number }[];
    };
    const entry = queue.candidates.find((c) => c.handle === 'review_user');
    expect(entry?.status).toBe('candidate');
    expect(entry?.report_count).toBe(3);

    const promoted = (await (
      await adminFetch('/admin/promote', {
        method: 'POST',
        token: ADMIN,
        body: JSON.stringify({ handle: '@review_user', status: 'strong' }),
      })
    ).json()) as { handle: string; status: string };
    expect(promoted).toEqual({ handle: 'review_user', status: 'strong' });

    const after = (await (
      await adminFetch('/admin/candidates', { token: ADMIN })
    ).json()) as { candidates: { handle: string }[] };
    expect(after.candidates.some((c) => c.handle === 'review_user')).toBe(false);

    const row = await env.DB.prepare(
      'SELECT status FROM accounts WHERE handle = ?1',
    )
      .bind('review_user')
      .first<{ status: string }>();
    expect(row?.status).toBe('strong');
  });
});
