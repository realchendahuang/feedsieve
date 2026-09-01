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
  return env.DB.prepare('SELECT status, report_count, rescue_count FROM accounts WHERE handle = ?1')
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
      (
        (await (
          await postRescues({ installation_id: id, rescues: [{ handle: 'rescue_dup_user' }] })
        ).json()) as { results: { status: string }[] }
      ).results[0].status,
    ).toBe('recorded');
    expect(
      (
        (await (
          await postRescues({ installation_id: id, rescues: [{ handle: 'rescue_dup_user' }] })
        ).json()) as { results: { status: string }[] }
      ).results[0].status,
    ).toBe('duplicate');

    const unknown = (await (
      await postRescues({
        installation_id: 'ssssssss-7003-4003-8000-ssssssssssss',
        rescues: [{ handle: 'never_listed' }],
      })
    ).json()) as { results: { status: string }[] };
    expect(unknown.results[0].status).toBe('unknown');
  });

  it('stores rule-level evidence for heuristic false positives without creating an account', async () => {
    const handle = 'legit_creator88';
    const res = await postRescues({
      installation_id: 'ssssssss-7010-4010-8010-ssssssssssss',
      client_version: '0.7.1',
      rescues: [
        {
          handle,
          detection_source: 'heuristic',
          rule_id: 'default-name-digits',
          detection_reason: '启发式：默认名 + 随机数字，疑似批量注册账号',
        },
      ],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: { status: string }[] };
    expect(body.results[0].status).toBe('unknown');

    const feedback = await env.DB.prepare(
      `SELECT detection_source, rule_id, detection_reason, client_version
       FROM rescues WHERE handle = ?1`,
    )
      .bind(handle)
      .first<{
        detection_source: string;
        rule_id: string;
        detection_reason: string;
        client_version: string;
      }>();
    expect(feedback).toMatchObject({
      detection_source: 'heuristic',
      rule_id: 'default-name-digits',
      client_version: '0.7.1',
    });
    expect(feedback?.detection_reason).toContain('默认名');
    expect(await accountRow(handle)).toBeNull();
  });

  it('rejects malformed false-positive evidence', async () => {
    const base = {
      installation_id: 'ssssssss-7011-4011-8011-ssssssssssss',
    };
    expect(
      (
        await postRescues({
          ...base,
          rescues: [{ handle: 'valid_handle', detection_source: 'page-script' }],
        })
      ).status,
    ).toBe(200);
    const invalidSource = (await (
      await postRescues({
        ...base,
        rescues: [{ handle: 'valid_handle', detection_source: 'page-script' }],
      })
    ).json()) as { results: { status: string; error?: string }[] };
    expect(invalidSource.results[0]).toMatchObject({
      status: 'rejected',
      error: 'invalid_detection_source',
    });
  });

  it('auto-demotes a candidate back to new when rescues catch up with reports', async () => {
    const handle = 'rescue_demote';
    // 2 票 = candidate（阈值下调后够格）；再用 2 个抢救票追平 → 降回 new
    await postReports('rrrrrrrr-6001-4001-8000-rrrrrrrrrrrr', handle);
    await postReports('rrrrrrrr-6002-4002-8000-rrrrrrrrrrrr', handle);
    expect((await accountRow(handle))?.status).toBe('candidate');

    const rescuers = [
      'ssssssss-7004-4004-8000-ssssssssssss',
      'ssssssss-7005-4005-8000-ssssssssssss',
    ];
    for (const id of rescuers) {
      const res = await postRescues({ installation_id: id, rescues: [{ handle }] });
      expect(res.status).toBe(200);
    }
    const row = await accountRow(handle);
    expect(row?.rescue_count).toBe(2);
    expect(row?.status).toBe('new');
  });

  it('owner rescue is a final veto (dismissed, never resurrected)', async () => {
    const handle = 'owner_veto';
    await report3(handle);
    expect((await accountRow(handle))?.status).toBe('strong');

    await postRescues({
      installation_id: env.OWNER_INSTALLATION_ID ?? 'owner-test-install-0001',
      rescues: [{ handle }],
    });
    expect((await accountRow(handle))?.status).toBe('dismissed');

    // 再举报也不复活
    await postReports('rrrrrrrr-6009-4009-8000-rrrrrrrrrrrr', handle);
    expect((await accountRow(handle))?.status).toBe('dismissed');
  });

  it('envelopes: empty array / oversized batch are rejected', async () => {
    expect(
      (await postRescues({ installation_id: 'ssssssss-7008-4008-8000-ssssssssss', rescues: [] }))
        .status,
    ).toBe(400);
    const many = Array.from({ length: 51 }, (_, i) => ({ handle: `u_${i}` }));
    expect(
      (await postRescues({ installation_id: 'ssssssss-7009-4009-8000-ssssssssss', rescues: many }))
        .status,
    ).toBe(413);
  });
});
