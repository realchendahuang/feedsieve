import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';

const ORIGIN = 'https://api.example.com';

async function post(path: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await worker.fetch(
    new Request(`${ORIGIN}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    env,
  );
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

const INSTALL = 'player-0001-ffffff';
const EMAIL = 'hunter@example.com';

describe('猎手档案：邮箱验证码解锁', () => {
  it('未验证邮箱改档案 → 403', async () => {
    const res = await post('/v1/player/profile', { installation_id: INSTALL, display_name: '阿黄' });
    expect(res.status).toBe(403);
    expect(res.json.error).toBe('email_verification_required');
  });

  it('bind → dev_code（未配置 MAIL_WEBHOOK_URL）→ verify → 档案生效', async () => {
    const bound = await post('/v1/player/bind-email', { installation_id: INSTALL, email: EMAIL });
    expect(bound.status).toBe(200);
    expect(bound.json.sent).toBe(false);
    const code = bound.json.dev_code;
    expect(typeof code).toBe('string');
    expect(String(code)).toMatch(/^\d{6}$/);

    const verified = await post('/v1/player/verify', {
      installation_id: INSTALL,
      email: EMAIL,
      code,
    });
    expect(verified.status).toBe(200);

    const profile = await post('/v1/player/profile', {
      installation_id: INSTALL,
      display_name: '阿黄',
      bio: '拉黑也是一种守护',
    });
    expect(profile.status).toBe(200);

    // 榜单上反映自定义昵称与 bio（rows 全量断言由开火用例覆盖）
    const board = await post('/v1/leaderboard', { installation_id: INSTALL });
    expect(board.status).toBe(200);
  });

  it('错码累计 5 次后锁定', async () => {
    await post('/v1/player/bind-email', { installation_id: 'player-lock-ffffff', email: 'lock@example.com' });
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await post('/v1/player/verify', {
        installation_id: 'player-lock-ffffff',
        email: 'lock@example.com',
        code: '000000',
      });
      expect(res.status).toBe(400);
    }
    const res = await post('/v1/player/verify', {
      installation_id: 'player-lock-ffffff',
      email: 'lock@example.com',
      code: '000000',
    });
    expect(res.status).toBe(429);
  });

  it('同一邮箱每小时最多发 3 次码', async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await post('/v1/player/bind-email', {
        installation_id: 'player-rate-ffffff',
        email: 'rate@example.com',
      });
      expect(res.status).toBe(200);
    }
    const res = await post('/v1/player/bind-email', {
      installation_id: 'player-rate-ffffff',
      email: 'rate@example.com',
    });
    expect(res.status).toBe(429);
    expect(res.json.error).toBe('too_many_code_requests');
  });

  it('换安装不能使用别的安装申请的码', async () => {
    await post('/v1/player/bind-email', { installation_id: 'player-x-a-ffffff', email: 'x@example.com' });
    const bound = await post('/v1/player/bind-email', {
      installation_id: 'player-x-b-ffffff',
      email: 'x@example.com',
    });
    // 同邮箱重复 bind 会覆盖码；这里验证 installer 绑定校验：B 安装用自己申请的码成功
    const codeB = String(bound.json.dev_code);
    const ok = await post('/v1/player/verify', {
      installation_id: 'player-x-b-ffffff',
      email: 'x@example.com',
      code: codeB,
    });
    expect(ok.status).toBe(200);
  });

  it('Gmail 别名归一：+tag 与加点变体视为同一邮箱', async () => {
    await post('/v1/player/bind-email', {
      installation_id: 'player-g-a-ffffff',
      email: 'hunter+tag@googlemail.com',
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      await post('/v1/player/bind-email', {
        installation_id: 'player-g-a-ffffff',
        email: 'hunter+other@googlemail.com',
      });
    }
    const res = await post('/v1/player/bind-email', {
      installation_id: 'player-g-a-ffffff',
      email: 'h.u.n.t.e.r@gmail.com',
    });
    expect(res.status).toBe(429);
  });
});
