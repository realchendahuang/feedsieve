import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';
import { hashInstallationId } from '../src/lib/hash';
import { POLICY, effectiveDailyLimit } from '../src/reports';

const ORIGIN = 'https://api.example.com';

async function postReports(installationId: string, handles: string[]): Promise<Response> {
  return worker.fetch(
    new Request(`${ORIGIN}/v1/reports`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        installation_id: installationId,
        reports: handles.map((handle) => ({ handle, reason: 'bot_spam' })),
      }),
    }),
    env,
  );
}

async function installTrust(raw: string): Promise<number | undefined> {
  const hash = await hashInstallationId(env.INSTALLATION_SALT, raw);
  const row = await env.DB.prepare('SELECT trust FROM installations WHERE id = ?1')
    .bind(hash)
    .first<{ trust: number }>();
  return row?.trust;
}

describe('reporter trust', () => {
  it('effective limit math', () => {
    expect(effectiveDailyLimit(POLICY.dailyReportLimit, 1)).toBe(100);
    expect(effectiveDailyLimit(POLICY.dailyReportLimit, 0.5)).toBe(50);
    // 低信任夹在下限
    expect(effectiveDailyLimit(POLICY.dailyReportLimit, 0.05)).toBe(
      POLICY.minDailyLimit,
    );
  });

  it('trust decays once when a day crosses the burst threshold', async () => {
    const raw = 'trust-burst-installation-0001';
    // 29 票（500 上限内分两批）→ 未越线
    expect((await postReports(raw, Array.from({ length: 29 }, (_, i) => `b_${i}`))).status).toBe(200);
    expect(await installTrust(raw)).toBe(1);

    // 第 30 票越线 → 衰减一档
    expect((await postReports(raw, ['burst_cross'])).status).toBe(200);
    expect(await installTrust(raw)).toBe(0.9);

    // 继续上报不再重复衰减（已在线上）
    expect((await postReports(raw, ['burst_more'])).status).toBe(200);
    expect(await installTrust(raw)).toBe(0.9);
  });

  it('low trust tightens the daily limit', async () => {
    const raw = 'trust-low-installation-00001';
    const hash = await hashInstallationId(env.INSTALLATION_SALT, raw);
    const today = new Date().toISOString().slice(0, 10);
    // trust 0.5 → 限额 50；先注满 50
    await env.DB.prepare(
      'INSERT INTO installations (id, first_seen_at, last_seen_at, reports_day, reports_today, trust) VALUES (?1, ?2, ?2, ?3, 50, 0.5)',
    )
      .bind(hash, Math.floor(Date.now() / 1000), today)
      .run();

    const res = await postReports(raw, ['capped_handle']);
    expect(res.status).toBe(429);
  });
});
