import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';
import { sql, type SQL } from 'drizzle-orm';
import { getDb } from '../src/db/client';
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

async function first<T extends Record<string, unknown>>(query: SQL): Promise<T | null> {
  const [row] = await getDb(env).execute<T>(query);
  return (row ?? null) as T | null;
}

async function account(handle: string) {
  return first<{ status: string; report_count: number; rescue_count: number; category: string }>(
    sql`SELECT status, report_count, rescue_count, category FROM accounts WHERE handle = ${handle}`,
  );
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
      await first<{ label: string }>(
        sql`SELECT label FROM active_labels WHERE installation_id = ${installHash} AND handle = ${handle}`,
      ),
    ).toEqual({ label: 'allowed' });
    expect(
      await first<{ reports: number; rescues: number }>(
        sql`SELECT
             (SELECT COUNT(*) FROM reports WHERE installation_id = ${installHash} AND handle = ${handle}) AS reports,
             (SELECT COUNT(*) FROM rescues WHERE installation_id = ${installHash} AND handle = ${handle}) AS rescues`,
      ),
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
      await first<{ n: number }>(sql`SELECT COUNT(*) AS n FROM reports WHERE handle = ${handle}`),
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
      await first<Record<string, unknown>>(
        sql`SELECT reason, content_fingerprint, link_domains FROM reports WHERE handle = ${handle}`,
      ),
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

describe('撤回每日配额', () => {
  it('达到每日撤回上限后返回 429，未触顶的撤回不受影响', async () => {
    const installationId = 'retract-cap-0001-aaaaaaaa';
    const handle = 'retract_cap';
    await post('/v1/reports', {
      installation_id: installationId,
      reports: [{ handle, reason: 'bot_spam' }],
    });

    // 预置：当日配额已用满
    const installHash = await hashInstallationId(env.INSTALLATION_SALT, installationId);
    const today = new Date().toISOString().slice(0, 10);
    const nowSec = Math.floor(Date.now() / 1000);
    await getDb(env).execute(sql`
      INSERT INTO installations (id, first_seen_at, last_seen_at, retracts_day, retracts_today)
      VALUES (${installHash}, ${nowSec}, ${nowSec}, ${today}, 50)
      ON CONFLICT(id) DO UPDATE SET retracts_day = excluded.retracts_day, retracts_today = 50`);

    const capped = await worker.fetch(
      new Request(`${ORIGIN}/v1/labels/retract`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ installation_id: installationId, handles: [handle] }),
      }),
      env,
    );
    expect(capped.status).toBe(429);
    expect(((await capped.json()) as Record<string, unknown>).error).toBe('rate_limited');
    // 拒绝时不落撤回：标签仍在
    const label = await first(
      sql`SELECT 1 AS present FROM active_labels WHERE installation_id = ${installHash} AND handle = ${handle}`,
    );
    expect(label).not.toBeNull();

    // 重置配额后同一撤回成功
    await getDb(env).execute(
      sql`UPDATE installations SET retracts_today = 0 WHERE id = ${installHash}`,
    );
    const ok = await post('/v1/labels/retract', {
      installation_id: installationId,
      handles: [handle],
    });
    expect(ok.results).toEqual([{ handle, status: 'retracted' }]);
  });

  it('对无标签 handle 的空撤回不消耗配额（重试幂等）', async () => {
    const installationId = 'retract-cap-0002-bbbbbbbb';
    const nowSec = Math.floor(Date.now() / 1000);
    await getDb(env).execute(sql`
      INSERT INTO installations (id, first_seen_at, last_seen_at, retracts_day, retracts_today)
      VALUES (${await hashInstallationId(env.INSTALLATION_SALT, installationId)}, ${nowSec}, ${nowSec},
              ${new Date().toISOString().slice(0, 10)}, 50)`);
    const res = await post('/v1/labels/retract', {
      installation_id: installationId,
      handles: ['never_reported'],
    });
    expect(res.results).toEqual([{ handle: 'never_reported', status: 'absent' }]);
  });
});
