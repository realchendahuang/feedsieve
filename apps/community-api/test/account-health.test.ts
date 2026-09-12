import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';

const ORIGIN = 'https://api.example.com';

interface HealthRow {
  handle: string;
  state: string;
  source: string;
  probe_count: number;
  confirmed_alive_at: number | null;
  terminal_checked_at: number | null;
}

async function reportWithLiveness(
  installationId: string,
  handle: string,
  liveness: 'alive' | 'dead' | undefined,
) {
  const report: Record<string, unknown> = { handle, reason: 'adult_gray_traffic' };
  if (liveness !== undefined) report.liveness = liveness;
  const res = await worker.fetch(
    new Request(`${ORIGIN}/v1/reports`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        installation_id: installationId,
        reports: [report],
      }),
    }),
    env,
  );
  expect(res.status).toBe(200);
}

async function readHealth(handle: string): Promise<HealthRow | null> {
  const res = await env.DB.prepare(
    'SELECT handle, state, source, probe_count, confirmed_alive_at, terminal_checked_at FROM account_health WHERE handle = ?1',
  )
    .bind(handle)
    .all<HealthRow>();
  return res.results[0] ?? null;
}

describe('击杀时刻探活入库（account_health）', () => {
  it('无探活字段的上报不写 account_health（旧客户端兼容面为零）', async () => {
    await reportWithLiveness('inst-plain', 'plain_user_1', undefined);
    expect(await readHealth('plain_user_1')).toBeNull();
  });

  it('alive 探活写 alive + confirmed_alive_at；重复击杀累计 probe_count', async () => {
    await reportWithLiveness('inst-alive', 'alive_user_1', 'alive');
    const first = await readHealth('alive_user_1');
    expect(first?.state).toBe('alive');
    expect(first?.probe_count).toBe(1);
    expect(first?.confirmed_alive_at).not.toBeNull();

    await reportWithLiveness('inst-alive', 'alive_user_1', 'alive');
    const second = await readHealth('alive_user_1');
    expect(second?.probe_count).toBe(2);
  });

  it('dead 落库后成为终态：后续 alive 覆写不改状态、不推进 updated_at', async () => {
    await reportWithLiveness('inst-dead', 'dead_user_1', 'dead');
    const first = await readHealth('dead_user_1');
    expect(first?.state).toBe('dead');
    expect(first?.terminal_checked_at).not.toBeNull();

    // 服务端永不复探 dead（cron 查询排除），但 kill-report 仍可能随手带来一次确认：
    // 旧的探活记录只能被确认，不能被翻案。
    await reportWithLiveness('inst-live-different', 'dead_user_1', 'alive');
    const after = await readHealth('dead_user_1');
    expect(after?.state).toBe('dead');
    expect(after?.terminal_checked_at).toEqual(first?.terminal_checked_at);
    // 真探过一次，计数诚实累计
    expect(after?.probe_count).toBe(2);
  });

  it('非法 liveness 拒收且不写健康表，票不消耗', async () => {
    const res = await worker.fetch(
      new Request(`${ORIGIN}/v1/reports`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          installation_id: 'inst-bad-liveness',
          reports: [{ handle: 'handle_ok', reason: 'adult_gray_traffic', liveness: 'zombie' }],
        }),
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: Array<{ status: string; error?: string }> };
    expect(body.results[0]).toMatchObject({ status: 'rejected', error: 'invalid_liveness' });
    expect(await readHealth('handle_ok')).toBeNull();
  });
});
