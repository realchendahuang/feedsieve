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
import { MAINTAINER_UPSERT_SQL } from '../src/maintainer-blocklist';
import { MAINTAINER_WHITELIST_UPSERT_SQL } from '../src/maintainer-whitelist';

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

  it('verified（社区白名单）与黑名单镜像入榜且互斥，争议账号两边都不进', async () => {
    // verified_user：5 个独立安装，第 1 个先拉黑后抢救（同安装改判 -> 只剩 allowed 票），
    // 其余 4 个只抢救 → 抢救净票 5 -> 进 verified（report_count 为 0 是改判语义，非自由票流失）
    const installs = [
      'vvvvvvvv-3001-4001-8000-vvvvvvvvvvvv',
      'vvvvvvvv-3002-4002-8000-vvvvvvvvvvvv',
      'vvvvvvvv-3003-4003-8000-vvvvvvvvvvvv',
      'vvvvvvvv-3004-4004-8000-vvvvvvvvvvvv',
      'vvvvvvvv-3005-4005-8000-vvvvvvvvvvvv',
    ];
    await report(installs[0], 'verified_user');
    for (const id of installs) await rescue(id, 'verified_user');

    // blocked_user：3 个独立安装拉黑 -> 净票 3 -> 黑名单 entries
    for (const id of installs.slice(0, 3)) await report(id, 'blocked_user_2');

    // contending_user：1 拉黑 + 2 抢救 -> 净票 -1，|净票| < 3 -> 两边都不进
    await report(installs[3], 'contending_user');
    await rescue(installs[0], 'contending_user');
    await rescue(installs[1], 'contending_user');

    await generateSnapshot(env, 0, { bypassDailyOnce: true });
    const res = await worker.fetch(
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
    expect(res.status).toBe(200);
    const body = JSON.parse(await res.text()) as {
      entries: { handle: string }[];
      verified?: {
        handle: string;
        x_user_id: string | null;
        rescue_count: number;
        report_count: number;
        net_votes: number;
      }[];
    };

    expect(body.verified).toHaveLength(1);
    expect(body.verified?.[0]).toMatchObject({
      handle: 'verified_user',
      x_user_id: null,
      rescue_count: 5,
      report_count: 0,
      net_votes: 5,
    });
    // 互斥：verified 账号不进黑名单 entries
    expect(body.entries.map((entry) => entry.handle)).not.toContain('verified_user');
    expect(body.entries.map((entry) => entry.handle)).toContain('blocked_user_2');
    // 争议账号（黑票压过白票或白票未达阈值）两边都不进
    expect(body.entries.map((entry) => entry.handle)).not.toContain('contending_user');
    expect(body.verified?.map((entry) => entry.handle)).not.toContain('contending_user');
  });

  it('verified 变化（抢救票产生白名单条目）会 mint 新版本而不是复用旧 body', async () => {
    const first = (await generateSnapshot(env, 0, { bypassDailyOnce: true })).manifest as unknown as Manifest;
    // 制造一个 rescue - report = 4 的新白名单条目（rescue_user 11 字符，合法 handle）
    const ids = [
      'wwwwwwww-4001-4001-8000-wwwwwwwwwwww',
      'wwwwwwww-4002-4002-8000-wwwwwwwwwwww',
      'wwwwwwww-4003-4003-8000-wwwwwwwwwwww',
      'wwwwwwww-4004-4004-8000-wwwwwwwwwwww',
    ];
    await report(ids[0], 'rescue_user');
    for (const id of ids) await rescue(id, 'rescue_user');

    const second = (await generateSnapshot(env, 0, { bypassDailyOnce: true })).manifest as unknown as Manifest;
    expect(second.snapshot_version).not.toBe(first.snapshot_version);
    const body = JSON.parse(
      await (
        await worker.fetch(
          new Request(
            `${ORIGIN}/v1/snapshots/${second.snapshot_version}/${SNAPSHOT_PACK}`,
          ),
          env,
        )
      ).text(),
    ) as { verified?: { handle: string }[] };
    expect(body.verified?.map((entry) => entry.handle)).toContain('rescue_user');
  });

  it('whitelist（公开白名单）：维护者条目进独立段，命中账号从黑名单 entries 让位', async () => {
    const installs = [
      'vvvvvvvv-3001-4001-8000-vvvvvvvvvvvv',
      'vvvvvvvv-3002-4002-8000-vvvvvvvvvvvv',
      'vvvvvvvv-3003-4003-8000-vvvvvvvvvvvv',
    ];
    // 同账号虽有 3 个黑票（单独看会进黑名单），白名单一票否决 -> 进 whitelist 段、不进 entries
    for (const id of installs) await report(id, 'vouched_user');
    await env.DB.prepare(MAINTAINER_WHITELIST_UPSERT_SQL)
      .bind('vouched_user', null, '误标申诉已核实：知名反诈骗博主', Date.now())
      .run();

    await generateSnapshot(env, 0, { bypassDailyOnce: true });
    const res = await worker.fetch(
      new Request(
        `${ORIGIN}/v1/snapshots/${
          ((await (await worker.fetch(new Request(`${ORIGIN}/v1/snapshots/latest`), env)).json()) as Manifest)
            .snapshot_version
        }/${SNAPSHOT_PACK}`,
      ),
      env,
    );
    expect(res.status).toBe(200);
    const body = JSON.parse(await res.text()) as {
      entries: { handle: string }[];
      whitelist?: { handle: string; x_user_id: string | null; note: string; added_at: string }[];
    };

    expect(body.whitelist).toHaveLength(1);
    expect(body.whitelist?.[0]).toMatchObject({
      handle: 'vouched_user',
      x_user_id: null,
      note: '误标申诉已核实：知名反诈骗博主',
    });
    expect(typeof body.whitelist?.[0]?.added_at).toBe('string');
    // 白名单优先于黑名单：命中账号不进 entries
    expect(body.entries.map((entry) => entry.handle)).not.toContain('vouched_user');
  });

  it('whitelist 变化会 mint 新版本而不是复用旧 body', async () => {
    const first = (await generateSnapshot(env, 0, { bypassDailyOnce: true })).manifest as unknown as Manifest;
    await env.DB.prepare(MAINTAINER_WHITELIST_UPSERT_SQL)
      .bind('second_vouch', '1234567890', '第二个公开白名单账号', Date.now())
      .run();

    const second = (await generateSnapshot(env, 0, { bypassDailyOnce: true })).manifest as unknown as Manifest;
    expect(second.snapshot_version).not.toBe(first.snapshot_version);
    const body = JSON.parse(
      await (
        await worker.fetch(
          new Request(
            `${ORIGIN}/v1/snapshots/${second.snapshot_version}/${SNAPSHOT_PACK}`,
          ),
          env,
        )
      ).text(),
    ) as { whitelist?: { handle: string }[] };
    expect(body.whitelist?.map((entry) => entry.handle)).toContain('second_vouch');
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

  it('REQUIRE_SIGNED_SNAPSHOTS=1 但签名密钥缺失时 fail fast，不发布扩展必拒的无签名快照', async () => {
    const misconfigured = {
      ...env,
      SIGNING_PRIVATE_KEY: undefined,
      SIGNING_KEY_ID: undefined,
      REQUIRE_SIGNED_SNAPSHOTS: '1',
    };
    await expect(generateSnapshot(misconfigured, 0, { bypassDailyOnce: true })).rejects.toThrow(
      'signing_key_missing',
    );
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

  it('维护者黑名单条目让位 verified：同 handle 只出现在 verified，不进 entries', async () => {
    // dual_role_user：1 拉黑 + 4 个独立安装抢救 → 抢救净票 3，满足 verified 公式；
    // 同时被维护者收录为黑名单条目。verified 是抢救成功的正常账号，黑名单让位 ——
    // 客户端对 handle 同时出现在 entries 与 verified 会整份拒绝（duplicate_snapshot_handle）。
    await report('dddddddd-6001-4601-8601-dddddddddddd', 'dual_role_user');
    for (const id of [
      'dddddddd-6002-4602-8602-dddddddddddd',
      'dddddddd-6003-4603-8603-dddddddddddd',
      'dddddddd-6004-4604-8604-dddddddddddd',
      'dddddddd-6005-4605-8605-dddddddddddd',
    ]) {
      await rescue(id, 'dual_role_user');
    }
    await env.DB.prepare(MAINTAINER_UPSERT_SQL).bind(
      'dual_role_user',
      null,
      'bot_spam',
      '测试条目：既是维护者收录又满足 verified 公式',
      null,
      Math.floor(Date.now() / 1000),
    ).run();

    await generateSnapshot(env, 0, { bypassDailyOnce: true });
    const res = await worker.fetch(
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
    expect(res.status).toBe(200);
    const body = JSON.parse(await res.text()) as {
      entries: { handle: string }[];
      verified?: { handle: string }[];
    };

    expect(body.verified?.map((entry) => entry.handle)).toContain('dual_role_user');
    expect(body.entries.map((entry) => entry.handle)).not.toContain('dual_role_user');
  });
});
