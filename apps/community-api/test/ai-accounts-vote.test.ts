import { like } from 'drizzle-orm';
import { getDb } from '../src/db/client';
import { aiAccountVotes, trainingSampleUsage } from '../src/db/schema';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/index';
import { voteAiAccount, tallyVotes, AI_LIST_MIN_VOTES, VOTE_DAILY } from '../src/ai-accounts/vote';

const H = 'suspectbot';

beforeEach(async () => {
  const db = getDb(env);
  await Promise.all([
    db.delete(aiAccountVotes),
    db.delete(trainingSampleUsage).where(like(trainingSampleUsage.identity, 'ai-vote%')),
  ]);
});

const vote = (installation_id: string, handle: string, v: 'ai' | 'human') =>
  voteAiAccount({ ...env } as Cloudflare.Env, { installation_id, handle, vote: v });

describe('POST /v1/ai-accounts/vote', () => {
  it('校验入参', async () => {
    expect((await vote('x', H, 'ai')).status).toBe(400);
    expect((await vote('install-0001-abcdef', 'bad!', 'ai')).status).toBe(400);
    expect(
      (
        await voteAiAccount({ ...env } as Cloudflare.Env, {
          installation_id: 'install-0001-abcdef',
          handle: H,
          vote: 'maybe',
        })
      ).status,
    ).toBe(400);
  });

  it('需要 ≥3 独立安装 ai 票且过半才进公共名单', async () => {
    const r1 = await vote('install-aaaa-0001', H, 'ai');
    expect(r1.body).toMatchObject({ ai_count: 1, human_count: 0, listed: false });
    await vote('install-bbbb-0002', H, 'ai');
    const r3 = await vote('install-cccc-0003', H, 'ai');
    expect(r3.body).toMatchObject({ ai_count: AI_LIST_MIN_VOTES, human_count: 0, listed: true });
  });

  it('human 票追平即撤出名单', async () => {
    await vote('install-aaaa-0001', H, 'ai');
    await vote('install-bbbb-0002', H, 'ai');
    await vote('install-cccc-0003', H, 'ai');
    await vote('install-dddd-0004', H, 'human');
    await vote('install-eeee-0005', H, 'human');
    const tied = await vote('install-ffff-0006', H, 'human');
    expect(tied.body).toMatchObject({ ai_count: 3, human_count: 3, listed: false });
  });

  it('同一安装改票覆盖，不重复计数', async () => {
    await vote('install-aaaa-0001', H, 'ai');
    const changed = await vote('install-aaaa-0001', H, 'human');
    expect(changed.body).toMatchObject({ ai_count: 0, human_count: 1 });
    const tally = await tallyVotes({ ...env } as Cloudflare.Env, H);
    expect(tally).toMatchObject({ ai_count: 0, human_count: 1 });
  });

  it('改票不计入每日限额，只有首次对某账号投票才计', async () => {
    const inst = 'install-rate-0001';
    for (let i = 0; i < VOTE_DAILY; i++) {
      const r = await vote(inst, `bot${i}`, 'ai');
      expect(r.status).toBe(200);
    }
    // 对已投过的账号改票仍可用（不计新额度）
    const rechange = await vote(inst, 'bot0', 'human');
    expect(rechange.status).toBe(200);
    // 对新账号投票超限
    const over = await vote(inst, 'bot_new', 'ai');
    expect(over).toEqual({ status: 429, body: { error: 'rate_limited' } });
  });

  it('HTTP 路由可用且不缓存', async () => {
    const response = await worker.fetch(
      new Request('https://api.example.com/v1/ai-accounts/vote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ installation_id: 'install-http-0001', handle: H, vote: 'ai' }),
      }),
      env,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ handle: H, ai_count: 1 });
  });
});

describe('GET /v1/ai-accounts/:handle', () => {
  it('没有判定时 verdict 为 null，带票数；有判定时返回节奏', async () => {
    const { lookupAiAccount } = await import('../src/ai-accounts/lookup');
    const { aiAccountVerdicts } = await import('../src/db/schema');
    await getDb(env).delete(aiAccountVerdicts);
    await vote('install-aaaa-0001', H, 'ai');
    const empty = await lookupAiAccount(env, H);
    expect(empty).toMatchObject({ verdict: null, expired: false, votes: { ai_count: 1 } });

    const nowS = Math.floor(Date.now() / 1000);
    await getDb(env)
      .insert(aiAccountVerdicts)
      .values({
        handle: H,
        verdict: 'ai',
        score: 0.9,
        replyCount: 12,
        rhythm: JSON.stringify({ fast: 0.1, short: 0, cv: 0.3, median_gap: 300 }),
        questionVersion: 5,
        judgedAt: nowS,
        expiresAt: nowS + 100,
        confirmed: 1,
      });
    const response = await worker.fetch(
      new Request(`https://api.example.com/v1/ai-accounts/${H.toUpperCase()}`),
      env,
    );
    expect(response.headers.get('cache-control')).toContain('s-maxage=60');
    expect(await response.json()).toMatchObject({
      verdict: 'ai',
      score: 0.9,
      expired: false,
      rhythm: { median_gap: 300 },
    });
    expect((await lookupAiAccount(env, H, (nowS + 200) * 1000))?.expired).toBe(true);
    await getDb(env).delete(aiAccountVerdicts);
  });
});
