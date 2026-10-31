import { count, eq, like, or } from 'drizzle-orm';
import { getDb } from '../src/db/client';
import { aiAccountVerdicts, meta, trainingSampleUsage } from '../src/db/schema';
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { judgeAiAccount } from '../src/ai-accounts/judge';
import { INSTALL_DAILY_CHECKS, type AiCheckValue } from '../src/ai-accounts/check';

const INSTALL = 'install-0001-abcdef';

/** n 条合法回复证据（证据直传格式：id / parent / text）。 */
function replies(
  n: number,
  text = (i: number) => `这个思路挺清楚，第${i}条还得实测几轮才知道稳不稳。`,
) {
  return Array.from({ length: n }, (_, i) => ({
    id: `10${i}`,
    parent: `原帖 ${i}：今天发布了一个新模型`,
    text: text(i),
  }));
}

/** 只 stub Jev（judge 不经过 TikHub）。 */
function stubJev(options: { score?: number; scores?: number[]; jevStatus?: number } = {}) {
  const calls = { jev: 0, tikhub: 0, jevBodies: [] as unknown[] };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: Request | string | URL, init?: RequestInit) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      if (url.hostname === 'api.tikhub.io') {
        calls.tikhub += 1;
        return new Response('{}', { status: 500 });
      }
      if (url.hostname === 'api.typesafe.ai') {
        calls.jev += 1;
        calls.jevBodies.push(JSON.parse(String(init?.body)));
        return new Response(
          JSON.stringify({
            model: 'jev-1.14.0',
            answers: {
              ai_account: {
                type: 'noul',
                noul: options.scores?.[calls.jev - 1] ?? options.score ?? 0.9,
              },
            },
            usage: { input_tokens: 2000 },
          }),
          { status: options.jevStatus ?? 200 },
        );
      }
      return new Response('{}', { status: 404 });
    }),
  );
  return calls;
}

const keyed = (extra: Partial<Cloudflare.Env> = {}) =>
  ({ ...env, TYPESAFE_API_KEY: 'ts', ...extra }) as Cloudflare.Env;

beforeEach(async () => {
  const db = getDb(env);
  await Promise.all([
    db.delete(aiAccountVerdicts),
    db.delete(trainingSampleUsage).where(like(trainingSampleUsage.identity, 'ai-check%')),
    db
      .delete(meta)
      .where(or(like(meta.key, 'vendor_breaker:%'), like(meta.key, 'ai_check_lock:%'))),
  ]);
});
afterEach(() => vi.unstubAllGlobals());

