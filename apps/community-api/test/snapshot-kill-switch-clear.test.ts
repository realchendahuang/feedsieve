import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';
import { getSnapshotFile, killSwitchNeedsPublish, SNAPSHOT_PACK } from '../src/snapshot';

const ORIGIN = 'https://api.example.com';

describe('stale kill_switch archive cleanup', () => {
  it('公开镜像还带着旧 kill_switch、env 已关闭时，cron 补发一版清除', async () => {
    // 种一个昨天的、带开关的旧快照行：模拟开关已关闭但镜像尚未重发
    // （版本号按 UTC 计算，避免测试环境日期边界撞上「今天」；
    //   本地 REQUIRE_SIGNED_SNAPSHOTS=1，种子行需带非空签名才可见）
    const yesterday = new Date(Date.now() - 86_400_000)
      .toISOString()
      .slice(0, 10)
      .replaceAll('-', '.');
    const staleVersion = `${yesterday}.1`;
    const staleBody = `${JSON.stringify(
      {
        schema_version: 2,
        policy_version: 3,
        snapshot_version: staleVersion,
        generated_at: `${yesterday.replaceAll('.', '-')}T00:00:00Z`,
        entries: [],
        kill_switch: {
          destructive_actions_disabled: true,
          reason: '旧开关',
          disabled_since: '2026-01-01T00:00:00Z',
        },
      },
      null,
      2,
    )}\n`;
    await env.DB.prepare(
      `INSERT INTO snapshots (version, manifest_json, signature_json, files_json, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
    )
      .bind(
        staleVersion,
        JSON.stringify({
          schema_version: 2,
          policy_version: 3,
          snapshot_version: staleVersion,
          generated_at: `${yesterday.replaceAll('.', '-')}T00:00:00Z`,
          files: [],
        }),
        JSON.stringify({ key_id: 'release-1', alg: 'ed25519', sig: 'stale' }),
        JSON.stringify({
          [SNAPSHOT_PACK]: {
            path: SNAPSHOT_PACK,
            sha256: 'stale-body',
            entries: 0,
            body: staleBody,
          },
        }),
        Math.floor(Date.now() / 1000) - 86400,
      )
      .run();

    expect(await killSwitchNeedsPublish(env)).toBe(true);
    await worker.scheduled({ scheduledTime: Date.now() } as never, env);

    const latest = (await (
      await worker.fetch(new Request(`${ORIGIN}/v1/snapshots/latest`), env)
    ).json()) as { snapshot_version: string };
    expect(latest.snapshot_version).toMatch(/^\d{4}\.\d{2}\.\d{2}\.\d+$/);
    expect(latest.snapshot_version).not.toBe(staleVersion);

    const body = JSON.parse(
      (await getSnapshotFile(env, latest.snapshot_version, SNAPSHOT_PACK)) ?? '{}',
    ) as { kill_switch?: unknown };
    expect(body.kill_switch).toBeUndefined();
  });
});