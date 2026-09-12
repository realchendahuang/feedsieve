import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { probeAccountHealthScheduled } from '../src/prober';

/** UserByScreenName 客户端模拟：activate 发 token，正文按 handle 分四类结果 */
function stubXResponses(input: Request | string): Response {
  const url = new URL(String(input));
  if (url.pathname.endsWith('/guest/activate.json')) {
    return new Response(JSON.stringify({ guest_token: 'guest-token-1' }), { status: 200 });
  }
  const screenName =
    decodeURIComponent(url.searchParams.get('variables') ?? '').match(
      /"screen_name":"([^"]+)"/,
    )?.[1] ?? '';
  if (screenName === 'probe_alive') {
    return new Response(
      JSON.stringify({ data: { user: { result: { __typename: 'User', rest_id: '987654' } } } }),
      { status: 200 },
    );
  }
  if (screenName === 'probe_dead') {
    return new Response(
      JSON.stringify({ data: { user: { result: { __typename: 'UserUnavailable' } } } }),
      { status: 200 },
    );
  }
  if (screenName === 'probe_ratelimited') {
    return new Response(JSON.stringify({ errors: [{ code: 88, message: 'Rate limit exceeded' }] }), {
      status: 200,
    });
  }
  // 未预期的 handle：形状异常（既非 User 也非 Unavailable）——服务端必须判 unknown
  return new Response(JSON.stringify({ data: {} }), { status: 200 });
}

async function clearProbeState(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM account_health'),
    env.DB.prepare('DELETE FROM consensus_events'),
    env.DB.prepare("DELETE FROM meta WHERE key = 'account_health_probe'"),
  ]);
}

async function insertHealth(handle: string, state: string, updatedAt: number): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO account_health (handle, state, source, probe_count, updated_at) VALUES (?1, ?2, ?3, 0, ?4)',
  )
    .bind(handle, state, 'kill-report', updatedAt)
    .run();
}

async function seedConsensus(handle: string): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO consensus_events (handle, confirmed_at, updated_at) VALUES (?1, ?2, ?2)',
  )
    .bind(handle, Date.now())
    .run();
}

async function readBreaker(): Promise<{ disabled_until?: number; consecutive_failures?: number }> {
  const breaker = await env.DB.prepare(
    "SELECT value FROM meta WHERE key = 'account_health_probe'",
  ).first<{ value: string }>();
  return JSON.parse(breaker?.value ?? '{}');
}

describe('account_health cron 探活', () => {
  afterEach(async () => {
    vi.unstubAllGlobals();
    await clearProbeState();
  });

  it('alive/注销/限流分别按语义处理：终态写死、限流不改状态、存活顺带回填 rest_id', async () => {
    const stale = Date.now() - 10 * 24 * 3600 * 1000;
    await insertHealth('probe_ratelimited', 'alive', stale);
    await insertHealth('probe_dead', 'unknown', stale + 10);
    await insertHealth('probe_alive', 'unknown', stale + 20);

    vi.stubGlobal('fetch', (input: Request | string) => Promise.resolve(stubXResponses(input)));
    const stats = await probeAccountHealthScheduled(env);

    expect(stats.guestTokenMissing).toBe(false);
    expect(stats.probed).toBe(3);
    expect(stats.alive).toBe(1);
    expect(stats.dead).toBe(1);
    expect(stats.unknown).toBe(1);

    const alive = await env.DB.prepare(
      "SELECT state, x_user_id, probe_count, source FROM account_health WHERE handle = 'probe_alive'",
    ).first<{ state: string; x_user_id: string | null; probe_count: number; source: string }>();
    expect(alive).toMatchObject({
      state: 'alive',
      x_user_id: '987654',
      probe_count: 1, // 初次入库 0 + cron 探测 +1
      source: 'cron-prober',
    });

    const dead = await env.DB.prepare(
      "SELECT state, terminal_checked_at FROM account_health WHERE handle = 'probe_dead'",
    ).first<{ state: string; terminal_checked_at: number | null }>();
    expect(dead?.state).toBe('dead');
    expect(dead?.terminal_checked_at).not.toBeNull();

    // 限流轮不落笔：状态保持原样
    const ratelimited = await env.DB.prepare(
      "SELECT state, updated_at FROM account_health WHERE handle = 'probe_ratelimited'",
    ).first<{ state: string; updated_at: number }>();
    expect(ratelimited).toMatchObject({ state: 'alive', updated_at: stale });

    // 限流 1 次未到熔断线（本轮 2 条成功 + 1 条限流 → 计数 1），下轮仍可继续
    const breaker = await readBreaker();
    expect(breaker.disabled_until).toBeUndefined();
    expect(breaker.consecutive_failures).toBe(1);
  });

  it('dead 终态条目不进入目标集；共识内缺健康记录的账号增量必验', async () => {
    const stale = Date.now() - 10 * 24 * 3600 * 1000;
    await insertHealth('dead_one', 'dead', stale);
    await seedConsensus('probe_alive'); // 共识账号透由 stub 判 alive
    await seedConsensus('consensus_garbage'); // stub 默认 → unknown，必须不写库

    vi.stubGlobal('fetch', (input: Request | string) => Promise.resolve(stubXResponses(input)));
    await probeAccountHealthScheduled(env);

    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM account_health WHERE handle = 'dead_one'",
      ).first<{ n: number }>(),
    ).toMatchObject({ n: 1 });
    // dead 的 probe_count 仍为 0：从未被探测
    expect(
      await env.DB.prepare(
        "SELECT probe_count FROM account_health WHERE handle = 'dead_one'",
      ).first<{ probe_count: number }>(),
    ).toMatchObject({ probe_count: 0 });
    // unknown 结论不写入
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM account_health WHERE handle = 'consensus_garbage'",
      ).first<{ n: number }>(),
    ).toMatchObject({ n: 0 });
    const consensusNew = await env.DB.prepare(
      "SELECT state FROM account_health WHERE handle = 'probe_alive'",
    ).first<{ state: string }>();
    expect(consensusNew?.state).toBe('alive');
  });

  it('停用账号连续 3 轮才熔断，生效期内整轮跳过', async () => {
    await seedConsensus('consensus_fresh');
    // stub 返回 429：guest 激活直接失败 → guestTokenMissing
    const failFetch = () => Promise.resolve(new Response('too many', { status: 429 }));
    vi.stubGlobal('fetch', failFetch);

    const stats = await probeAccountHealthScheduled(env);
    expect(stats.guestTokenMissing).toBe(true);
    expect(stats.probed).toBe(0);

    await probeAccountHealthScheduled(env); // 失败第 2 轮
    let breaker = await readBreaker();
    expect(breaker.disabled_until).toBeUndefined();

    // 失败第 3 轮：熔断打开（本轮仍执行，只是打开）
    await probeAccountHealthScheduled(env);
    breaker = await readBreaker();
    expect(breaker.disabled_until).toBeGreaterThan(Date.now());

    // 熔断生效期：整轮直接跳过
    const after = await probeAccountHealthScheduled(env);
    expect(after.probed).toBe(0);
  });
});
