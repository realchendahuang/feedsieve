import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';
import { getSnapshotFile, killSwitchNeedsPublish, SNAPSHOT_PACK } from '../src/snapshot';

const ORIGIN = 'https://api.example.com';

/** 模拟部署配置翻转：构造带 DESTRUCTIVE_KILL_SWITCH 的 env 副本（不动全局测试 env）。 */
function envWithKillSwitch(reason: string): typeof env {
  return { ...env, DESTRUCTIVE_KILL_SWITCH: reason };
}

describe('official kill switch live channel', () => {
  it('端点：无开关时返回 destructive_actions_disabled: false（no-store）', async () => {
    const res = await worker.fetch(new Request(`${ORIGIN}/v1/kill-switch`), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(await res.json()).toEqual({ destructive_actions_disabled: false });
  });

  it('端点：开关开启时直接读部署配置实时返回，不经快照日更节流', async () => {
    const res = await worker.fetch(
      new Request(`${ORIGIN}/v1/kill-switch`),
      envWithKillSwitch(' 接口排查中 '),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      destructive_actions_disabled: boolean;
      reason?: string;
      disabled_since?: string;
    };
    expect(body.destructive_actions_disabled).toBe(true);
    expect(body.reason).toBe('接口排查中');
    expect(typeof body.disabled_since).toBe('string');
  });

  it('killSwitchNeedsPublish：env 未设置且无快照 → false', async () => {
    expect(await killSwitchNeedsPublish(env)).toBe(false);
  });

  it('开关翻转（无脏标记）cron 补发：今日无版本时生成带 kill_switch 的新版', async () => {
    const envOn = envWithKillSwitch('接口排查中');
    expect(await killSwitchNeedsPublish(envOn)).toBe(true);

    await worker.scheduled({ scheduledTime: Date.now() } as never, envOn);

    const latest = (await (
      await worker.fetch(new Request(`${ORIGIN}/v1/snapshots/latest`), env)
    ).json()) as { snapshot_version: string };
    expect(latest.snapshot_version).toMatch(/^\d{4}\.\d{2}\.\d{2}\.\d+$/);

    const body = JSON.parse(
      (await getSnapshotFile(env, latest.snapshot_version, SNAPSHOT_PACK)) ?? '{}',
    ) as { kill_switch?: unknown };
    expect(body.kill_switch).toEqual({
      destructive_actions_disabled: true,
      reason: '接口排查中',
      disabled_since: expect.any(String),
    });
    // 今日已发布：再翻转也由 day-once 顺延次日（实时生效走端点）
    expect(await killSwitchNeedsPublish(envOn)).toBe(false);
  });
});