describe('POST /v1/ai-accounts/judge（证据直传）', () => {
  it('校验 handle 与安装 ID', async () => {
    stubJev();
    expect(
      (
        await judgeAiAccount(
          keyed(),
          { installation_id: INSTALL, handle: 'bad!', replies: replies(10) },
          undefined,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await judgeAiAccount(
          keyed(),
          { installation_id: 'x', handle: 'bot', replies: replies(10) },
          undefined,
        )
      ).status,
    ).toBe(400);
  });

  it('不经过 TikHub，只用客户端传入的证据判一次并写库', async () => {
    const calls = stubJev({ score: 0.9 });
    const result = await judgeAiAccount(
      keyed(),
      {
        installation_id: INSTALL,
        handle: '@Bot_One',
        replies: replies(10),
        gaps: Array(9).fill(300),
        blue_verified: true,
        x_user_id: '42',
      },
      '203.0.113.5',
    );
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      handle: 'bot_one',
      verdict: 'ai',
      score: 0.9,
      blue_verified: true,
      reply_count: 10,
      cached: false,
    });
    expect(calls).toMatchObject({ tikhub: 0, jev: 1 });

    // Jev state 只含回复与间隔，不含 handle / 原帖作者
    const sent = JSON.stringify(calls.jevBodies[0]);
    expect(sent).not.toContain('bot_one');
    expect(
      (calls.jevBodies[0] as { state: { reply_gaps_seconds: number[] } }).state.reply_gaps_seconds,
    ).toHaveLength(9);

    const [row] = await getDb(env)
      .select({ replyIds: aiAccountVerdicts.replyIds, xUserId: aiAccountVerdicts.xUserId })
      .from(aiAccountVerdicts)
      .where(eq(aiAccountVerdicts.handle, 'bot_one'));
    expect(JSON.parse(row!.replyIds!)).toHaveLength(10);
    expect(row!.xUserId).toBe('42');
  });

  it('命中未过期缓存直接返回，不调用 Jev、不计入单用户额度', async () => {
    const calls = stubJev({ score: 0.9 });
    await judgeAiAccount(
      keyed(),
      { installation_id: INSTALL, handle: 'cached', replies: replies(10) },
      undefined,
    );
    const again = await judgeAiAccount(
      keyed(),
      { installation_id: 'install-0002-abcdef', handle: 'cached', replies: replies(10) },
      undefined,
    );
    expect(again.body).toMatchObject({ verdict: 'ai', cached: true });
    expect(calls.jev).toBe(1);
  });

  it('回复不足 8 条返回 400 insufficient_replies，不花 Jev 的钱', async () => {
    const calls = stubJev();
    const result = await judgeAiAccount(
      keyed(),
      { installation_id: INSTALL, handle: 'quiet', replies: replies(5) },
      undefined,
    );
    expect(result).toEqual({ status: 400, body: { error: 'insufficient_replies' } });
    expect(calls.jev).toBe(0);
  });

  it('丢弃非法回复证据（缺 id / 空 text / 重复原帖）后仍需够 6 条', async () => {
    const calls = stubJev();
    const dirty = [
      ...replies(5),
      { id: 'abc', parent: 'p', text: 'bad id' }, // 非法 id
      { id: '200', parent: 'p', text: '   ' }, // 空 text
      { id: '201', parent: '原帖 0：今天发布了一个新模型', text: '同原帖重复' }, // 原帖与 replies(7)[0] 重复
    ];
    const result = await judgeAiAccount(
      keyed(),
      { installation_id: INSTALL, handle: 'dirty', replies: dirty },
      undefined,
    );
    // replies(5) 原帖是 0..4，第 201 条原帖 0 重复被丢，净 5 条 < 6
    expect(result).toEqual({ status: 400, body: { error: 'insufficient_replies' } });
    expect(calls.jev).toBe(0);
  });

  it('没有 Jev 密钥返回 503', async () => {
    stubJev();
    const result = await judgeAiAccount(
      { ...env } as Cloudflare.Env,
      { installation_id: INSTALL, handle: 'nokey', replies: replies(10) },
      undefined,
    );
    expect(result).toEqual({ status: 503, body: { error: 'ai_check_unavailable' } });
  });

  it('Jev 失败返回 502 且不写结果；有旧结果时降级返回旧结果', async () => {
    stubJev({ jevStatus: 500 });
    const failed = await judgeAiAccount(
      keyed(),
      { installation_id: INSTALL, handle: 'flaky', replies: replies(10) },
      undefined,
    );
    expect(failed).toEqual({ status: 502, body: { error: 'upstream_failed' } });
    expect(await getDb(env).select({ n: count() }).from(aiAccountVerdicts)).toEqual([{ n: 0 }]);

    await getDb(env).insert(aiAccountVerdicts).values({
      handle: 'flaky',
      verdict: 'suspect',
      score: 0.55,
      replyCount: 12,
      questionVersion: 5,
      judgedAt: 1,
      expiresAt: 2,
    });
    const stale = await judgeAiAccount(
      keyed(),
      { installation_id: INSTALL, handle: 'flaky', replies: replies(10) },
      undefined,
    );
    expect(stale).toMatchObject({
      status: 200,
      body: { verdict: 'suspect', cached: true, stale: true },
    });
  });

  it('同一安装每天新判定有上限，命中缓存不计', async () => {
    stubJev();
    for (let i = 0; i < INSTALL_DAILY_CHECKS; i++) {
      const r = await judgeAiAccount(
        keyed(),
        { installation_id: INSTALL, handle: `acct${i}`, replies: replies(10) },
        undefined,
      );
      expect(r.status).toBe(200);
    }
    const over = await judgeAiAccount(
      keyed(),
      { installation_id: INSTALL, handle: 'acct_new', replies: replies(10) },
      undefined,
    );
    expect(over).toEqual({ status: 429, body: { error: 'rate_limited' } });
  });

  it('被判 AI 缓存 7 天，被判真人缓存 30 天', async () => {
    const now = Date.parse('2026-10-31T00:00:00Z');
    stubJev({ score: 0.95 });
    const ai = await judgeAiAccount(
      keyed(),
      { installation_id: INSTALL, handle: 'aibot', replies: replies(10) },
      undefined,
      now,
    );
    vi.unstubAllGlobals();
    stubJev({ score: 0.05 });
    const human = await judgeAiAccount(
      keyed(),
      { installation_id: 'install-0003-abcdef', handle: 'realguy', replies: replies(10) },
      undefined,
      now,
    );
    const nowS = Math.floor(now / 1000);
    expect((ai.body as AiCheckValue).expires_at - nowS).toBe(7 * 86_400);
    expect((human.body as AiCheckValue).expires_at - nowS).toBe(30 * 86_400);
  });

  it('灰色地带用第二批再判一次取平均；分数明确时只判一次', async () => {
    const gray = stubJev({ scores: [0.45, 0.75] });
    const many = Array.from({ length: 20 }, (_, i) => ({
      id: String(1_980_000_000_000_000_000n + BigInt(i) * 1_258_291_200_000n),
      parent: `原帖 ${i}`,
      text: `第 ${i} 条回复`,
    }));
    const result = await judgeAiAccount(
      keyed(),
      { installation_id: INSTALL, handle: 'grayone', replies: many, author_count: 12 },
      undefined,
    );
    expect(gray.jev).toBe(2);
    expect(result.body).toMatchObject({ score: 0.6, verdict: 'ai', reply_count: 20 });
    const [row] = await getDb(env)
      .select({ rhythm: aiAccountVerdicts.rhythm })
      .from(aiAccountVerdicts)
      .where(eq(aiAccountVerdicts.handle, 'grayone'));
    expect(JSON.parse(row!.rhythm!)).toMatchObject({ authors: 12, rounds: 2, median_gap: 300 });

    vi.unstubAllGlobals();
    const clear = stubJev({ score: 0.9 });
    const sure = await judgeAiAccount(
      keyed(),
      { installation_id: INSTALL, handle: 'sureone', replies: many },
      undefined,
    );
    expect(clear.jev).toBe(1);
    expect(sure.body).toMatchObject({ reply_count: 10 });
  });

  it('HTTP 路由可用且不缓存', async () => {
    stubJev();
    const response = await worker.fetch(
      new Request('https://api.example.com/v1/ai-accounts/judge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ installation_id: INSTALL, handle: 'nokeys', replies: replies(10) }),
      }),
      env,
    );
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
