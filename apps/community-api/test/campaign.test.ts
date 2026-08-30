import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';

const ORIGIN = 'https://api.example.com';
const ADMIN = env.ADMIN_TOKEN;

/** 同一话术模板的两个变体（换词后汉明距离 <= 2，v0.5 SimHash） */
const FP_A = 'aaaaaaaaaaaaaaaa'; // 变体 A（0xa = 1010）
const FP_A_VARIANT = 'aaaaaaaaaaaaaaab'; // 与 A 汉明距离 1（0xb = 1011）
const FP_B = 'bbbbbbbbbbbbbbbb'; // 另一个话术模板（与 A 距离 16，不归簇）

async function report(
  installationId: string,
  handle: string,
  extra: Record<string, unknown> = {},
): Promise<{ status: string; error?: string }> {
  const res = await worker.fetch(
    new Request(`${ORIGIN}/v1/reports`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        installation_id: installationId,
        reports: [{ handle, reason: 'copy_paste', ...extra }],
      }),
    }),
    env,
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    results: { status: string; error?: string }[];
  };
  return body.results[0];
}

/** 3 个独立安装上报同一 handle → 自动升 candidate，进快照 */
async function promoteToCandidate(
  handle: string,
  extra: Record<string, unknown> = {},
) {
  for (let i = 1; i <= 3; i++) {
    await report(`ev${i}-${handle}-install-0001-ffffff`, handle, extra);
  }
}

interface Entry {
  handle: string;
  fingerprints?: string[];
  campaign_entry_id?: string;
  campaign_size?: number;
}

async function publishAndGetEntry(handle: string): Promise<Entry | undefined> {
  const publish = await worker.fetch(
    new Request(`${ORIGIN}/admin/publish`, {
      method: 'POST',
      headers: { authorization: `Bearer ${ADMIN}` },
    }),
    env,
  );
  expect(publish.status).toBe(200);
  const latest = (await (
    await worker.fetch(new Request(`${ORIGIN}/v1/snapshots/latest`), env)
  ).json()) as { snapshot_version: string; files: { path: string }[] };
  const body = (await (
    await worker.fetch(
      new Request(
        `${ORIGIN}/v1/snapshots/${latest.snapshot_version}/${latest.files[0].path}`,
      ),
      env,
    )
  ).json()) as { entries: Entry[] };
  return body.entries.find((e) => e.handle === handle);
}

describe('snapshot: Campaign 聚类（v0.5）', () => {
  it('同一话术变体的多个账号归为同一簇，下发 campaign_entry_id 与规模', async () => {
    // 两个账号各自被多个独立安装举报，且共用相近指纹（SimHash 变体）
    await promoteToCandidate('campaign_a', { content_fingerprint: FP_A });
    await promoteToCandidate('campaign_b', { content_fingerprint: FP_A_VARIANT });

    const a = await publishAndGetEntry('campaign_a');
    const b = await publishAndGetEntry('campaign_b');
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    // 指纹各自达标下发
    expect(a!.fingerprints).toContain(FP_A);
    expect(b!.fingerprints).toContain(FP_A_VARIANT);
    // 同簇：互相指向同一代表 + 规模为 2
    expect(a!.campaign_entry_id).toBeTruthy();
    expect(a!.campaign_size).toBe(2);
    expect(b!.campaign_entry_id).toBe(a!.campaign_entry_id);
    expect(b!.campaign_size).toBe(2);
  });

  it('指纹距离远的账号不归簇（无 campaign 元数据）', async () => {
    // 单独一个不同话术的账号：指纹达标但簇内只有自己 -> 不下发 campaign
    await promoteToCandidate('campaign_alone', { content_fingerprint: FP_B });

    const alone = await publishAndGetEntry('campaign_alone');
    expect(alone?.fingerprints).toContain(FP_B);
    expect(alone!.campaign_entry_id).toBeUndefined();
    expect(alone!.campaign_size).toBeUndefined();
  });

  it('簇代表取 report_count 最高的账号', async () => {
    // campaign_a 已有 3 票（上面 promote），campaign_b 加到 4 票 → 代表换为 b
    await report('extra-install-0001-ffffff', 'campaign_b', {
      content_fingerprint: FP_A_VARIANT,
    });
    const a = await publishAndGetEntry('campaign_a');
    const b = await publishAndGetEntry('campaign_b');
    expect(b!.campaign_entry_id).toBe('campaign_b'); // 4 票 > 3 票
    expect(a!.campaign_entry_id).toBe('campaign_b');
    expect(a!.campaign_size).toBe(2);
  });
});
