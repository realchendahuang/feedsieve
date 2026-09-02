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

describe('admin community votes（只读透明度）', () => {
  it('rejects unauthenticated access', async () => {
    expect((await adminFetch('/admin/community-votes')).status).toBe(401);
  });

  it('shows all community vote totals without allowing manual promotion', async () => {
    const installs = [
      'uuuuuuuu-3001-4001-8000-uuuuuuuuuuuu',
      'uuuuuuuu-3002-4002-8000-uuuuuuuuuuuu',
      'uuuuuuuu-3003-4003-8000-uuuuuuuuuuuu',
    ];
    for (const id of installs) await report(id, 'review_user');

    // 上传时已按唯一阈值定级：3 票 → 最终社区名单。
    const row = await env.DB.prepare('SELECT status, report_count FROM accounts WHERE handle = ?1')
      .bind('review_user')
      .first<{ status: string; report_count: number }>();
    expect(row?.status).toBe('strong');
    expect(row?.report_count).toBe(3);

    const queue = (await (await adminFetch('/admin/community-votes', { token: ADMIN })).json()) as {
      community_votes: { handle: string; status: string; report_count: number }[];
    };
    expect(queue.community_votes).toContainEqual(
      expect.objectContaining({ handle: 'review_user', status: 'strong', report_count: 3 }),
    );
  });

  it('2 independent installations remain below the final-list threshold', async () => {
    await report('vvvvvvvv-3001-4001-8000-vvvvvvvvvvvv', 'auto_cand');
    await report('vvvvvvvv-3002-4002-8000-vvvvvvvvvvvv', 'auto_cand');
    const row = await env.DB.prepare('SELECT status FROM accounts WHERE handle = ?1')
      .bind('auto_cand')
      .first<{ status: string }>();
    expect(row?.status).toBe('new');
  });
});

