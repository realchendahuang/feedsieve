import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';
import { hashInstallationId, hashIp } from '../src/lib/hash';
import { sql, type SQL } from 'drizzle-orm';
import { getDb } from '../src/db/client';

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

async function first<T extends Record<string, unknown>>(query: SQL): Promise<T | null> {
  const [row] = await getDb(env).execute<T>(query);
  return (row ?? null) as T | null;
}

async function accountRow(handle: string) {
  return first<{ status: string; report_count: number; category: string }>(
    sql`SELECT status, report_count, category FROM accounts WHERE handle = ${handle}`,
  );
}

describe('POST /v1/reports', () => {
  it('records a valid report and hashes the installation id', async () => {
    const raw = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
    const result = await postOne(raw, '@Spam_User');

    expect(result!.status).toBe('recorded');

    const account = await accountRow('spam_user');
    expect(account?.report_count).toBe(1);
    expect(account?.status).toBe('new');
    expect(account?.category).toBe('bot_spam');

    const stored = await first<{ installation_id: string }>(
      sql`SELECT installation_id FROM reports WHERE handle = ${'spam_user'}`,
    );
    const expectedHash = await hashInstallationId(env.INSTALLATION_SALT, raw);
    expect(stored?.installation_id).toBe(expectedHash);
    expect(stored?.installation_id).not.toContain(raw);
  });

  it('dedupes the same installation reporting the same handle', async () => {
    const id = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
    expect((await postOne(id, 'dup_user'))!.status).toBe('recorded');
    expect((await postOne(id, 'dup_user'))!.status).toBe('duplicate');

    const account = await accountRow('dup_user');
    expect(account?.report_count).toBe(1);
  });

  it('uses one threshold only: net 2 stays out, net 3 enters', async () => {
    await postOne('cccccccc-3333-4333-8333-cccccccccccc', 'thresh_user');
    await postOne('dddddddd-4444-4444-8444-dddddddddddd', 'thresh_user');
    const account = await accountRow('thresh_user');
    expect(account?.status).toBe('new');
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
    expect(body.results[0]!.status).toBe('recorded');
    expect(body.results[1]!.status).toBe('rejected');
    expect(body.results[1]!.error).toBe('invalid_handle');
    expect(body.results[2]!.error).toBe('invalid_reason');
    expect(body.results[3]!.error).toBe('invalid_x_user_id');
  });

  it('stores detection_source and rejects unknown sources', async () => {
    const res = await post({
      installation_id: 'iiiiiiii-9999-4999-8999-iiiiiiiiiiii',
      reports: [
        report('src_manual', { detection_source: 'manual' }),
        report('src_keyword', { detection_source: 'heuristic' }),
        report('src_bad', { detection_source: 'telepathy' }),
      ],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: { status: string; error?: string }[] };
    expect(body.results[0]!.status).toBe('recorded');
    expect(body.results[1]!.status).toBe('recorded');
    expect(body.results[2]!.status).toBe('rejected');
    expect(body.results[2]!.error).toBe('invalid_detection_source');

    const stored = await first<{ detection_source: string }>(
      sql`SELECT detection_source FROM reports WHERE handle = ${'src_manual'}`,
    );
    expect(stored?.detection_source).toBe('manual');
    const absent = await first(sql`SELECT 1 AS present FROM reports WHERE handle = ${'src_bad'}`);
    expect(absent).toBeNull();
  });

  it('stores rule and structured signal ids and rejects malformed evidence', async () => {
    const res = await post({
      installation_id: 'rrrrrrrr-1111-4111-8111-rrrrrrrrrrrr',
      reports: [
        report('rule_ok', {
          detection_source: 'heuristic',
          rule_id: 'keyword:official:adult-local-door-hookup',
          signal_ids: ['keyword:official:adult-local-door-hookup', 'weak-signal-combo'],
        }),
        report('rule_bad', { rule_id: 'contains spaces' }),
        report('signals_bad', { signal_ids: ['ok', 42] }),
      ],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: { status: string; error?: string }[] };
    expect(body.results.map((item) => [item.status, item.error])).toEqual([
      ['recorded', undefined],
      ['rejected', 'invalid_rule_id'],
      ['rejected', 'invalid_signal_ids'],
    ]);

    const stored = await first<{ rule_id: string; signal_ids: string }>(
      sql`SELECT rule_id, signal_ids FROM reports WHERE handle = ${'rule_ok'}`,
    );
    expect(stored?.rule_id).toBe('keyword:official:adult-local-door-hookup');
    expect(JSON.parse(stored?.signal_ids ?? '[]')).toEqual([
      'keyword:official:adult-local-door-hookup',
      'weak-signal-combo',
    ]);
  });

  it('stores evidence facts (tweet text / display name / bio) and enforces shape caps', async () => {
    const res = await post({
      installation_id: 'ffffffff-5555-4555-8555-ffffffffffff',
      reports: [
        report('facts_ok', {
          tweet_text: '领福利加微 xxx',
          display_name: '福利姐',
          bio: ' punt ',
        }),
        ...Array.from({ length: 10 }, (_, i) =>
          report(`facts_long_${i}`, { tweet_text: '长'.repeat(501) }),
        ),
        report('facts_none'),
      ],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: { status: string; error?: string }[] };
    expect(body.results[0]!.status).toBe('recorded');
    for (let i = 1; i <= 10; i += 1) {
      expect(body.results[i]!.status).toBe('rejected');
      expect(body.results[i]!.error).toBe('invalid_tweet_text');
    }
    expect(body.results[11]!.status).toBe('recorded');

    const stored = await first<{ tweet_text: string; display_name: string; bio: string }>(
      sql`SELECT tweet_text, display_name, bio FROM reports WHERE handle = ${'facts_ok'}`,
    );
    expect(stored?.tweet_text).toBe('领福利加微 xxx');
    expect(stored?.display_name).toBe('福利姐');
    expect(stored?.bio).toBe('punt');

    const empty = await first<{ tweet_text: string | null }>(
      sql`SELECT tweet_text FROM reports WHERE handle = ${'facts_none'}`,
    );
    expect(empty?.tweet_text).toBeNull();
  });

  it('strips U+0000 from free text before storing (PostgreSQL text rejects NUL)', async () => {
    const res = await post({
      installation_id: 'abababab-6666-4666-8666-abababababab',
      client_version: '0.2\u0000.0',
      reports: [
        report('nul_ok', {
          tweet_text: '领福利\u0000加微\u0000 xxx',
          display_name: '福\u0000利姐',
          bio: 'a\u0000b',
        }),
        report('nul_only', { tweet_text: '\u0000\u0000' }),
      ],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: { status: string; error?: string }[] };
    expect(body.results[0]!.status).toBe('recorded');
    // 去掉 NUL 后为空的文本与纯空白一样按非法拒收
    expect(body.results[1]).toMatchObject({ status: 'rejected', error: 'invalid_tweet_text' });

    const stored = await first<{
      tweet_text: string;
      display_name: string;
      bio: string;
      client_version: string;
    }>(
      sql`SELECT tweet_text, display_name, bio, client_version FROM reports WHERE handle = ${'nul_ok'}`,
    );
    expect(stored?.tweet_text).toBe('领福利加微 xxx');
    expect(stored?.display_name).toBe('福利姐');
    expect(stored?.bio).toBe('ab');
    expect(stored?.client_version).toBe('0.2.0');
  });

  it('envelopes: bad body / empty array / oversized batch', async () => {
    expect((await post({ reports: [] })).status).toBe(400);
    expect((await post({ installation_id: 'short', reports: [report('x')] })).status).toBe(400);
    expect((await post('not-an-object')).status).toBe(400);

    const many = Array.from({ length: 51 }, (_, i) => report(`user_${i}`));
    expect(
      (await post({ installation_id: 'gggggggg-7777-4777-8777-gggggggggggg', reports: many }))
        .status,
    ).toBe(413);
  });

  it('rate-limits an installation over the daily limit', async () => {
    const raw = 'hhhhhhhh-8888-4888-8888-hhhhhhhhhhhh';
    const installHash = await hashInstallationId(env.INSTALLATION_SALT, raw);
    const today = new Date().toISOString().slice(0, 10);
    const nowSec = Math.floor(Date.now() / 1000);
    await getDb(env).execute(sql`
      INSERT INTO installations (id, first_seen_at, last_seen_at, reports_day, reports_today)
      VALUES (${installHash}, ${nowSec}, ${nowSec}, ${today}, 100)`);

    const res = await post({
      installation_id: raw,
      reports: [report('capped_user')],
    });
    expect(res.status).toBe(429);
  });

  it('rate-limits a client IP over the daily limit even with fresh installation ids', async () => {
    const ip = '203.0.113.77';
    const today = new Date().toISOString().slice(0, 10);
    const ipHash = await hashIp(env.INSTALLATION_SALT, ip);
    await getDb(env).execute(
      sql`INSERT INTO ip_usage (ip_hash, day, reports_today) VALUES (${ipHash}, ${today}, 200)`,
    );

    const res = await worker.fetch(
      new Request(`${ORIGIN}/v1/reports`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
        body: JSON.stringify({
          installation_id: 'sybil-aaaa-4000-8000-aaaaaaaaaaa1',
          reports: [report('sybil_user')],
        }),
      }),
      env,
    );
    expect(res.status).toBe(429);
    // 未配 IP 头（或本地 curl）不受 IP 门影响，安装配额仍生效
    const noIp = await post({
      installation_id: 'sybil-aaaa-4000-8000-aaaaaaaaaaa2',
      reports: [report('sybil_user')],
    });
    expect(noIp.status).toBe(200);
  });

  it('keeps per-item outcomes inside one batch: intra-batch duplicate, alias fold-in, invalid item', async () => {
    // 正主 batch_mix_canon 带 x_user_id 555
    expect((await postOne('batchmix-aaa1-4000-8000-aaaaaaaaaaa1', 'batch_mix_canon'))!.status).toBe(
      'recorded',
    );
    await getDb(env).execute(
      sql`UPDATE accounts SET x_user_id = '555' WHERE handle = 'batch_mix_canon'`,
    );

    const res = await post({
      installation_id: 'batchmix-aaa2-4000-8000-aaaaaaaaaaa2',
      reports: [
        report('batch_mix_new'),
        report('batch_mix_new'), // 批内同安装同 handle → duplicate（不重复计票）
        report('batch_mix_ren', { x_user_id: '555' }), // 换号 → 票计正主
        report('bad handle!'),
      ],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: { status: string; error?: string }[] };
    expect(body.results.map((r) => r.status)).toEqual([
      'recorded',
      'duplicate',
      'recorded',
      'rejected',
    ]);
    expect(body.results[3]!.error).toBe('invalid_handle');

    // 新 handle 建档且只计 1 票；正主 2 票；新 handle 进别名；不产生独立换号账号
    expect((await accountRow('batch_mix_new'))?.report_count).toBe(1);
    expect((await accountRow('batch_mix_canon'))?.report_count).toBe(2);
    expect(await accountRow('batch_mix_ren')).toBeNull();
    const aliases = await first<{ aliases: string }>(
      sql`SELECT aliases FROM accounts WHERE handle = ${'batch_mix_canon'}`,
    );
    expect(JSON.parse(aliases?.aliases ?? '[]')).toContain('batch_mix_ren');
  });

  it('alias creation is capped per installation per day; the vote still lands on the canonical handle', async () => {
    // 正主：老账号带 x_user_id 777
    expect((await postOne('alias-cap-aaa-4000-8000-aaaaaaaaaaa1', 'alias_cap_old'))!.status).toBe(
      'recorded',
    );
    await getDb(env).execute(
      sql`UPDATE accounts SET x_user_id = '777' WHERE handle = 'alias_cap_old'`,
    );

    // 新安装的别名配额已用满
    const installerHash = await hashInstallationId(
      env.INSTALLATION_SALT,
      'alias-cap-aaa-4000-8000-aaaaaaaaaaa2',
    );
    const today = new Date().toISOString().slice(0, 10);
    const nowSec = Math.floor(Date.now() / 1000);
    await getDb(env).execute(sql`
      INSERT INTO installations (id, first_seen_at, last_seen_at, aliases_day, aliases_today)
      VALUES (${installerHash}, ${nowSec}, ${nowSec}, ${today}, 10)`);

    const res = await post({
      installation_id: 'alias-cap-aaa-4000-8000-aaaaaaaaaaa2',
      reports: [report('alias_cap_new', { x_user_id: '777' })],
    });
    expect(res.status).toBe(200);

    // 票计入正主，但超出配额的新别名不写入
    const account = await accountRow('alias_cap_old');
    expect(account?.report_count).toBe(2);
    expect(await accountRow('alias_cap_new')).toBeNull();
    const aliases = await first<{ aliases: string }>(
      sql`SELECT aliases FROM accounts WHERE handle = ${'alias_cap_old'}`,
    );
    expect(JSON.parse(aliases?.aliases ?? '[]')).not.toContain('alias_cap_new');

    // 配额内的别名仍正常写入（另一个新安装，未预置配额行）
    expect((await postOne('alias-cap-aaa-4000-8000-aaaaaaaaaaa3', 'alias_cap_later'))!.status).toBe(
      'recorded',
    );
    await post({
      installation_id: 'alias-cap-aaa-4000-8000-aaaaaaaaaaa3',
      reports: [report('alias_cap_extra', { x_user_id: '777' })],
    });
    const later = await first<{ aliases: string }>(
      sql`SELECT aliases FROM accounts WHERE handle = ${'alias_cap_old'}`,
    );
    expect(JSON.parse(later?.aliases ?? '[]')).toContain('alias_cap_extra');
  });
});

describe('CORS preflight', () => {
  it('answers OPTIONS for cross-origin posts', async () => {
    const res = await worker.fetch(new Request(`${ORIGIN}/v1/reports`, { method: 'OPTIONS' }), env);
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});
