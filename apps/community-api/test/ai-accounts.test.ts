import { count, eq, like, or } from 'drizzle-orm';
import { getDb } from '../src/db/client';
import { aiAccountVerdicts, meta, trainingSampleUsage } from '../src/db/schema';
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import {
  buildReplies,
  decide,
  replyGaps,
  rhythm,
  type VendorTimeline,
} from '../src/ai-accounts/evidence';
import { checkAiAccount, INSTALL_DAILY_CHECKS } from '../src/ai-accounts/check';

const INSTALL = 'install-0001-abcdef';
const T0 = Date.parse('2026-10-30T06:00:00Z');

/** 一个账号的回复时间线：n 条自己的回复，每条回复一个不同的原帖，间隔 gapS 秒。 */
function timeline(
  handle: string,
  n: number,
  gapS = 30,
  text = (i: number) => `这个思路挺清楚，第${i}条还得实测几轮才知道稳不稳。`,
): VendorTimeline {
  const items: VendorTimeline['timeline'] = [];
  for (let i = 0; i < n; i++) {
    items.push({
      tweet_id: `9${i}`,
      created_at: new Date(T0 - (n - i) * 600_000).toUTCString(),
      text: `原帖 ${i}：今天发布了一个新模型`,
      in_reply_to_status_id_str: null,
      author: { screen_name: `poster${i}` },
    });
    items.push({
      tweet_id: `1${i}`,
      created_at: new Date(T0 + i * gapS * 1000).toUTCString(),
      text: `@poster${i} ${text(i)}`,
      in_reply_to_status_id_str: `9${i}`,
      author: { screen_name: handle },
    });
  }
  return { timeline: items, user: { rest_id: '42', blue_verified: true, protected: false } };
}

interface FakeAiCall {
  model: string;
  input: Record<string, unknown>;
  options?: Record<string, unknown>;
}

/** 当前测试注入的 Workers AI 绑定（判定默认走 workers-ai provider）。 */
let activeAi: Ai | undefined;

function stubVendors(
  options: {
    data?: VendorTimeline;
    score?: number;
    tikhubStatus?: number;
    jevStatus?: number;
  } = {},
) {
  const calls = { tikhub: 0, jev: 0, jevBodies: [] as FakeAiCall[] };
  const binding = {
    run: async (model: string, input: Record<string, unknown>, opts?: Record<string, unknown>) => {
      calls.jev += 1;
      calls.jevBodies.push({ model, input, options: opts });
      if (options.jevStatus && options.jevStatus >= 400) {
        throw Object.assign(new Error('ai failed'), { status: options.jevStatus });
      }
      return {
        model: 'jev-1.14.0',
        answers: { ai_account: { type: 'noul', noul: options.score ?? 0.9 } },
        usage: { input_tokens: 2500 },
      };
    },
  };
  activeAi = binding as unknown as Ai;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: Request | string | URL) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      if (url.hostname === 'api.tikhub.io') {
        calls.tikhub += 1;
        const handle = url.searchParams.get('screen_name') ?? '';
        return new Response(JSON.stringify({ data: options.data ?? timeline(handle, 10) }), {
          status: options.tikhubStatus ?? 200,
        });
      }
      return new Response('{}', { status: 404 });
    }),
  );
  return calls;
}

const keyed = (extra: Partial<Cloudflare.Env> = {}) =>
  ({ ...env, TIKHUB_API_KEY: 'tk', AI: activeAi, ...extra }) as unknown as Cloudflare.Env;

