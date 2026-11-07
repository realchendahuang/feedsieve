import { like, or } from 'drizzle-orm';
import { getDb } from '../src/db/client';
import {
  adminAuditLog,
  aiAccountVerdicts,
  aiAccountVotes,
  applications,
  meta,
  trainingSampleUsage,
} from '../src/db/schema';
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { judgeAiAccount } from '../src/ai-accounts/judge';
import { listAiAccounts, lookupAiAccount } from '../src/ai-accounts/lookup';
import { voteAiAccount } from '../src/ai-accounts/vote';
import { listAiReviews, recordClientOutcome } from '../src/ai-accounts/review';
import { getAiPublic } from '../src/ai-accounts/public-page';

const A = 'install-aaaa-000001';
const B = 'install-bbbb-000002';

/** n 条回复证据；offset 让两份证据错开（不重合） */
function replies(n: number, offset = 0) {
  return Array.from({ length: n }, (_, i) => ({
    id: String(1_980_000_000_000_000_000n + BigInt(i + offset) * 1_258_291_200_000n),
    parent: `原帖 ${i + offset}`,
    text: `第 ${i + offset} 条回复`,
  }));
}

/** 当前测试注入的 Workers AI 绑定；判定默认走 workers-ai provider。 */
let activeAi: Ai | undefined;

function stubJev(score = 0.9) {
  const calls = { jev: 0 };
  const binding = {
    run: async () => {
      calls.jev += 1;
      return {
        model: 'jev-1.14.0',
        answers: { ai_account: { type: 'noul', noul: score } },
        usage: { input_tokens: 2000 },
      };
    },
  };
  activeAi = binding as unknown as Ai;
  return calls;
}

const keyed = () => ({ ...env, AI: activeAi }) as unknown as Cloudflare.Env;
const judge = (installation_id: string, handle: string, list = replies(10)) =>
  judgeAiAccount(keyed(), { installation_id, handle, replies: list }, undefined);

beforeEach(async () => {
  activeAi = undefined;
  const db = getDb(env);
  await Promise.all([
    db.delete(aiAccountVerdicts),
    db.delete(aiAccountVotes),
    db.delete(applications),
    db.delete(adminAuditLog),
    db
      .delete(trainingSampleUsage)
      .where(
        or(
          like(trainingSampleUsage.identity, 'ai-check%'),
          like(trainingSampleUsage.identity, 'ai-outcome%'),
          like(trainingSampleUsage.identity, 'ai-vote%'),
        ),
      ),
    db
      .delete(meta)
      .where(or(like(meta.key, 'vendor_breaker:%'), like(meta.key, 'ai_check_lock:%'))),
  ]);
});
afterEach(() => vi.unstubAllGlobals());

