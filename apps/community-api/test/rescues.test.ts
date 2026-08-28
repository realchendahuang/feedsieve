import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';

const ORIGIN = 'https://api.example.com';

async function postRescues(body: unknown): Promise<Response> {
  return worker.fetch(
    new Request(`${ORIGIN}/v1/rescues`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    env,
  );
}

async function postReports(installationId: string, handle: string): Promise<Response> {
  return worker.fetch(
    new Request(`${ORIGIN}/v1/reports`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        installation_id: installationId,
        reports: [{ handle, reason: 'bot_spam' }],
      }),
    }),
    env,
  );
}

async function accountRow(handle: string) {
  return env.DB.prepare(
    'SELECT status, report_count, rescue_count FROM accounts WHERE handle = ?1',
  )
    .bind(handle)
    .first<{ status: string; report_count: number; rescue_count: number }>();
}

async function report3(handle: string): Promise<void> {
  const installs = [
    'rrrrrrrr-6001-4001-8000-rrrrrrrrrrrr',
    'rrrrrrrr-6002-4002-8000-rrrrrrrrrrrr',
    'rrrrrrrr-6003-4003-8000-rrrrrrrrrrrr',
  ];
  for (const id of installs) {
    const res = await postReports(id, handle);
    expect(res.status).toBe(200);
  }
}

describe('POST /v1/rescues', () => {
  it('records a rescue vote and increments rescue_count', async () => {
    await report3('rescue_me_user');
    const res = await postRescues({
      installation_id: 'ssssssss-7001-4001-8000-ssssssssssss',
      rescues: [{ handle: '@rescue_me_user' }],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: { status: string }[] };
    expect(body.results[0].status).toBe('recorded');

    const row = await accountRow('rescue_me_user');
    expect(row?.rescue_count).toBe(1);
  });

  it('dedupes per installation and reports unknown for unlisted accounts', async () => {
    await report3('rescue_dup_user');
    const id = 'ssssssss-7002-4002-8000-ssssssssssss';
    expect(
      ((await (await postRescues({ installation_id: id, rescues: [{ handle: 'rescue_dup_user' }] })).json()) as { results: { status: string }[] }).results[0].status,
    ).toBe('recorded');
    expect(
      ((await (await postRescues({ installation_id: id, rescues: [{ handle: 'rescue_dup_user' }] })).json()) as { results: { status: string }[] }).results[0].status,
    ).toBe('duplicate');

    const unknown = (await (
      await postRescues({
        installation_id: 'ssssssss-7003-4003-8000-ssssssssssss',
        rescues: [{ handle: 'never_listed' }],
      })
    ).json()) as { results: { status: string }[] };
    expect(unknown.results[0].status).toBe('unknown');
  });

  it('auto-demotes a candidate back to new when rescues catch up with reports', async () => {
    const handle = 'rescue_demote';
    await report3(handle);
    expect((await accountRow(handle))?.status).toBe('candidate');

    // 3 个独立安装各投一票抢救 → rescue_count(3) >= report_count(3) → 降回 new
    const rescuers = [
      'ssssssss-7004-4004-8000-ssssssssssss',
      'ssssssss-7005-4005-8000-ssssssssssss',
      'ssssssss-7006-4006-8000-ssssssssssss',
    ];
    for (const id of rescuers) {
      const res = await postRescues({ installation_id: id, rescues: [{ handle }] });
      expect(res.status).toBe(200);
    }
    const row = await accountRow(handle);
    expect(row?.rescue_count).toBe(3);
    expect(row?.status).toBe('new');
  });

  it('does not auto-demote human-promoted statuses', async () => {
    const handle = 'rescue_strong';
    await report3(handle);
    const promote = await worker.fetch(
      new Request(`${ORIGIN}/admin/promote`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${env.ADMIN_TOKEN}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ handle, status: 'strong' }),
      }),
      env,
    );
    expect(promote.status).toBe(200);

    await postRescues({
      installation_id: 'ssssssss-7007-4007-8000-ssssssssssss',
      rescues: [{ handle }],
    });
    const row = await accountRow(handle);
    expect(row?.status).toBe('strong');
  });

  it('envelopes: empty array / oversized batch are rejected', async () => {
    expect(
      (await postRescues({ installation_id: 'ssssssss-7008-4008-8000-ssssssssss', rescues: [] })).status,
    ).toBe(400);
    const many = Array.from({ length: 51 }, (_, i) => ({ handle: `u_${i}` }));
    expect(
      (await postRescues({ installation_id: 'ssssssss-7009-4009-8000-ssssssssss', rescues: many })).status,
    ).toBe(413);
  });
});
