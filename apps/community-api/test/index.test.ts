import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';

const ORIGIN = 'https://api.example.com';

describe('GET /healthz', () => {
  it('returns ok + service name', async () => {
    const response = await worker.fetch(new Request(`${ORIGIN}/healthz`), env);
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      ok: boolean;
      service: string;
      time: string;
    };
    expect(body.ok).toBe(true);
    expect(body.service).toBe('feedsieve-community-api');
    expect(Number.isNaN(Date.parse(body.time))).toBe(false);
  });
});

describe('unknown routes', () => {
  it('responds 404 json', async () => {
    const response = await worker.fetch(new Request(`${ORIGIN}/nope`), env);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });
  });
});

describe('D1 storage', () => {
  it('migrations applied — accounts table roundtrip', async () => {
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      `INSERT INTO accounts
         (handle, x_user_id, category, status, report_count, first_report_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
       ON CONFLICT(handle) DO NOTHING`,
    )
      .bind('roundtrip_user', '123', 'bot_spam', 'candidate', 1, now)
      .run();

    const row = await env.DB.prepare(
      'SELECT handle, status FROM accounts WHERE handle = ?1',
    )
      .bind('roundtrip_user')
      .first<{ handle: string; status: string }>();
    expect(row?.handle).toBe('roundtrip_user');
    expect(row?.status).toBe('candidate');
  });
});
