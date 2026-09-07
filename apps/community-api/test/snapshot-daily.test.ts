import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';
import { generateSnapshot, markSnapshotDirty, readSnapshotDirty } from '../src/snapshot';

const ORIGIN = 'https://api.example.com';

async function report(installationId: string, handle: string) {
  const res = await worker.fetch(
    new Request(`${ORIGIN}/v1/reports`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        installation_id: installationId,
        reports: [{ handle, reason: 'bot_spam' }],
      }),
    }),
    env,
  );
  expect(res.status).toBe(200);
}

function installs(prefix: string): string[] {
  return [
    `${prefix}-0001-4000-8000-000000000001`,
    `${prefix}-0002-4000-8000-000000000002`,
    `${prefix}-0003-4000-8000-000000000003`,
  ];
}

const todayStamp = () => new Date().toISOString().slice(0, 10).replaceAll('-', '.');

/** 今日快照行数（deferred 不该新增行）。 */
async function countTodayRows(): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM snapshots WHERE version LIKE ?1')
    .bind(`${todayStamp()}.%`)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

async function latestVersion(): Promise<string> {
  const latest = await worker.fetch(new Request(`${ORIGIN}/v1/snapshots/latest`), env);
  const manifest = (await latest.json()) as { snapshot_version: string };
  return manifest.snapshot_version;
}

describe('snapshot daily-once publishing', () => {
  it('scheduled：脏标记驱动正常发布并清除', async () => {
    for (const id of installs('dapub')) {
      await report(id, 'scheduled_pub_user');
    }
    await markSnapshotDirty(env);
    await worker.scheduled({ scheduledTime: Date.now() } as never, env);
    expect(await readSnapshotDirty(env)).toBeNull();
    expect((await latestVersion()).startsWith(`${todayStamp()}.`)).toBe(true);
  });

  it('同一天内容变化 → deferred 返回今日版本，不落新行，公开端点仍服务今日版本', async () => {
    const baseline = await generateSnapshot(env);
    const rowsBefore = await countTodayRows();
    expect(baseline.deferred).not.toBe(true);

    for (const id of installs('dagate')) {
      await report(id, 'daily_gate_user');
    }
    const second = await generateSnapshot(env);
    expect(second.deferred).toBe(true);
    expect(second.version).toBe(baseline.version);
    expect(await countTodayRows()).toBe(rowsBefore);
    expect(await latestVersion()).toBe(baseline.version);
  });

  it('scheduled 碰到 deferred 不清脏标记（内容顺延到下一自然日再合并）', async () => {
    await generateSnapshot(env); // 确保今日已有基线版本（两种隔离模型都成立）
    for (const id of installs('dakeep')) {
      await report(id, 'defer_keep_dirty_user');
    }
    await markSnapshotDirty(env);
    const dirty = (await readSnapshotDirty(env)) ?? '';
    await worker.scheduled({ scheduledTime: Date.now() } as never, env);
    expect(await readSnapshotDirty(env)).toBe(dirty);
  });

  it('维护者 bypassDailyOnce：同一天也能立即 mint 新版本', async () => {
    for (const id of installs('dabyp')) {
      await report(id, 'bypass_user');
    }
    const published = await generateSnapshot(env, 0, { bypassDailyOnce: true });
    expect(published.deferred).not.toBe(true);
    expect(await latestVersion()).toBe(published.version);
  });
});