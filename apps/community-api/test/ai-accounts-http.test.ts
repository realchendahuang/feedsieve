import { count, eq, like, or } from 'drizzle-orm';
import { getDb } from '../src/db/client';
import { aiAccountVerdicts, meta, trainingSampleUsage } from '../src/db/schema';
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { judgeAiAccount } from '../src/ai-accounts/judge';

const INSTALL = 'install-http-0001';

function replies(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: String(1_980_000_000_000_000_000n + BigInt(i) * 1_258_291_200_000n),
    parent: `原帖 ${i}：今天发布了一个新模型`,
    text: `第 ${i} 条回复：这个思路挺清楚，第${i}条还得实测几轮才知道稳不稳。`,
  }));
}

interface HttpCall {
  url: string;
  body: Record<string, unknown>;
}

/** 只 stub OpenAI 兼容判定服务（judge 走 HTTP，不经过 TikHub）。 */
function stubHttp(
  options: {
    probability?: number;
    status?: number;
    content?: string | null;
    model?: string;
  } = {},
) {
  const calls: HttpCall[] = [];
  const run = vi.fn(async (input: Request | string | URL, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    calls.push({ url: url.toString(), body });
    const status = options.status ?? 200;
    if (status >= 400) {
      return new Response(JSON.stringify({ error: { message: 'boom' } }), { status });
    }
    const content =
      options.content === undefined
        ? JSON.stringify({ probability: options.probability ?? 88, comment: '模板化回复', reason: '写法证据' })
        : options.content;
    return new Response(
      JSON.stringify({
        model: options.model ?? 'deepseek-v4.1-flash',
        usage: { prompt_tokens: 830, completion_tokens: 30 },
        choices: content === null ? [] : [{ message: { content } }],
      }),
      { status: 200 },
    );
  });
  vi.stubGlobal('fetch', run);
  return calls;
}

const httpEnv = (extra: Partial<Cloudflare.Env> = {}) =>
  ({
    ...env,
    AI_JUDGE_PROVIDERS: 'openai-compatible',
    AI_JUDGE_HTTP_BASE_URL: 'https://judge.test/v1',
    AI_JUDGE_HTTP_API_KEY: 'test-key',
    AI_JUDGE_HTTP_MODEL: 'deepseek-v4.1-flash',
    ...extra,
  }) as unknown as Cloudflare.Env;

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

describe('OpenAI 兼容 HTTP 判定 provider（DeepSeek / 中转）', () => {
  it('把回复发给配置的判定服务，写库并记录模型；请求不带 handle', async () => {
    const calls = stubHttp({ probability: 88 });
    const result = await judgeAiAccount(
      httpEnv(),
      {
        installation_id: INSTALL,
        handle: 'httpbot',
        replies: replies(10),
        gaps: Array(9).fill(300),
        author_count: 7,
      },
      undefined,
    );
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ handle: 'httpbot', verdict: 'ai', score: 0.88, comment: '模板化回复' });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://judge.test/v1/chat/completions');
    expect(calls[0]!.body).toMatchObject({
      model: 'deepseek-v4.1-flash',
      thinking: { type: 'disabled' },
      response_format: { type: 'json_object' },
      temperature: 0,
    });
    const sent = JSON.stringify(calls[0]!.body);
    expect(sent).not.toContain('httpbot');
    expect(sent).toContain('reply_gaps_seconds');

    const [row] = await getDb(env)
      .select({ model: aiAccountVerdicts.model, comment: aiAccountVerdicts.comment })
      .from(aiAccountVerdicts)
      .where(eq(aiAccountVerdicts.handle, 'httpbot'));
    expect(row!.model).toBe('deepseek-v4.1-flash');
    expect(row!.comment).toBe('模板化回复');
  });

  it('返回的 content 解析不出 probability（或没有 content）时按失败处理（502），不写坏数据', async () => {
    stubHttp({ content: '抱歉，我无法判断' });
    const bad = await judgeAiAccount(
      httpEnv(),
      { installation_id: INSTALL, handle: 'badcontent', replies: replies(10) },
      undefined,
    );
    expect(bad).toEqual({ status: 502, body: { error: 'upstream_failed' } });
    vi.unstubAllGlobals();

    stubHttp({ content: null });
    const empty = await judgeAiAccount(
      httpEnv(),
      { installation_id: INSTALL, handle: 'emptychoices', replies: replies(10) },
      undefined,
    );
    expect(empty).toEqual({ status: 502, body: { error: 'upstream_failed' } });
    expect(await getDb(env).select({ n: count() }).from(aiAccountVerdicts)).toEqual([{ n: 0 }]);
  });

  it('HTTP 失败时记 provider 熔断，并在 AI_JUDGE_PROVIDERS 里轮到下一个 provider', async () => {
    stubHttp({ status: 500 });
    // 第二个 provider：Workers AI 的 Clef
    const ai = {
      run: async () => ({
        model: 'clef',
        answers: { ai_account: { type: 'noul', noul: 0.9 } },
        usage: { input_tokens: 1000 },
      }),
    };
    const result = await judgeAiAccount(
      httpEnv({ AI_JUDGE_PROVIDERS: 'openai-compatible,workers-ai', AI: ai as unknown as Ai }),
      { installation_id: 'install-http-0002', handle: 'fallbackhttp', replies: replies(10) },
      undefined,
    );
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ handle: 'fallbackhttp', verdict: 'ai' });
    const breaker = await getDb(env)
      .select({ key: meta.key })
      .from(meta)
      .where(like(meta.key, 'vendor_breaker:openai-compatible:%'));
    expect(breaker).toHaveLength(1);
  });

  it('没有配 base/key 时该 provider 不可用（只配 HTTP 时返回 503）', async () => {
    const result = await judgeAiAccount(
      {
        ...env,
        AI_JUDGE_PROVIDERS: 'openai-compatible',
      } as unknown as Cloudflare.Env,
      { installation_id: INSTALL, handle: 'nokey', replies: replies(10) },
      undefined,
    );
    expect(result).toEqual({ status: 503, body: { error: 'ai_check_unavailable' } });
  });
});
