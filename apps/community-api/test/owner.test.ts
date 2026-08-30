import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';
import { deriveStatus } from '../src/rating';

const ORIGIN = 'https://api.example.com';

/** 测试注入的 owner 安装（见 wrangler.jsonc miniflare bindings / .dev.vars） */
const OWNER_INSTALL: string = env.OWNER_INSTALLATION_ID ?? 'owner-test-install-0001';

async function report(installationId: string, handle: string) {
  const res = await worker.fetch(
    new Request(`${ORIGIN}/v1/reports`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        installation_id: installationId,
        reports: [{ handle, reason: 'scam_phishing' }],
      }),
    }),
    env,
  );
  expect(res.status).toBe(200);
}

async function rescue(installationId: string, handle: string) {
  const res = await worker.fetch(
    new Request(`${ORIGIN}/v1/rescues`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        installation_id: installationId,
        rescues: [{ handle }],
      }),
    }),
    env,
  );
  expect(res.status).toBe(200);
}

async function statusOf(handle: string): Promise<string | undefined> {
  return (
    await env.DB.prepare('SELECT status FROM accounts WHERE handle = ?1')
      .bind(handle)
      .first<{ status: string }>()
  )?.status;
}

describe('owner 特权（v0.5）', () => {
  it('owner 拉黑 1 票即 strong（黑名单即最高置信）', async () => {
    await report(OWNER_INSTALL, 'owner_blocked');
    expect(await statusOf('owner_blocked')).toBe('strong');
  });

  it('owner 抢救 = 最终裁决：置 dismissed（永久退出，后续举报不复活）', async () => {
    // 先让普通用户把它举报到 3 票 strong
    await report('arch-0001-4001-8000-aaaaaaaaaaaa', 'owner_vetoed');
    await report('arch-0002-4002-8000-bbbbbbbbbbbb', 'owner_vetoed');
    await report('arch-0003-4003-8000-cccccccccccc', 'owner_vetoed');
    expect(await statusOf('owner_vetoed')).toBe('strong');

    // owner 抢救：置 dismissed
    await rescue(OWNER_INSTALL, 'owner_vetoed');
    expect(await statusOf('owner_vetoed')).toBe('dismissed');

    // 再举报也不复活：auto-rate 对 dismissed 保持终态
    await report('arch-0004-4004-8000-dddddddddddd', 'owner_vetoed');
    expect(await statusOf('owner_vetoed')).toBe('dismissed');
  });

  it('普通用户抢救：candidate 且 rescue >= report 时降回 new', async () => {
    await report('norm-0001-5001-8000-eeeeeeeeeeee', 'rescue_demote');
    await report('norm-0002-5002-8000-ffffffffffff', 'rescue_demote');
    expect(await statusOf('rescue_demote')).toBe('candidate');

    await rescue('norm-0003-5003-8000-gggggggggggg', 'rescue_demote');
    await rescue('norm-0004-5004-8000-hhhhhhhhhhhh', 'rescue_demote');
    // rescue(2) >= report(2) → new（退出快照）
    expect(await statusOf('rescue_demote')).toBe('new');
  });
});

describe('deriveStatus 白盒逻辑', () => {
  it('dismissed 是终态', () => {
    expect(
      deriveStatus({ handle: 'x', status: 'dismissed', report_count: 99, rescue_count: 0, owner_votes: 0 }),
    ).toBe('dismissed');
  });

  it('owner 票优先于票数', () => {
    expect(
      deriveStatus({ handle: 'x', status: 'new', report_count: 0, rescue_count: 0, owner_votes: 2 }),
    ).toBe('strong');
  });

  it('rescue >= report 降级', () => {
    expect(
      deriveStatus({ handle: 'x', status: 'candidate', report_count: 2, rescue_count: 3, owner_votes: 0 }),
    ).toBe('new');
  });

  it('降级阈值与升级阈值独立', () => {
    expect(
      deriveStatus({ handle: 'x', status: 'strong', report_count: 3, rescue_count: 3, owner_votes: 0 }),
    ).toBe('new');
  });

  it('阈值：>=3 strong / >=2 candidate / 其余 new', () => {
    expect(
      deriveStatus({ handle: 'a', status: 'new', report_count: 3, rescue_count: 0, owner_votes: 0 }),
    ).toBe('strong');
    expect(
      deriveStatus({ handle: 'b', status: 'new', report_count: 2, rescue_count: 0, owner_votes: 0 }),
    ).toBe('candidate');
    expect(
      deriveStatus({ handle: 'c', status: 'new', report_count: 1, rescue_count: 0, owner_votes: 0 }),
    ).toBe('new');
  });
});