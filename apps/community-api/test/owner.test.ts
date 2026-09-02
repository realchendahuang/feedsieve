import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';
import { deriveStatus } from '../src/rating';

const ORIGIN = 'https://api.example.com';
const LEGACY_OWNER_INSTALL = 'owner-test-install-0001';

async function report(installationId: string, handle: string) {
  const response = await worker.fetch(
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
  expect(response.status).toBe(200);
}

async function rescue(installationId: string, handle: string) {
  const response = await worker.fetch(
    new Request(`${ORIGIN}/v1/rescues`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ installation_id: installationId, rescues: [{ handle }] }),
    }),
    env,
  );
  expect(response.status).toBe(200);
}

async function account(handle: string) {
  return env.DB.prepare(
    'SELECT status, report_count, rescue_count, owner_votes FROM accounts WHERE handle = ?1',
  )
    .bind(handle)
    .first<{
      status: string;
      report_count: number;
      rescue_count: number;
      owner_votes: number;
    }>();
}

describe('没有隐藏的 owner 票权', () => {
  it('旧 owner 安装和普通安装完全相同：一票仍然不入榜', async () => {
    await report(LEGACY_OWNER_INSTALL, 'owner_vote');
    expect(await account('owner_vote')).toMatchObject({
      status: 'new',
      report_count: 1,
      rescue_count: 0,
      owner_votes: 0,
    });
  });

  it('旧 owner 误标只是普通负票，不是永久否决', async () => {
    const handle = 'owner_rescue';
    for (const id of [
      'owner-rule-0001-4001-8001-aaaaaaaaaaaa',
      'owner-rule-0002-4002-8002-bbbbbbbbbbbb',
      'owner-rule-0003-4003-8003-cccccccccccc',
    ]) {
      await report(id, handle);
    }
    expect((await account(handle))?.status).toBe('strong');

    await rescue(LEGACY_OWNER_INSTALL, handle);
    expect(await account(handle)).toMatchObject({
      status: 'new',
      report_count: 3,
      rescue_count: 1,
    });

    await report('owner-rule-0004-4004-8004-dddddddddddd', handle);
    expect(await account(handle)).toMatchObject({
      status: 'strong',
      report_count: 4,
      rescue_count: 1,
    });
  });
});

describe('deriveStatus 唯一公式', () => {
  it('只看 block - false_positive 是否达到 3', () => {
    expect(deriveStatus({ handle: 'a', status: 'new', report_count: 3, rescue_count: 0 })).toBe(
      'strong',
    );
    expect(deriveStatus({ handle: 'b', status: 'strong', report_count: 3, rescue_count: 1 })).toBe(
      'new',
    );
    expect(deriveStatus({ handle: 'c', status: 'new', report_count: 5, rescue_count: 2 })).toBe(
      'strong',
    );
  });

  it('历史 owner_votes 和历史 status 都不能改变结果', () => {
    expect(
      deriveStatus({ handle: 'x', status: 'dismissed', report_count: 0, rescue_count: 0 }),
    ).toBe('new');
  });
});
