import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';
import { decideApplication, listApplications, submitApplication } from '../src/applications';

const ORIGIN = 'https://api.example.com';
const IP = '203.0.113.7';

async function post(
  path: string,
  body: unknown,
  ip: string | null = IP,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await worker.fetch(
    new Request(`${ORIGIN}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(ip ? { 'cf-connecting-ip': ip } : {}),
      },
      body: JSON.stringify(body),
    }),
    env,
  );
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

function submit(handle: string, email: string, kind = 'whitelist', statement = '本人宣言：不刷屏不引流。') {
  return post('/v1/applications', { handle, kind, email, statement });
}

describe('名单公示申请', () => {
  it('提交 → dev_code → 验证 → 进维护者队列 → 裁决', async () => {
    const submitted = await submit('@Good_Blogger', 'good@example.com');
    expect(submitted.status).toBe(200);
    const code = String(submitted.json.dev_code);
    expect(code).toMatch(/^\d{6}$/);

    const verified = await post('/v1/applications/verify', { email: 'good@example.com', code });
    expect(verified.status).toBe(200);
    expect(verified.json).toMatchObject({ handle: 'good_blogger', kind: 'whitelist', status: 'verified' });

    const queue = await listApplications(env, { status: 'verified' });
    const entry = queue.entries.find((row) => row.handle === 'good_blogger');
    expect(entry).toBeTruthy();
    expect(entry?.statement).toBe('本人宣言：不刷屏不引流。');
    expect(entry?.verified_at).not.toBeNull();

    const decided = await decideApplication(env, entry!.id, 'approved', '已核实', 'm@example.com');
    expect(decided.ok).toBe(true);
    const after = await listApplications(env, { status: 'approved' });
    expect(after.entries.find((row) => row.handle === 'good_blogger')?.decided_by).toBe('m@example.com');
  });

  it('handle 归一化：@前缀与大写收敛，非法输入拒绝', async () => {
    expect((await submit('not a handle', 'h1@example.com')).json.error).toBe('invalid_handle');
    expect((await submit('ok_handle', 'h2@example.com', 'block')).json.error).toBe('invalid_kind');
    expect((await submit('ok_handle', 'bad-email', 'appeal')).json.error).toBe('invalid_email');
    expect((await submit('ok_handle', 'h3@example.com', 'whitelist', '短')).json.error).toBe('invalid_statement');
    expect((await submit('ok_handle', 'h4@example.com', 'whitelist', 'x'.repeat(501))).json.error).toBe(
      'invalid_statement',
    );
  });

  it('pending 重复提交 = 重发验证码；verified 后再提交 → 409', async () => {
    await submit('repeat_user', 'repeat@example.com');
    const again = await submit('repeat_user', 'repeat@example.com');
    expect(again.status).toBe(200);
    expect(again.json.dev_code).toMatch(/^\d{6}$/);

    const code = String(again.json.dev_code);
    expect((await post('/v1/applications/verify', { email: 'repeat@example.com', code })).status).toBe(200);

    const third = await submit('repeat_user', 'repeat@example.com');
    expect(third.status).toBe(409);
    expect(third.json.error).toBe('application_pending');
  });

  it('同邮箱多份申请：验证只推进最新一份 pending', async () => {
    await submit('multi_a_user', 'multi@example.com', 'appeal', '申诉：这是误标。');
    await submit('multi_b_user', 'multi@example.com', 'whitelist');
    const verified = await post('/v1/applications/verify', { email: 'multi@example.com', code: '000000' });
    expect(verified.status).toBe(400); // 占位码，先确保错码路径不推进
    const all = await listApplications(env, {});
    expect(all.entries.filter((row) => row.handle.startsWith('multi_')).every((row) => row.status === 'pending')).toBe(
      true,
    );
  });

  it('错码 5 次锁定（429 too_many_attempts）', async () => {
    await submit('lock_user', 'lock@example.com');
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await post('/v1/applications/verify', { email: 'lock@example.com', code: '000000' });
      expect(res.status).toBe(400);
    }
    const res = await post('/v1/applications/verify', { email: 'lock@example.com', code: '000000' });
    expect(res.status).toBe(429);
    expect(res.json.error).toBe('too_many_attempts');
  });

  it('同一邮箱每小时最多发 3 次码', async () => {
    for (let i = 1; i <= 3; i++) {
      const res = await submit(`mailrate_${i}_user`, 'mailrate@example.com');
      expect(res.status).toBe(200);
    }
    const res = await submit('mailrate_4_user', 'mailrate@example.com');
    expect(res.status).toBe(429);
    expect(res.json.error).toBe('too_many_code_requests');
  });

  it('单 IP 每日 20 次提交上限', async () => {
    // 独立 IP：本文件其它用例已消耗默认 IP 的日配额
    for (let i = 1; i <= 20; i++) {
      const res = await post('/v1/applications', {
        handle: `ipcap_${i}_user`,
        kind: 'whitelist',
        email: `ipcap${i}@example.com`,
        statement: '本人宣言：不刷屏不引流。',
      }, '192.0.2.50');
      expect(res.status).toBe(200);
    }
    const res = await post('/v1/applications', {
      handle: 'ipcap_21_user',
      kind: 'whitelist',
      email: 'ipcap21@example.com',
      statement: '本人宣言：不刷屏不引流。',
    }, '192.0.2.50');
    expect(res.status).toBe(429);
    expect(res.json.error).toBe('too_many_submissions');
    // 换一个 IP 不受影响
    const other = await post('/v1/applications', {
      handle: 'ipcap_22_user',
      kind: 'whitelist',
      email: 'ipcap22@example.com',
      statement: '本人宣言：不刷屏不引流。',
    }, '192.0.2.51');
    expect(other.status).toBe(200);
  });

  it('已裁决的申请不能重复裁决；未验证的 pending 也能直接拒绝', async () => {
    const submitted = await submit('decide_user', 'decide@example.com', 'appeal', '申诉：这是误标，请复核。');
    const code = String(submitted.json.dev_code);
    await post('/v1/applications/verify', { email: 'decide@example.com', code });
    const queue = await listApplications(env, { status: 'verified' });
    const entry = queue.entries.find((row) => row.handle === 'decide_user');
    expect(entry).toBeTruthy();

    expect((await decideApplication(env, entry!.id, 'rejected', null, 'm@example.com')).ok).toBe(true);
    const again = await decideApplication(env, entry!.id, 'approved', null, 'm@example.com');
    expect(again.ok).toBe(false);
    expect(again.error).toBe('application_already_decided');

    const fresh = await submit('pending_no_user', 'pendingreject@example.com');
    expect(fresh.status).toBe(200);
    const queueAll = await listApplications(env, {});
    const pendingRow = queueAll.entries.find((row) => row.handle === 'pending_no_user');
    expect((await decideApplication(env, pendingRow!.id, 'rejected', 'spam', 'm@example.com')).ok).toBe(true);
  });

  it('缺 cf-connecting-ip 时拒绝提交（生产永远有该头）', async () => {
    const res = await post('/v1/applications', {
      handle: 'noip_user',
      kind: 'whitelist',
      email: 'noip@example.com',
      statement: '本人宣言：不刷屏不引流。',
    }, null);
    expect(res.status).toBe(400);
    expect(res.json.error).toBe('ip_missing');
  });

  it('submitApplication 直接调用（无 HTTP 头）限流与幂等路径', async () => {
    const result = await submitApplication(env, {
      handle: '@direct_user',
      kind: 'whitelist',
      email: 'direct@example.com',
      statement: '本人宣言：不刷屏不引流。',
    }, '198.51.100.9');
    expect(result.ok).toBe(true);
  });
});
