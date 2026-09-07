import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';
import {
  buildSigningMessage,
  TRUSTED_KEYS,
  verifyManifestSignature,
} from '@feedsieve/community-lists';
import {
  generateSnapshot,
  buildKillSwitch,
  getLatestSnapshotVersion,
  PUBLIC_BLOCKLIST_PACK,
  SNAPSHOT_PACK,
} from '../src/snapshot';

const ORIGIN = 'https://api.example.com';

async function report(installationId: string, handle: string, extra: Record<string, unknown> = {}) {
  const res = await worker.fetch(
    new Request(`${ORIGIN}/v1/reports`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        installation_id: installationId,
        reports: [{ handle, reason: 'bot_spam', ...extra }],
      }),
    }),
    env,
  );
  expect(res.status).toBe(200);
}

interface Manifest {
  schema_version: number;
  snapshot_version: string;
  generated_at: string;
  files: { path: string; sha256: string; entries: number }[];
}

async function sha256HexOf(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

describe('snapshot pipeline', () => {
  it('kill_switch 载荷构造：有理由才下发，空白视为未设置', () => {
    const since = '2026-09-07T00:00:00Z';
    expect(buildKillSwitch(undefined, since)).toBeUndefined();
    expect(buildKillSwitch('', since)).toBeUndefined();
    expect(buildKillSwitch('   ', since)).toBeUndefined();
    expect(buildKillSwitch(' 接口排查中 ', since)).toEqual({
      destructive_actions_disabled: true,
      reason: '接口排查中',
      disabled_since: since,
    });
  });

  it('retires the raw bearer-token publish endpoint', async () => {
    const response = await worker.fetch(
      new Request(`${ORIGIN}/admin/publish`, {
        method: 'POST',
        headers: { authorization: 'Bearer no-longer-accepted' },
      }),
      env,
    );
    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({ error: 'admin_moved_to_access' });
  });

  it('empty publish -> manifest with zero entries; new-status accounts excluded', async () => {
    await report('ssssssss-1000-4000-8000-ssssssssssss', 'only_new_user');

    // bypassDailyOnce：测试关注内容正确性而非日更时序（后者见 snapshot-daily.test.ts）
    const result = await generateSnapshot(env, 0, { bypassDailyOnce: true });
    const { snapshot_version, files } = result.manifest as unknown as Manifest;
    expect(snapshot_version).toMatch(/^\d{4}\.\d{2}\.\d{2}\.\d{1,4}$/);
    expect(files[0].entries).toBe(0);

    const latest = await worker.fetch(new Request(`${ORIGIN}/v1/snapshots/latest`), env);
    expect(latest.status).toBe(200);
    const manifest = (await latest.json()) as Manifest;
    expect(manifest.snapshot_version).toBe(snapshot_version);
  });

  it('net-vote account lands in the final snapshot and readable YAML', async () => {
    const installs = [
      'tttttttt-2001-4001-8000-tttttttttttt',
      'tttttttt-2002-4002-8000-tttttttttttt',
      'tttttttt-2003-4003-8000-tttttttttttt',
    ];
    for (const id of installs) await report(id, 'cand_user');
    await report('tttttttt-2004-4004-8000-tttttttttttt', 'cand_user', {
      evidence_post_id: '18000000000000000',
    });

    // bypassDailyOnce：本文件前面已 mint 过今日版本，这里显式走即时通道验证内容正确性；
    // 日更语义（同一天内容变化延迟发布）由 test/snapshot-daily.test.ts 覆盖。
    await generateSnapshot(env, 0, { bypassDailyOnce: true });
    const fileRes = await worker.fetch(
      new Request(
        `${ORIGIN}/v1/snapshots/${
          (
            (await (
              await worker.fetch(new Request(`${ORIGIN}/v1/snapshots/latest`), env)
            ).json()) as Manifest
          ).snapshot_version
        }/${SNAPSHOT_PACK}`,
      ),
      env,
    );
    expect(fileRes.status).toBe(200);
    const bodyText = await fileRes.text();
    const body = JSON.parse(bodyText) as {
      schema_version: number;
      entries: {
        handle: string;
        sources: string[];
        community_score: number;
        report_count: number;
        rescue_count: number;
        net_votes: number;
        evidence_post_ids: string[];
      }[];
    };

    expect(body.schema_version).toBe(2);
    expect(body.entries).toHaveLength(1);
    const entry = body.entries[0];
    expect(entry.handle).toBe('cand_user');
    expect(entry).not.toHaveProperty('status');
    expect(entry.sources).toEqual(['community']);
    expect(entry.report_count).toBe(4);
    expect(entry.rescue_count).toBe(0);
    expect(entry.net_votes).toBe(4);
    // 4 票同日：4/7 = 0.571 → 0.57（未达爆发线，不打折）
    expect(entry.community_score).toBe(0.57);
    expect(entry.evidence_post_ids).toEqual(['18000000000000000']);

    const latest = (await (
      await worker.fetch(new Request(`${ORIGIN}/v1/snapshots/latest`), env)
    ).json()) as Manifest;
    expect(await sha256HexOf(bodyText)).toBe(latest.files[0].sha256);
    expect(fileRes.headers.get('cache-control')).toContain('immutable');

    const yamlRes = await worker.fetch(new Request(`${ORIGIN}/v1/blocklist/latest.yaml`), env);
    expect(yamlRes.status).toBe(200);
    expect(yamlRes.headers.get('content-type')).toContain('yaml');
    const yaml = await yamlRes.text();
    expect(yaml).toContain('formula: "block_votes - false_positive_votes"');
    expect(yaml).toContain('min_net_votes: 3');
    expect(yaml).toContain('- handle: "cand_user"');
    expect(yaml).toContain('sources: ["community"]');
    expect(yaml).toContain('net: 4');

    const yamlFile = latest.files.find((file) => file.path === PUBLIC_BLOCKLIST_PACK);
    expect(yamlFile).toBeDefined();
    expect(await sha256HexOf(yaml)).toBe(yamlFile?.sha256);
  });

  it('republishing unchanged content reuses the same version (no churn)', async () => {
    const first = (await generateSnapshot(env)).manifest as unknown as Manifest;
    const second = (await generateSnapshot(env)).manifest as unknown as Manifest;
    // v0.5 零人工：内容没变化就不产生新版本（cron 每小时跑，不刷版本号）
    expect(second.snapshot_version).toBe(first.snapshot_version);
  });

  it.skipIf(!env.SIGNING_PRIVATE_KEY)(
    '配置了签名密钥时，manifest 自带发布者签名且扩展内置公钥可验签',
    async () => {
      const result = await generateSnapshot(env);
      const manifest = result.manifest as unknown as Manifest & {
        signature?: { key_id: string; alg: 'ed25519'; sig: string };
      };
      expect(manifest.signature).toBeDefined();
      expect(manifest.signature?.key_id).toBe('release-1');

      const check = await verifyManifestSignature(
        buildSigningMessage({
          schemaVersion: manifest.schema_version,
          version: manifest.snapshot_version,
          generatedAt: manifest.generated_at,
          files: manifest.files.map((file) => ({
            path: file.path,
            sha256: file.sha256,
            count: file.entries,
          })),
        }),
        manifest.signature!,
        TRUSTED_KEYS,
      );
      expect(check).toEqual({ ok: true });

      // 公开端点下发的 manifest 与本地生成的一致（同样带签名）
      const latest = (await (
        await worker.fetch(new Request(`${ORIGIN}/v1/snapshots/latest`), env)
      ).json()) as Manifest & { signature?: unknown };
      expect(latest.signature).toBeDefined();
      expect(latest.snapshot_version).toBe(manifest.snapshot_version);
    },
  );

  it.skipIf(env.REQUIRE_SIGNED_SNAPSHOTS !== '1')(
    'REQUIRE_SIGNED_SNAPSHOTS 开启时，未签名的新行不会成为最新公开快照',
    async () => {
    const signed = (await generateSnapshot(env)).manifest as unknown as Manifest;
    // 直接插入一条「更新但未签名」的行 —— 模拟存储侧注入
    await env.DB.prepare(
      `INSERT INTO snapshots (version, manifest_json, signature_json, files_json, created_at)
       VALUES (?1, ?2, NULL, ?3, ?4)`,
    )
      .bind(
        '2099.01.01.1',
        JSON.stringify({
          schema_version: 2,
          snapshot_version: '2099.01.01.1',
          generated_at: '2099-01-01T00:00:00Z',
          files: [],
        }),
        '{}',
        Math.floor(Date.now() / 1000),
      )
      .run();

    const latest = (await (
      await worker.fetch(new Request(`${ORIGIN}/v1/snapshots/latest`), env)
    ).json()) as Manifest;
    // 门槛开启时跳过未签名行，仍返回已签名的最新版本
    expect(latest.snapshot_version).toBe(signed.snapshot_version);
    expect(latest.snapshot_version).not.toBe('2099.01.01.1');
  });

  it('快照发布写 R2（版本化 + latest 指针），latest 端点读 R2，meta 指针 O(1) 点读版本号', async () => {
    if (!env.KEYWORD_PACKS) return;
    const result = await generateSnapshot(env, 0, { bypassDailyOnce: true });
    const { snapshot_version } = result.manifest as unknown as Manifest;

    // R2 发布产物齐全：版本化文件（不可变缓存）+ latest 指针文件
    const [versioned, latestJson, latestYaml, latestManifest] = await Promise.all([
      env.KEYWORD_PACKS.get(`snapshots/${snapshot_version}/official.json`),
      env.KEYWORD_PACKS.get('snapshots/latest.json'),
      env.KEYWORD_PACKS.get('snapshots/latest.yaml'),
      env.KEYWORD_PACKS.get('snapshots/latest-manifest.json'),
    ]);
    expect(versioned).not.toBeNull();
    expect(latestJson).not.toBeNull();
    expect(latestYaml).not.toBeNull();
    expect(latestManifest).not.toBeNull();

    // meta 指针：getLatestSnapshotVersion 走 O(1) 点读返回最新版本
    expect(await getLatestSnapshotVersion(env)).toBe(snapshot_version);

    // blocklist/latest.json 从 R2 返回最新文件体，与发布版本一致
    const latestBody = await worker.fetch(
      new Request(`${ORIGIN}/v1/blocklist/latest.json`),
      env,
    );
    expect(latestBody.status).toBe(200);
    expect((await latestBody.json()) as { snapshot_version?: string }).toMatchObject({
      snapshot_version,
    });
  });
});