describe('maintainer blocklist', () => {
  it('serves a public management page without embedding a token', async () => {
    const response = await adminFetch('/maintainer');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(response.headers.get('cache-control')).toBe('no-store');
    const html = await response.text();
    expect(html).toContain('维护者黑名单');
    expect(html).toContain('sessionStorage');
    expect(html).not.toContain(ADMIN);
  });

  it('adds, publishes, merges and retracts an explicitly labeled maintainer source', async () => {
    expect(
      (
        await adminFetch('/admin/blocklist', {
          method: 'POST',
          body: JSON.stringify({
            handle: '@maintained_user',
            category: 'scam_phishing',
            note: '冒充客服并发送钓鱼链接',
          }),
        })
      ).status,
    ).toBe(401);

    const added = await adminFetch('/admin/blocklist', {
      method: 'POST',
      token: ADMIN,
      body: JSON.stringify({
        handle: '@maintained_user',
        category: 'scam_phishing',
        note: '冒充客服并发送钓鱼链接',
        evidence_post_id: '190000000000000001',
      }),
    });
    expect(added.status).toBe(200);
    expect(await added.json()).toMatchObject({
      action: 'add',
      entry: { handle: 'maintained_user', active: true },
    });

    const published = (await (await adminFetch('/v1/blocklist/latest.json')).json()) as {
      entries: Array<{
        handle: string;
        sources: string[];
        report_count: number;
        rescue_count: number;
        net_votes: number;
        maintainer_note?: string;
      }>;
    };
    expect(published.entries).toContainEqual(
      expect.objectContaining({
        handle: 'maintained_user',
        sources: ['maintainer'],
        report_count: 0,
        rescue_count: 0,
        net_votes: 0,
        maintainer_note: '冒充客服并发送钓鱼链接',
      }),
    );

    const voters = [
      'maintainer-0001-4001-8001-aaaaaaaaaaaa',
      'maintainer-0002-4002-8002-bbbbbbbbbbbb',
      'maintainer-0003-4003-8003-cccccccccccc',
    ];
    await report(voters[0], 'maintained_user');
    await report(voters[1], 'maintained_user');
    const belowThreshold = (await (await adminFetch('/v1/blocklist/latest.json')).json()) as {
      entries: Array<{
        handle: string;
        sources: string[];
        report_count: number;
        net_votes: number;
      }>;
    };
    expect(belowThreshold.entries).toContainEqual(
      expect.objectContaining({
        handle: 'maintained_user',
        sources: ['maintainer'],
        report_count: 2,
        net_votes: 2,
      }),
    );

    await report(voters[2], 'maintained_user');
    const merged = (await (await adminFetch('/v1/blocklist/latest.json')).json()) as {
      entries: Array<{ handle: string; sources: string[]; net_votes: number }>;
    };
    expect(merged.entries).toContainEqual(
      expect.objectContaining({
        handle: 'maintained_user',
        sources: ['community', 'maintainer'],
        net_votes: 3,
      }),
    );

    const removed = await adminFetch('/admin/blocklist/maintained_user', {
      method: 'DELETE',
      token: ADMIN,
    });
    expect(removed.status).toBe(200);
    expect(await removed.json()).toMatchObject({ changed: true });

    const after = (await (await adminFetch('/v1/blocklist/latest.json')).json()) as {
      entries: Array<{ handle: string; sources: string[] }>;
    };
    expect(after.entries).toContainEqual(
      expect.objectContaining({ handle: 'maintained_user', sources: ['community'] }),
    );
  });

  it('rejects invalid public notes and records an audit trail', async () => {
    const invalid = await adminFetch('/admin/blocklist', {
      method: 'POST',
      token: ADMIN,
      body: JSON.stringify({ handle: 'bad_note', category: 'other', note: 'x' }),
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: 'invalid_note' });

    await adminFetch('/admin/blocklist', {
      method: 'POST',
      token: ADMIN,
      body: JSON.stringify({
        handle: 'audit_user',
        category: 'bot_spam',
        note: '自动化垃圾回复账号',
      }),
    });
    await adminFetch('/admin/blocklist/audit_user', { method: 'DELETE', token: ADMIN });
    const audit = await env.DB.prepare(
      'SELECT action FROM maintainer_blocklist_audit WHERE handle = ?1 ORDER BY id ASC',
    )
      .bind('audit_user')
      .all<{ action: string }>();
    expect(audit.results.map((row) => row.action)).toEqual(['add', 'remove']);
  });
});

describe('admin false positives（规则级误标审计）', () => {
  it('rejects unauthenticated access', async () => {
    expect((await adminFetch('/admin/false-positives')).status).toBe(401);
  });

  it('returns a rule summary and recent feedback without installation identifiers', async () => {
    const res = await worker.fetch(
      new Request(`${ORIGIN}/v1/rescues`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          installation_id: 'zzzzzzzz-9101-4101-8101-zzzzzzzzzzzz',
          client_version: '0.7.1',
          rescues: [
            {
              handle: 'legituser88',
              detection_source: 'heuristic',
              rule_id: 'default-name-digits',
              detection_reason: '启发式：默认名 + 随机数字',
            },
          ],
        }),
      }),
      env,
    );
    expect(res.status).toBe(200);

    const audit = (await (await adminFetch('/admin/false-positives', { token: ADMIN })).json()) as {
      summary: Array<{ detection_source: string; rule_id: string; count: number }>;
      false_positives: Array<Record<string, unknown>>;
    };
    expect(audit.summary).toContainEqual({
      detection_source: 'heuristic',
      rule_id: 'default-name-digits',
      count: 1,
    });
    expect(audit.false_positives[0]).toMatchObject({
      handle: 'legituser88',
      detection_source: 'heuristic',
      rule_id: 'default-name-digits',
      client_version: '0.7.1',
    });
    expect(audit.false_positives[0]).not.toHaveProperty('installation_id');
  });
});
