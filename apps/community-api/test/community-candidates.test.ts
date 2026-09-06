import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';
import { listCommunityCandidates } from '../src/candidates';

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

describe('社区候选池（只读）', () => {
  it('净票筛选 / 来源与证据聚合 / 游标分页', async () => {
    // alpha：3 票，来源 manual + heuristic，带指纹与外链
    await report('aaaaaaaa-4001-4001-8000-aaaaaaaaaaaa', 'cand_alpha', {
      detection_source: 'manual',
      content_fingerprint: '0123456789abcdef',
      link_domains: ['spam.example'],
    });
    await report('bbbbbbbb-4002-4002-8002-bbbbbbbbbbbb', 'cand_alpha', {
      detection_source: 'manual',
      content_fingerprint: 'fedcba9876543210',
    });
    await report('cccccccc-4003-4003-8003-cccccccccccc', 'cand_alpha', {
      detection_source: 'heuristic',
    });
    // beta：2 票，gamma：1 票
    await report('dddddddd-4004-4004-8004-dddddddddddd', 'cand_beta');
    await report('eeeeeeee-4005-4005-8005-eeeeeeeeeeee', 'cand_beta');
    await report('ffffffff-4006-4006-8006-ffffffffffff', 'cand_gamma');
    // delta：0 票（仅档案，无有效拉黑票）
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      `INSERT INTO accounts (handle, category, status, report_count, first_report_at, updated_at)
       VALUES (?1, 'other', 'candidate', 0, ?2, ?2)`,
    )
      .bind('cand_delta', now)
      .run();

    const all = await listCommunityCandidates(env, { limit: 50 });
    expect(all.entries.map((entry) => entry.handle)).toEqual([
      'cand_alpha',
      'cand_beta',
      'cand_delta',
      'cand_gamma',
    ]);

    const alpha = all.entries.find((entry) => entry.handle === 'cand_alpha')!;
    expect(alpha.net_votes).toBe(3);
    expect(alpha.blocked_installs).toBe(3);
    expect(alpha.allowed_installs).toBe(0);
    expect(alpha.sources).toEqual(['heuristic', 'manual']);
    expect(alpha.fingerprints).toBe(2);
    expect(alpha.domains).toBe(1);
    expect(all.categories).toContain('bot_spam');

    // 净票区间
    expect(
      (await listCommunityCandidates(env, { net: '3+', limit: 50 })).entries.map((e) => e.handle),
    ).toEqual(['cand_alpha']);
    expect(
      (await listCommunityCandidates(env, { net: '2', limit: 50 })).entries.map((e) => e.handle),
    ).toEqual(['cand_beta']);
    expect(
      (await listCommunityCandidates(env, { net: '0', limit: 50 })).entries.map((e) => e.handle),
    ).toEqual(['cand_delta']);

    // 键集分页：按 handle 游标翻页，页间无重复无遗漏
    const page1 = await listCommunityCandidates(env, { limit: 2 });
    expect(page1.entries.map((e) => e.handle)).toEqual(['cand_alpha', 'cand_beta']);
    const page2 = await listCommunityCandidates(env, { limit: 2, cursor: page1.next_cursor ?? undefined });
    expect(page2.entries.map((e) => e.handle)).toEqual(['cand_delta', 'cand_gamma']);
    expect(page2.next_cursor).toBeNull();

    // 账号子串过滤
    const q = await listCommunityCandidates(env, { q: 'gamma', limit: 50 });
    expect(q.entries.map((e) => e.handle)).toEqual(['cand_gamma']);
  });

  it('limit 钳制在 1-100', async () => {
    const all = await listCommunityCandidates(env, { limit: 0 });
    expect(all.entries.length).toBeLessThanOrEqual(50);
    const capped = await listCommunityCandidates(env, { limit: 10_000 });
    expect(capped.entries.length).toBeLessThanOrEqual(100);
  });
});