beforeEach(async () => {
  activeAi = undefined;
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

describe('AI 号证据整理', () => {
  it('只取本人回复、每个原帖一条、去掉开头 @ 并配对原帖', () => {
    const data = timeline('bot', 3);
    data.timeline.push({ ...data.timeline[1]!, tweet_id: '1dup' }); // 同一原帖的第二条
    const replies = buildReplies('BOT', data);
    expect(replies).toHaveLength(3);
    expect(replies[0]).toMatchObject({ id: '10', parent: '原帖 0：今天发布了一个新模型' });
    expect(replies[0]!.text.startsWith('@')).toBe(false);
  });

  it('间隔与节奏', () => {
    const data = timeline('bot', 10, 30);
    expect(replyGaps('bot', data)).toEqual(Array(9).fill(30));
    const r = rhythm('bot', data);
    expect(r.fast).toBe(1);
    expect(r.short).toBe(0);
    expect(r.cv).toBeLessThan(0.1);
  });

  it('判定阈值：强分直接判 AI；中分要节奏机械；其余疑似或真人', () => {
    const mechanical = { fast: 0.9, short: 0, cv: 0.2 };
    const humanLike = { fast: 0.3, short: 0.3, cv: 0.9 };
    // 2026-11-07 换 DeepSeek V4.1 Flash 后重校准：强线 0.80，节奏分支 0.40，疑似 0.79
    expect(decide(0.88, humanLike)).toBe('ai');
    expect(decide(0.5, mechanical)).toBe('ai');
    expect(decide(0.8, humanLike)).toBe('ai');
    expect(decide(0.79, humanLike)).toBe('suspect');
    expect(decide(0.3, mechanical)).toBe('human');
  });
});

describe('POST /v1/ai-accounts/check', () => {
  it('校验 handle 与安装 ID', async () => {
    stubVendors();
    expect(
      (
        await checkAiAccount(
          keyed(),
          { installation_id: INSTALL, handle: 'bad handle!' },
          undefined,
        )
      ).status,
    ).toBe(400);
    expect(
      (await checkAiAccount(keyed(), { installation_id: 'x', handle: 'bot' }, undefined)).status,
    ).toBe(400);
  });

  it('没有配置供应商密钥时返回 503', async () => {
    const result = await checkAiAccount(
      env,
      { installation_id: INSTALL, handle: 'bot' },
      undefined,
    );
    expect(result).toEqual({ status: 503, body: { error: 'ai_check_unavailable' } });
  });

  it('判一次后命中缓存，不再调用第三方；Jev 请求里没有 handle', async () => {
    const calls = stubVendors({ score: 0.9 });
    const first = await checkAiAccount(
      keyed(),
      { installation_id: INSTALL, handle: '@Bot_One' },
      '203.0.113.5',
    );
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      handle: 'bot_one',
      verdict: 'ai',
      score: 0.9,
      blue_verified: true,
      reply_count: 10,
      cached: false,
    });

    const second = await checkAiAccount(
      keyed(),
      { installation_id: 'install-0002-abcdef', handle: 'bot_one' },
      undefined,
    );
    expect(second.body).toMatchObject({ verdict: 'ai', cached: true });
    expect(calls).toMatchObject({ tikhub: 1, jev: 1 });

    const sent = JSON.stringify(calls.jevBodies[0]);
    expect(sent).not.toContain('bot_one');
    expect(sent).not.toContain('poster');
    expect(
      (calls.jevBodies[0]?.input as { state: { reply_gaps_seconds: number[] } }).state
        .reply_gaps_seconds,
    ).toHaveLength(9);

    const [row] = await getDb(env)
      .select({ replyIds: aiAccountVerdicts.replyIds, xUserId: aiAccountVerdicts.xUserId })
      .from(aiAccountVerdicts)
      .where(eq(aiAccountVerdicts.handle, 'bot_one'));
    expect(JSON.parse(row!.replyIds!)).toHaveLength(10);
    expect(row!.xUserId).toBe('42');
  });

  it('回复不足 8 条记为证据不足，不调用 Jev', async () => {
    const calls = stubVendors({ data: timeline('quiet', 5) });
    const result = await checkAiAccount(
      keyed(),
      { installation_id: INSTALL, handle: 'quiet' },
      undefined,
    );
    expect(result.body).toMatchObject({ verdict: 'insufficient', score: null, reply_count: 5 });
    expect(calls.jev).toBe(0);
  });

  it('受保护账号不判定', async () => {
    const data = timeline('locked', 10);
    data.user = { ...data.user, protected: true };
    const calls = stubVendors({ data });
    const result = await checkAiAccount(
      keyed(),
      { installation_id: INSTALL, handle: 'locked' },
      undefined,
    );
    expect(result.body).toMatchObject({ verdict: 'insufficient', reply_count: 0 });
    expect(calls.jev).toBe(0);
  });

  it('供应商失败返回 502 且不写结果；过期旧结果可以兜底', async () => {
    stubVendors({ jevStatus: 500 });
    const failed = await checkAiAccount(
      keyed(),
      { installation_id: INSTALL, handle: 'flaky' },
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
    const stale = await checkAiAccount(
      keyed(),
      { installation_id: INSTALL, handle: 'flaky' },
      undefined,
    );
    expect(stale).toMatchObject({
      status: 200,
      body: { verdict: 'suspect', cached: true, stale: true },
    });
  });

  it('同一安装每天新判定有上限，命中缓存不计', async () => {
    stubVendors();
    for (let i = 0; i < INSTALL_DAILY_CHECKS; i++) {
      const r = await checkAiAccount(
        keyed(),
        { installation_id: INSTALL, handle: `acct${i}` },
        undefined,
      );
      expect(r.status).toBe(200);
    }
    const cachedHit = await checkAiAccount(
      keyed(),
      { installation_id: INSTALL, handle: 'acct0' },
      undefined,
    );
    expect(cachedHit.status).toBe(200);
    const over = await checkAiAccount(
      keyed(),
      { installation_id: INSTALL, handle: 'acct_new' },
      undefined,
    );
    expect(over).toEqual({ status: 429, body: { error: 'rate_limited' } });
  });

  it('全站预算为 0 时只返回缓存', async () => {
    const calls = stubVendors();
    const result = await checkAiAccount(
      keyed({ AI_CHECK_DAILY_BUDGET: '0' }),
      { installation_id: INSTALL, handle: 'budget' },
      undefined,
    );
    expect(result).toEqual({ status: 429, body: { error: 'daily_budget_exhausted' } });
    expect(calls.tikhub).toBe(0);
  });

  it('连续失败后熔断，暂停新判定', async () => {
    stubVendors({ tikhubStatus: 500 });
    for (let i = 0; i < 5; i++) {
      await checkAiAccount(
        keyed(),
        { installation_id: `install-br-${i}-abcdef`, handle: `down${i}` },
        undefined,
      );
    }
    const paused = await checkAiAccount(
      keyed(),
      { installation_id: INSTALL, handle: 'down_next' },
      undefined,
    );
    expect(paused).toEqual({ status: 503, body: { error: 'ai_check_paused' } });
  });

  it('HTTP 路由可用且不缓存', async () => {
    stubVendors();
    const response = await worker.fetch(
      new Request('https://api.example.com/v1/ai-accounts/check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ installation_id: INSTALL, handle: 'nokeys' }),
      }),
      env,
    );
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