describe('AI 判定交叉验证', () => {
  it('单人结论不公开；第二个安装交来重合证据就确认，不再花钱', async () => {
    const calls = stubJev(0.9);
    const first = await judge(A, 'target');
    expect(first.body).toMatchObject({ verdict: 'ai', confirmed: false });
    expect(await lookupAiAccount(env, 'target')).toMatchObject({
      public: false,
      pending: true,
      verdict: null,
      score: null,
    });
    expect(await listAiAccounts(env)).toEqual([]);

    // 本人再查：返回自己的结论
    expect((await judge(A, 'target')).body).toMatchObject({ verdict: 'ai', cached: true });

    const second = await judge(B, 'target', replies(10, 3));
    expect(second.body).toMatchObject({ verdict: 'ai', confirmed: true, cached: true });
    expect(calls.jev).toBe(1);
    expect(await lookupAiAccount(env, 'target')).toMatchObject({
      public: true,
      verdict: 'ai',
      score: 0.9,
    });
    expect(await listAiAccounts(env)).toEqual([['target', 0.9, 0]]);
  });

  it('证据不重合时独立重判：落在同一侧才确认，相反则仍不公开', async () => {
    stubJev(0.9);
    await judge(A, 'forged');
    vi.unstubAllGlobals();
    stubJev(0.1);
    const second = await judge(B, 'forged', replies(10, 50));
    expect(second.body).toMatchObject({ verdict: 'human', confirmed: false });
    expect(await lookupAiAccount(env, 'forged')).toMatchObject({ public: false });

    vi.unstubAllGlobals();
    stubJev(0.12);
    const third = await judge(A, 'forged', replies(10, 100));
    expect(third.body).toMatchObject({ verdict: 'human', confirmed: true });
  });

  it('真人票 ≥ 3 且领先：直接公开真人，从 AI 名单撤下，不再进维护者队列', async () => {
    stubJev(0.9);
    await judge(A, 'appealed');
    await judge(B, 'appealed');
    for (const id of ['install-h1-0000001', 'install-h2-0000002', 'install-h3-0000003']) {
      await voteAiAccount({ ...env } as Cloudflare.Env, {
        installation_id: id,
        handle: 'appealed',
        vote: 'human',
      });
    }
    expect(await lookupAiAccount(env, 'appealed')).toMatchObject({
      public: true,
      verdict: 'human',
      score: null,
      contested: false,
      under_review: false,
    });
    expect(await listAiAccounts(env)).toEqual([]);
    expect((await getAiPublic(env, 'appealed'))?.state).toBe('human');
  });

  it('Jev 判真人但社区 AI 票领先：按社区公开 AI，并进名单', async () => {
    stubJev(0.1);
    await judge(A, 'human_jev');
    await judge(B, 'human_jev');
    for (const id of ['install-a1-0000021', 'install-a2-0000022', 'install-a3-0000023']) {
      await voteAiAccount({ ...env } as Cloudflare.Env, {
        installation_id: id,
        handle: 'human_jev',
        vote: 'ai',
      });
    }
    expect(await lookupAiAccount(env, 'human_jev')).toMatchObject({
      public: true,
      verdict: 'ai',
      score: null,
      contested: false,
    });
    expect(await listAiAccounts(env)).toEqual([['human_jev', null, 1]]);
  });

  it('AI 票和真人票都 ≥ 3 且持平：社区争议中，不公开结论', async () => {
    stubJev(0.9);
    await judge(A, 'tied');
    await judge(B, 'tied');
    for (const id of ['install-a1-0000001', 'install-a2-0000002', 'install-a3-0000003']) {
      await voteAiAccount({ ...env } as Cloudflare.Env, {
        installation_id: id,
        handle: 'tied',
        vote: 'ai',
      });
    }
    for (const id of ['install-h1-0000011', 'install-h2-0000012', 'install-h3-0000013']) {
      await voteAiAccount({ ...env } as Cloudflare.Env, {
        installation_id: id,
        handle: 'tied',
        vote: 'human',
      });
    }
    expect(await lookupAiAccount(env, 'tied')).toMatchObject({
      public: false,
      verdict: null,
      contested: true,
      under_review: false,
    });
    expect(await listAiAccounts(env)).toEqual([]);
    expect((await getAiPublic(env, 'tied'))?.state).toBe('contested');
  });

  it('已验证的申诉不再暂停公开；仍然只看票数 + Jev', async () => {
    stubJev(0.9);
    await judge(A, 'claimed');
    await judge(B, 'claimed');
    await getDb(env).insert(applications).values({
      handle: 'claimed',
      kind: 'appeal',
      statement: '我是真人，回复都是自己写的',
      emailHash: 'x',
      status: 'verified',
      ipHash: 'y',
      createdAt: 1,
    });
    expect(await lookupAiAccount(env, 'claimed')).toMatchObject({
      under_review: false,
      public: true,
      verdict: 'ai',
    });
    expect(await listAiAccounts(env)).toEqual([['claimed', 0.9, 0]]);
  });

  it('社区投票进名单的账号也会下发（没有判定时分数为 null）', async () => {
    for (const id of ['install-v1-0000001', 'install-v2-0000002', 'install-v3-0000003']) {
      await voteAiAccount({ ...env } as Cloudflare.Env, {
        installation_id: id,
        handle: 'voted',
        vote: 'ai',
      });
    }
    expect(await listAiAccounts(env)).toEqual([['voted', null, 1]]);
  });

  it('名单接口带 ETag，未变化返回 304；失败统计只收已知类型', async () => {
    const first = await worker.fetch(
      new Request('https://api.example.com/v1/ai-accounts/list'),
      env,
    );
    expect(first.status).toBe(200);
    const etag = first.headers.get('etag')!;
    const again = await worker.fetch(
      new Request('https://api.example.com/v1/ai-accounts/list', {
        headers: { 'if-none-match': etag },
      }),
      env,
    );
    expect(again.status).toBe(304);
    expect(await recordClientOutcome(env, { outcome: 'narrow' })).toBe(true);
    expect(await recordClientOutcome(env, { outcome: 'whatever' })).toBe(false);
    expect((await listAiReviews(env)).outcomes).toMatchObject({ 'client:narrow': 1 });
  });

  it('公开结果页：单人结论只显示待复核，确认后给分数与档位；昵称头像随判定保存', async () => {
    stubJev(0.9);
    await judgeAiAccount(
      keyed(),
      {
        installation_id: A,
        handle: 'shared',
        replies: replies(10),
        display_name: '可可鸭',
        avatar_url: 'https://pbs.twimg.com/profile_images/1/a_normal.jpg',
      },
      undefined,
    );
    expect(await getAiPublic(env, '@Shared')).toMatchObject({
      handle: 'shared',
      state: 'pending',
      flavor: null,
      displayName: '可可鸭',
      avatarUrl: 'https://pbs.twimg.com/profile_images/1/a_normal.jpg',
    });
    await judge(B, 'shared');
    const confirmed = await getAiPublic(env, 'shared');
    expect(confirmed).toMatchObject({
      state: 'public',
      flavor: { percent: 90, level: 'AI 感爆棚' },
    });
    expect(await getAiPublic(env, 'nobody_here')).toMatchObject({ state: 'none' });
    expect(await getAiPublic(env, 'bad handle!')).toBeNull();
  });
});
