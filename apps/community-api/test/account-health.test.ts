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

  it('kill-report 的 dead 只落 unknown 待复核（单笔上报不锁终态）；之后 alive 上报合理翻转 pending', async () => {
    await reportWithLiveness('inst-dead', 'dead_user_1', 'dead');
    const first = await readHealth('dead_user_1');
    // 2026-09-12 收口：单笔客户端 dead 上报即终态 = 一次上报永久拉黑健康记录，
    // 改为落 unknown + kill-report 来源，由 cron-prober 的待复核队列服务端重验。
    expect(first?.state).toBe('unknown');
    expect(first?.source).toBe('kill-report');
    expect(first?.terminal_checked_at).toBeNull();

    // 其它安装带来一次真正的探活（kill 时刻确诊存活）可以翻转 pending——
    // 两笔互相独立的上报互相制衡，谁都不能单独把记录钉死。
    await reportWithLiveness('inst-live-different', 'dead_user_1', 'alive');
    const after = await readHealth('dead_user_1');
    expect(after?.state).toBe('alive');
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
