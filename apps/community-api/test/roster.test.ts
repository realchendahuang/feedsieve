import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';
import { generateSnapshot } from '../src/snapshot';
import { MAINTAINER_WHITELIST_UPSERT_SQL } from '../src/maintainer-whitelist';

const ORIGIN = 'https://api.example.com';

async function report(installationId: string, handle: string, extra: Record<string, unknown> = {}) {
  const res = await worker.fetch(
    new Request(`${ORIGIN}/v1/reports`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        installation_id: installationId,
        reports: [{ handle, reason: 'bot_spam', ...extra }],
      }),
    }),
    env,
  );
  expect(res.status).toBe(200);
}

async function rescue(installationId: string, handle: string) {
  const res = await worker.fetch(
    new Request(`${ORIGIN}/v1/rescues`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        installation_id: installationId,
        rescues: [{ handle }],
      }),
    }),
    env,
  );
  expect(res.status).toBe(200);
}

interface RosterEntry {
  handle: string;
  category: string;
  sources: string[];
  net_votes: number;
}

interface RosterResponse {
  snapshot_version: string;
  generated_at: string;
  signed: boolean;
  blacklist: { count: number; entries: RosterEntry[] };
  whitelist: {
    maintained: { handle: string; note: string; added_at: string }[];
    verified: { handle: string; net_votes: number }[];
  };
}

describe('GET /v1/roster/latest（官网名单公示）', () => {
  it('无快照 → 404 no_snapshot', async () => {
    const res = await worker.fetch(new Request(`${ORIGIN}/v1/roster/latest`), env);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no_snapshot' });
  });

  it('黑名单、推荐白名单与社区抢救（verified）全部进入公示面', async () => {
    // 社区黑名单条目：净票达标（3 票），外加一条证据帖与一个外链域名
    for (let i = 1; i <= 3; i++) await report(`roster-000${i}-4000-8000-aaaaaaaaaaaa`, 'spam_user');
    await report('roster-0004-4000-8000-aaaaaaaaaaaa', 'spam_user', {
      evidence_post_id: '18000000000000000',
      link_domains: ['shady-promo.example'],
    });
    // 证据明细需 ≥2 独立安装上报才随快照携带，补一条独立安装
    await report('roster-0005-4000-8000-aaaaaaaaaaaa', 'spam_user', {
      evidence_post_id: '18000000000000000',
    });
    // 社区抢救条目（verified）：先有一次误标票建行，再凑抢救净票 >= 3
    await report('roster-1000-4000-8000-bbbbbbbbbbbb', 'rescued_user');
    for (let i = 1; i <= 4; i++) await rescue(`roster-100${i}-4000-8000-bbbbbbbbbbbb`, 'rescued_user');
    // 推荐白名单（博主宣言）
    await env.DB.prepare(MAINTAINER_WHITELIST_UPSERT_SQL)
      .bind('good_user', null, null, null, '本人宣言：不刷屏不引流', Math.floor(Date.now() / 1000))
      .run();

    await generateSnapshot(env, 0, { bypassDailyOnce: true });

    const res = await worker.fetch(new Request(`${ORIGIN}/v1/roster/latest`), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=300');
    const roster = (await res.json()) as RosterResponse;

    expect(roster.snapshot_version).toMatch(/^\d{4}\.\d{2}\.\d{2}\.\d{1,4}$/);
    expect(roster.generated_at).toBeTruthy();
    // 测试环境配置了签名私钥（与 snapshot.test.ts 同一部署面）→ 公示徽章如实展示已签名
    expect(roster.signed).toBe(true);

    const spam = roster.blacklist.entries.find((entry) => entry.handle === 'spam_user');
    expect(spam).toMatchObject({ net_votes: 5, sources: ['community'] });
    expect(roster.blacklist.count).toBeGreaterThanOrEqual(1);

    // 证据明细随快照进公示面
    const detail = roster.blacklist.entries.find((entry) => entry.handle === 'spam_user') as unknown as Record<
      string,
      unknown
    >;
    expect(detail.evidence_post_ids).toEqual(['18000000000000000']);

    const maintained = roster.whitelist.maintained.find((entry) => entry.handle === 'good_user');
    expect(maintained).toMatchObject({ note: '本人宣言：不刷屏不引流' });
    expect(roster.whitelist.verified.find((entry) => entry.handle === 'rescued_user')).toMatchObject({
      net_votes: 3,
    });
  });

  it('公示面公开证据明细（evidence_post_ids / domains / aliases），指纹永不外泄', async () => {
    const res = await worker.fetch(new Request(`${ORIGIN}/v1/roster/latest`), env);
    const roster = (await res.json()) as RosterResponse & { blacklist: { entries: Record<string, unknown>[] } };
    for (const entry of roster.blacklist.entries) {
      expect(entry.fingerprints).toBeUndefined();
    }
  });
});
