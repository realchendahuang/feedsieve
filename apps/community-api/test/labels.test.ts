import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';
import { hashInstallationId } from '../src/lib/hash';

const ORIGIN = 'https://api.example.com';

async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
  const response = await worker.fetch(
    new Request(`${ORIGIN}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    env,
  );
  expect(response.status).toBe(200);
  return (await response.json()) as Record<string, unknown>;
}

async function account(handle: string) {
  return env.DB.prepare(
    'SELECT status, report_count, rescue_count, category FROM accounts WHERE handle = ?1',
  )
    .bind(handle)
    .first<{ status: string; report_count: number; rescue_count: number; category: string }>();
}

describe('active labels（每安装每账号只保留最后判断）', () => {
  it('同一安装可在拉黑与白名单之间改判，原始证据仍保留', async () => {
    const installationId = 'labels-switch-0001-aaaaaaaa';
    const handle = 'switch_me';
    await post('/v1/reports', {
      installation_id: installationId,
      reports: [{ handle, reason: 'bot_spam' }],
    });
    expect(await account(handle)).toMatchObject({ report_count: 1, rescue_count: 0 });

    await post('/v1/rescues', {
      installation_id: installationId,
      rescues: [
        {
          handle,
          detection_source: 'heuristic',
          rule_id: 'default-name-digits',
          detection_reason: '正常创作者被默认数字名规则误标',
        },
      ],
    });
    expect(await account(handle)).toMatchObject({
      status: 'new',
      report_count: 0,
      rescue_count: 1,
    });

    const installHash = await hashInstallationId(env.INSTALLATION_SALT, installationId);
    expect(
      await env.DB.prepare(
        'SELECT label FROM active_labels WHERE installation_id = ?1 AND handle = ?2',
      )
        .bind(installHash, handle)
        .first<{ label: string }>(),
    ).toEqual({ label: 'allowed' });
    expect(
      await env.DB.prepare(
        `SELECT
             (SELECT COUNT(*) FROM reports WHERE installation_id = ?1 AND handle = ?2) AS reports,
             (SELECT COUNT(*) FROM rescues WHERE installation_id = ?1 AND handle = ?2) AS rescues`,
      )
        .bind(installHash, handle)
        .first<{ reports: number; rescues: number }>(),
    ).toEqual({ reports: 1, rescues: 1 });

    const result = await post('/v1/reports', {
      installation_id: installationId,
      reports: [{ handle, reason: 'bot_spam' }],
    });
    expect(result.results).toEqual([{ handle, status: 'recorded' }]);
    expect(await account(handle)).toMatchObject({ report_count: 1, rescue_count: 0 });
  });

  it('账号尚未建档时的白名单票会保留，并在以后出现正票时立即参与评级', async () => {
    const handle = 'safe_first';
    await post('/v1/rescues', {
      installation_id: 'labels-allow-0001-bbbbbbbb',
      rescues: [{ handle }],
    });
    expect(await account(handle)).toBeNull();

    await post('/v1/reports', {
      installation_id: 'labels-block-0001-cccccccc',
      reports: [{ handle, reason: 'other' }],
    });
    expect(await account(handle)).toMatchObject({
      status: 'new',
      report_count: 1,
      rescue_count: 1,
    });
  });

  it('本地名单删除会撤回当前票，但不会删除审计证据', async () => {
    const installationId = 'labels-retract-0001-dddddddd';
    const handle = 'retract_me';
    await post('/v1/reports', {
      installation_id: installationId,
      reports: [{ handle, reason: 'copy_paste' }],
    });
    const body = await post('/v1/labels/retract', {
      installation_id: installationId,
      handles: [handle],
    });
    expect(body.results).toEqual([{ handle, status: 'retracted' }]);
    expect(await account(handle)).toMatchObject({
      status: 'new',
      report_count: 0,
      rescue_count: 0,
    });
    expect(
      await env.DB.prepare('SELECT COUNT(*) AS n FROM reports WHERE handle = ?1')
        .bind(handle)
        .first<{ n: number }>(),
    ).toEqual({ n: 1 });
  });

  it('同标签重传会更新分类与证据，但不会重复计票', async () => {
    const installationId = 'labels-evidence-0001-eeeeeeee';
    const handle = 'better_evidence';
    await post('/v1/reports', {
      installation_id: installationId,
      reports: [{ handle, reason: 'bot_spam' }],
    });
    const result = await post('/v1/reports', {
      installation_id: installationId,
      reports: [
        {
          handle,
          reason: 'copy_paste',
          content_fingerprint: '0123456789abcdef',
          link_domains: ['spam.example'],
        },
      ],
    });
    expect(result.results).toEqual([{ handle, status: 'duplicate' }]);
    expect(await account(handle)).toMatchObject({
      report_count: 1,
      rescue_count: 0,
      category: 'copy_paste',
    });
    expect(
      await env.DB.prepare(
        'SELECT reason, content_fingerprint, link_domains FROM reports WHERE handle = ?1',
      )
        .bind(handle)
        .first<Record<string, unknown>>(),
    ).toMatchObject({
      reason: 'copy_paste',
      content_fingerprint: '0123456789abcdef',
      link_domains: '["spam.example"]',
    });
  });

  it('账号改名归并后，按新 handle 删除本地记录仍能撤回 canonical 票', async () => {
    const xUserId = '9988776655';
    await post('/v1/reports', {
      installation_id: 'labels-alias-a-0001-ffffffff',
      reports: [{ handle: 'old_handle', x_user_id: xUserId, reason: 'other' }],
    });
    const aliasInstall = 'labels-alias-b-0001-gggggggg';
    await post('/v1/reports', {
      installation_id: aliasInstall,
      reports: [{ handle: 'new_handle', x_user_id: xUserId, reason: 'other' }],
    });
    expect(await account('old_handle')).toMatchObject({ report_count: 2 });

    const body = await post('/v1/labels/retract', {
      installation_id: aliasInstall,
      handles: ['new_handle'],
    });
    expect(body.results).toEqual([{ handle: 'new_handle', status: 'retracted' }]);
    expect(await account('old_handle')).toMatchObject({ report_count: 1 });
  });
});
