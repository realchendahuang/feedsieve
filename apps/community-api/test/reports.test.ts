import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';
import { hashInstallationId } from '../src/lib/hash';

const ORIGIN = 'https://api.example.com';

async function post(body: unknown): Promise<Response> {
  return worker.fetch(
    new Request(`${ORIGIN}/v1/reports`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    env,
  );
}

function report(handle: string, extra: Record<string, unknown> = {}) {
  return { handle, reason: 'bot_spam', ...extra };
}

async function postOne(installationId: string, handle: string) {
  const res = await post({
    installation_id: installationId,
    client_version: '0.2.0-test',
    reports: [report(handle)],
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { results: { status: string }[] };
  return body.results[0];
}

async function accountRow(handle: string) {
  return env.DB.prepare(
    'SELECT status, report_count, category FROM accounts WHERE handle = ?1',
  )
    .bind(handle)
    .first<{ status: string; report_count: number; category: string }>();
}

describe('POST /v1/reports', () => {
  it('records a valid report and hashes the installation id', async () => {
    const raw = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
    const result = await postOne(raw, '@Spam_User');

    expect(result.status).toBe('recorded');

    const account = await accountRow('spam_user');
    expect(account?.report_count).toBe(1);
    expect(account?.status).toBe('new');
    expect(account?.category).toBe('bot_spam');

    const stored = await env.DB.prepare(
      'SELECT installation_id FROM reports WHERE handle = ?1',
    )
      .bind('spam_user')
      .first<{ installation_id: string }>();
    const expectedHash = await hashInstallationId(env.INSTALLATION_SALT, raw);
    expect(stored?.installation_id).toBe(expectedHash);
    expect(stored?.installation_id).not.toContain(raw);
  });

  it('dedupes the same installation reporting the same handle', async () => {
    const id = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
    expect((await postOne(id, 'dup_user')).status).toBe('recorded');
    expect((await postOne(id, 'dup_user')).status).toBe('duplicate');

    const account = await accountRow('dup_user');
    expect(account?.report_count).toBe(1);
  });

  it('auto-promotes by distinct installations: 2 -> candidate, 3 -> strong', async () => {
    await postOne('cccccccc-3333-4333-8333-cccccccccccc', 'thresh_user');
    await postOne('dddddddd-4444-4444-8444-dddddddddddd', 'thresh_user');
    const account = await accountRow('thresh_user');
    expect(account?.status).toBe('candidate');
    expect(account?.report_count).toBe(2);

    await postOne('eeeeeeee-5555-4555-8555-eeeeeeeeeeee', 'thresh_user');
    const promoted = await accountRow('thresh_user');
    expect(promoted?.status).toBe('strong');
    expect(promoted?.report_count).toBe(3);
  });

  it('rejects invalid items per-result without failing the batch', async () => {
    const res = await post({
      installation_id: 'ffffffff-6666-4666-8666-ffffffffffff',
      reports: [
        report('ok_user'),
        report('bad handle!'),
        report('bad_reason_user', { reason: 'opinions_i_dislike' }),
        report('bad_id_user', { x_user_id: 'not-a-number' }),
      ],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: { handle: string; status: string; error?: string }[];
    };
    expect(body.results[0].status).toBe('recorded');
    expect(body.results[1].status).toBe('rejected');
    expect(body.results[1].error).toBe('invalid_handle');
    expect(body.results[2].error).toBe('invalid_reason');
    expect(body.results[3].error).toBe('invalid_x_user_id');
  });

  it('envelopes: bad body / empty array / oversized batch', async () => {
    expect((await post({ reports: [] })).status).toBe(400);
    expect((await post({ installation_id: 'short', reports: [report('x')] })).status).toBe(400);
    expect((await post('not-an-object')).status).toBe(400);

    const many = Array.from({ length: 51 }, (_, i) => report(`user_${i}`));
    expect(
      (await post({ installation_id: 'gggggggg-7777-4777-8777-gggggggggggg', reports: many })).status,
    ).toBe(413);
  });

  it('rate-limits an installation over the daily limit', async () => {
    const raw = 'hhhhhhhh-8888-4888-8888-hhhhhhhhhhhh';
    const installHash = await hashInstallationId(env.INSTALLATION_SALT, raw);
    const today = new Date().toISOString().slice(0, 10);
    await env.DB.prepare(
      'INSERT INTO installations (id, first_seen_at, last_seen_at, reports_day, reports_today) VALUES (?1, ?2, ?2, ?3, ?4)',
    )
      .bind(installHash, Math.floor(Date.now() / 1000), today, 100)
      .run();

    const res = await post({
      installation_id: raw,
      reports: [report('capped_user')],
    });
    expect(res.status).toBe(429);
  });
});

describe('CORS preflight', () => {
  it('answers OPTIONS for cross-origin posts', async () => {
    const res = await worker.fetch(
      new Request(`${ORIGIN}/v1/reports`, { method: 'OPTIONS' }),
      env,
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});
