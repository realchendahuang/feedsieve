import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';
import { refreshAccountFromLabels } from '../src/labels';
import { hashInstallationId } from '../src/lib/hash';
import { computeConsensusV2, voteWeight, CONSENSUS_V2_POLICY } from '../src/lib/consensus-v2';

const ORIGIN = 'https://api.example.com';

async function post(body: unknown): Promise<Response> {
  return worker.fetch(
    new Request(`${ORIGIN}/v1/reports`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    env,
  );
}

async function postRescues(body: unknown): Promise<Response> {
  return worker.fetch(
    new Request(`${ORIGIN}/v1/rescues`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    env,
  );
}

async function account(handle: string) {
  return env.DB
    .prepare('SELECT status, status_v2, consensus_v2, report_count, rescue_count FROM accounts WHERE handle = ?1')
    .bind(handle)
    .first<{
      status: string;
      status_v2: string;
      consensus_v2: number;
      report_count: number;
      rescue_count: number;
    }>();
}

describe('voteWeight（安装成熟度 × trust）', () => {
  it('新安装权重被压低到下限，成熟后线性爬升到 trust', () => {
    expect(voteWeight(1, 0)).toBe(CONSENSUS_V2_POLICY.minWeight);
    // 观察期未满 1 天时 maturity < 下限，权重停在下限
    expect(voteWeight(1, 0.5)).toBe(CONSENSUS_V2_POLICY.minWeight);
    // 第 3.5 天 maturity = 0.5
    expect(voteWeight(1, 3.5)).toBeCloseTo(0.5, 6);
    expect(voteWeight(1, 7)).toBe(1);
    expect(voteWeight(1, 30)).toBe(1);
    expect(voteWeight(0.5, 10)).toBe(0.5);
    expect(voteWeight(0, 10)).toBe(0);
  });
});

describe('computeConsensusV2（纯函数）', () => {
  it('三个跨周老安装 + 跨 2 天 = strong（与 v1 一致）', () => {
    const result = computeConsensusV2({
      blockedWeights: [1, 1, 1],
      allowedWeights: [],
      distinctDays: 2,
      evidenceIndependent: true,
    });
    expect(result.status).toBe('strong');
    expect(result.weightedNet).toBe(3);
    expect(result.reasons).toEqual([]);
  });

  it('三个新安装单日爆发：v1 达标但 v2 拒绝', () => {
    const result = computeConsensusV2({
      blockedWeights: [0.15, 0.15, 0.15],
      allowedWeights: [],
      distinctDays: 1,
      evidenceIndependent: false,
    });
    expect(result.status).toBe('new');
    expect(result.reasons).toContain('weighted_net_below_threshold');
    expect(result.reasons).toContain('lacks_temporal_or_evidence_independence');
  });

  it('跨天达标但加权票不足仍拒绝', () => {
    const result = computeConsensusV2({
      blockedWeights: [0.15, 0.9],
      allowedWeights: [],
      distinctDays: 2,
      evidenceIndependent: true,
    });
    expect(result.status).toBe('new');
  });

  it('老安装抢救票压过新安装拉黑票（净加权为负）', () => {
    const result = computeConsensusV2({
      blockedWeights: [0.15, 0.15, 0.15, 0.15],
      allowedWeights: [1],
      distinctDays: 1,
      evidenceIndependent: false,
    });
    expect(result.status).toBe('new');
    expect(result.weightedNet).toBeLessThan(0);
  });
});

describe('consensus v2 影子接入（集成）', () => {
  it('三个当天新建安装：v1 入榜但 status_v2 保持 new', async () => {
    const installs = [
      'vvvvvvvv-0001-4001-8000-vvvvvvvvvvvv',
      'vvvvvvvv-0002-4002-8000-vvvvvvvvvvvv',
      'vvvvvvvv-0003-4003-8000-vvvvvvvvvvvv',
    ];
    for (const id of installs) {
      const res = await post({ installation_id: id, reports: [{ handle: 'fresh_burst', reason: 'bot_spam' }] });
      expect(res.status).toBe(200);
    }
    const row = await account('fresh_burst');
    expect(row).toMatchObject({ status: 'strong', status_v2: 'new', report_count: 3 });
    expect(row!.consensus_v2).toBeLessThan(0.3);
  });

  it('老安装跨多日三票：v1 与 v2 都 strong', async () => {
    const installs = [
      'wwwwwwww-1001-4001-8000-wwwwwwwwwwww',
      'wwwwwwww-1002-4002-8000-wwwwwwwwwwww',
      'wwwwwwww-1003-4003-8000-wwwwwwwwwwww',
    ];
    for (const id of installs) {
      const res = await post({ installation_id: id, reports: [{ handle: 'established', reason: 'bot_spam' }] });
      expect(res.status).toBe(200);
    }
    // 把这些安装伪装成「已存在 10 天」，并把其中一票挪到 3 天前 —— 模拟跨周、跨日观察者
    const tenDaysAgo = Math.floor(Date.now() / 1000) - 10 * 86400;
    for (const id of installs) {
      const hashed = (await hashInstallationId(env.INSTALLATION_SALT, id)).toString();
      await env.DB.prepare('UPDATE installations SET first_seen_at = ?2 WHERE id = ?1')
        .bind(hashed, tenDaysAgo)
        .run();
    }
    const firstHash = (await hashInstallationId(env.INSTALLATION_SALT, installs[0]!)).toString();
    await env.DB.prepare(
      `UPDATE reports SET created_at = ?2
       WHERE installation_id = ?1 AND handle = 'established'`,
    )
      .bind(firstHash, tenDaysAgo)
      .run();
    // 手工改时间后重算（正常路径下 refresh 在各次投票时自动执行）
    await refreshAccountFromLabels(env, 'established');

    const row = await account('established');
    expect(row).toMatchObject({ status: 'strong', status_v2: 'strong', report_count: 3 });
    expect(row!.consensus_v2).toBeGreaterThan(0.4);
  });

  it('四个新安装拉黑 + 一个老安装抢救：v1 入榜、v2 拒绝', async () => {
    const freshInstalls = [
      'xxxxxxxx-2001-4001-8000-xxxxxxxxxxxx',
      'xxxxxxxx-2002-4002-8000-xxxxxxxxxxxx',
      'xxxxxxxx-2003-4003-8000-xxxxxxxxxxxx',
      'xxxxxxxx-2004-4004-8000-xxxxxxxxxxxx',
    ];
    for (const id of freshInstalls) {
      const res = await post({ installation_id: id, reports: [{ handle: 'mixed_votes', reason: 'bot_spam' }] });
      expect(res.status).toBe(200);
    }
    // 老安装的抢救票：先有历史（first_seen_at 提前），再投抢救
    const rescueInstall = 'xxxxxxxx-2005-4005-8000-xxxxxxxxxxxx';
    await env.DB.prepare('UPDATE installations SET first_seen_at = ?2 WHERE id = ?1')
      .bind(rescueInstall, Math.floor(Date.now() / 1000) - 30 * 86400)
      .run();
    const rescueRes = await postRescues({
      installation_id: rescueInstall,
      rescues: [{ handle: '@mixed_votes' }],
    });
    expect(rescueRes.status).toBe(200);

    const row = await account('mixed_votes');
    expect(row).toMatchObject({ status: 'strong', status_v2: 'new', report_count: 4, rescue_count: 1 });
  });
});