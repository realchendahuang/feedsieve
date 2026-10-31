import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import worker from '../src/index';
import { getDb } from '../src/db/client';
import { accounts } from '../src/db/schema';

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

describe('PostgreSQL storage', () => {
  it('migrations applied — accounts table roundtrip', async () => {
    const now = Math.floor(Date.now() / 1000);
    const db = getDb(env);
    await db
      .insert(accounts)
      .values({
        handle: 'roundtrip_user',
        xUserId: '123',
        category: 'bot_spam',
        status: 'candidate',
        reportCount: 1,
        firstReportAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();

    const [row] = await db
      .select({ handle: accounts.handle, status: accounts.status })
      .from(accounts)
      .where(eq(accounts.handle, 'roundtrip_user'));
    expect(row?.handle).toBe('roundtrip_user');
    expect(row?.status).toBe('candidate');
  });
});
