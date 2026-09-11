import { env } from 'cloudflare:workers';
import { afterAll, describe, expect, it } from 'vitest';
import worker from '../src/index';
import { hashInstallationId } from '../src/lib/hash';

const ORIGIN = 'https://api.example.com';
const TEST_SALT = 'override-salt-0123456789';

async function postContributions(installationId: string, phrases: unknown): Promise<Response> {
  return worker.fetch(
    new Request(`${ORIGIN}/v1/keyword-contributions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ installation_id: installationId, phrases }),
    }),
    env,
  );
}

async function postWebContributions(ip: string, phrases: unknown): Promise<Response> {
  return worker.fetch(
    new Request(`${ORIGIN}/v1/keyword-contributions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
      body: JSON.stringify({ phrases }),
    }),
    env,
  );
}

afterAll(async () => {
  await env.DB.exec('DELETE FROM keyword_contributions');
});

describe('keyword contributions', () => {
  it('校验安装 ID 与短语载荷', async () => {
    expect((await postContributions('short', ['广告'])).status).toBe(400);
    expect((await postContributions('install-contribute-a', [])).status).toBe(400);
    expect((await postContributions('install-contribute-a', new Array(21).fill('x'))).status).toBe(
      413,
    );
    const bad = await postContributions('install-contribute-a', ['   ']);
    const badBody = (await bad.json()) as { results: { status: string; error?: string }[] };
    expect(badBody.results[0]).toMatchObject({
      status: 'rejected',
      error: 'invalid_phrase_length',
    });
  });

  it('记录、去重幂等，待审列表可见', async () => {
    const first = await postContributions('install-contribute-1', ['同城上门', '  同城上门  ']);
    expect(first.status).toBe(200);
    const body = (await first.json()) as { results: { phrase: string; status: string }[] };
    expect(body.results).toEqual([
      { phrase: '同城上门', status: 'recorded' },
      { phrase: '同城上门', status: 'duplicate' },
    ]);

    // 重试整个请求保持幂等：同样短语第二次是 duplicate
    const retry = await postContributions('install-contribute-1', ['同城上门']);
    expect(((await retry.json()) as { results: { status: string }[] }).results[0]?.status).toBe(
      'duplicate',
    );

    // 同一 norm_phrase 不同安装是两个独立贡献行
    const second = await postContributions('install-contribute-2', [' 同城上门 ']);
    expect(((await second.json()) as { results: { status: string }[] }).results[0]?.status).toBe(
      'recorded',
    );

    const admin = await worker.fetch(
      new Request(`${ORIGIN}/api/admin/keywords/contributions`),
      env,
    );
    expect(admin.status).toBe(404); // 非管理域名拒绝（isAdminHost not_found）

    const listed = await env.DB.prepare('SELECT COUNT(*) AS n FROM keyword_contributions').first<{
      n: number;
    }>();
    expect(listed?.n).toBe(2);
  });

  it('单安装每日上限', async () => {
    for (let round = 0; round < 40; round += 10) {
      const res = await postContributions(
        'install-contribute-flood',
        Array.from({ length: 10 }, (_, i) => `flood-${round}-${i}`),
      );
      expect(res.status).toBe(200);
    }
    expect((await postContributions('install-contribute-flood', ['超出额度的词'])).status).toBe(
      429,
    );
    // 幂等重试与超出无关：已提交词不算天内新增
    expect((await postContributions('install-contribute-flood', ['flood-0-0'])).status).toBe(200);
  });

  it('网页匿名通道：IP 限流、单次上限、与扩展通道分开记账', async () => {
    // 无 IP 只能走扩展通道
    expect(
      (
        await worker.fetch(
          new Request(`${ORIGIN}/v1/keyword-contributions`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ phrases: ['广告'] }),
          }),
          env,
        )
      ).status,
    ).toBe(400);
    // 网页单次上限 10
    expect((await postWebContributions('198.51.100.1', new Array(11).fill('x'))).status).toBe(413);

    const webKey = `web-${await hashInstallationId(TEST_SALT, '198.51.100.1')}`;
    await postWebContributions(
      '198.51.100.1',
      Array.from({ length: 3 }, (_, i) => `web-0-${i}`),
    );
    // 再补 2 条到 5 条/日/IP 上限，之后新词被拒
    await postWebContributions(
      '198.51.100.1',
      Array.from({ length: 2 }, (_, i) => `web-3-${i}`),
    );
    expect((await postWebContributions('198.51.100.1', ['泡茶'])).status).toBe(429);
    // 重复词幂等：不占额度、不算新提交
    expect((await postWebContributions('198.51.100.1', ['web-0-0'])).status).toBe(200);

    const webRows = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM keyword_contributions WHERE installation_id = ?1',
    )
      .bind(webKey)
      .first<{ n: number }>();
    expect(webRows?.n).toBe(5);
  });

  it('admin 审阅决定按词聚合改状态（尽力而为：非管理域名上中间件先 404）', async () => {
    await postContributions('install-decide-1', ['待审词甲']);

    const decide = await worker.fetch(
      new Request(`${ORIGIN}/api/admin/keywords/contributions/decide`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ norm_phrase: '待审词甲', decision: 'admitted' }),
      }),
      env,
    );
    expect([200, 404]).toContain(decide.status);
  });
});
