import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';

const ORIGIN = 'https://api.example.com';

async function postReport(
  installationId: string,
  handle: string,
  xUserId?: string,
): Promise<Response> {
  return worker.fetch(
    new Request(`${ORIGIN}/v1/reports`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        installation_id: installationId,
        reports: [{ handle, reason: 'bot_spam', ...(xUserId ? { x_user_id: xUserId } : {}) }],
      }),
    }),
    env,
  );
}

async function accountRow(handle: string) {
  return env.DB.prepare(
    'SELECT handle, aliases, report_count FROM accounts WHERE handle = ?1',
  )
    .bind(handle)
    .first<{ handle: string; aliases: string; report_count: number }>();
}

describe('aliases (rename tracking)', () => {
  it('a renamed handle folds into the known account instead of starting fresh', async () => {
    // 老账号 spam_old 拿到 3 票（都带 rest_id 888）
    for (const id of ['aaaaaaa1-0000-4000-8000-aaaaaaaaaaa1', 'aaaaaaa1-0000-4000-8000-aaaaaaaaaaa2', 'aaaaaaa1-0000-4000-8000-aaaaaaaaaaa3']) {
      expect((await postReport(id, 'spam_old', '888')).status).toBe(200);
    }
    const before = await accountRow('spam_old');
    expect(before?.report_count).toBe(3);

    // 换号成 spam_new（同 rest_id 888）→ 新安装举报新 handle
    const res = await postReport('aaaaaaa1-0000-4000-8000-aaaaaaaaaaa4', 'spam_new', '888');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: { status: string }[] };
    expect(body.results[0].status).toBe('recorded');

    // 票记在正主身上；新 handle 进别名；不产生新的独立账号
    const after = await accountRow('spam_old');
    expect(after?.report_count).toBe(4);
    expect(JSON.parse(after?.aliases ?? '[]')).toEqual(['spam_new']);
    expect(await accountRow('spam_new')).toBeNull();

    // 同一安装再报新 handle：对正主去重
    const dup = await postReport('aaaaaaa1-0000-4000-8000-aaaaaaaaaaa4', 'spam_new', '888');
    const dupBody = (await dup.json()) as { results: { status: string }[] };
    expect(dupBody.results[0].status).toBe('duplicate');
  });
});
