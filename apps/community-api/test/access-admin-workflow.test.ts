import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import {
  buildSigningMessage,
  compareManifestVersions,
  TRUSTED_KEYS,
  verifyManifestSignature,
} from '@feedsieve/community-lists';
import {
  deactivateAdminAccountDraft,
  listAdminAccountDrafts,
  publishAdminAccountDrafts,
  rollbackAdminAccountRelease,
  saveAdminAccountDraft,
} from '../src/admin-accounts';
import { listMaintainerEntries } from '../src/maintainer-blocklist';
import {
  importKeywordCatalog,
  listAdminKeywords,
  publishAdminKeywords,
  rollbackAdminKeywordRelease,
  saveAdminKeywordPack,
  saveAdminKeywordRule,
} from '../src/keyword-admin';

const VERSION = '2026.09.02.5';

describe('Access 管理后台工作区', () => {
  it('imports the current keyword release into drafts and publishes an explicit next release', async () => {
    if (!env.KEYWORD_PACKS) return;
    await env.DB.batch([
      env.DB.prepare('DELETE FROM admin_keyword_rules'),
      env.DB.prepare('DELETE FROM admin_keyword_packs'),
      env.DB.prepare('DELETE FROM admin_releases'),
      env.DB.prepare('DELETE FROM admin_audit_log'),
    ]);
    const source = {
      schema_version: 1,
      pack_version: VERSION,
      generated_at: null,
      packs: [{
        id: 'workflow_pack',
        name: { zh: '工作流分类', en: 'Workflow pack' },
        description: { zh: '工作流测试分类', en: 'Workflow test pack' },
        source_refs: ['test'],
        rules: [{ id: 'workflow-rule', phrase: '工作流词组', name: { zh: '工作流词组', en: '工作流词组' } }],
      }],
    };
    await env.KEYWORD_PACKS.put('keyword-packs/latest.json', JSON.stringify({
      schema_version: 1,
      pack_version: VERSION,
      files: [{ path: 'official.json', sha256: 'a'.repeat(64), packs: 1, rules: 1 }],
    }));
    await env.KEYWORD_PACKS.put(`keyword-packs/${VERSION}/official.json`, JSON.stringify(source));

    // 导入是显式动作：空表时列表不自动拉取，需要维护者主动导入。
    expect(await listAdminKeywords(env)).toEqual({ packs: [], rules: [] });
    const importResult = await importKeywordCatalog(env);
    expect(importResult).toMatchObject({ imported: true, packs: 1, rules: 1 });
    // 已有草稿时重复导入是幂等 no-op，不会覆盖维护者草稿。
    expect(await importKeywordCatalog(env)).toMatchObject({ imported: false });

    const imported = await listAdminKeywords(env);
    expect(imported.packs).toContainEqual(expect.objectContaining({ id: 'workflow_pack', name_zh: '工作流分类', active: true }));
    expect(imported.rules).toContainEqual(expect.objectContaining({ id: 'workflow-rule', phrase: '工作流词组', active: true }));

    // 搜索参数过滤规则列表。
    const searched = await listAdminKeywords(env, { q: '工作流' });
    expect(searched.rules).toHaveLength(1);
    expect(await listAdminKeywords(env, { q: '不存在的词组' })).toMatchObject({ rules: [] });

    const pack = await saveAdminKeywordPack(env, {
      name_zh: '新增分类',
      description_zh: '新增分类的测试描述',
    }, 'maintainer@example.com');
    expect(pack?.id).toMatch(/^pack_/);
    const rule = await saveAdminKeywordRule(env, {
      pack_id: pack?.id,
      phrase: '新增词组',
      terms: ['新增', '词组'],
      max_gap: 12,
    }, 'maintainer@example.com');
    expect(rule?.id).toMatch(/^rule-/);

    const published = await publishAdminKeywords(env, 'maintainer@example.com');
    expect(published.version).toMatch(/^\d{4}\.\d{2}\.\d{2}\.\d+$/);
    const latestText = await (await env.KEYWORD_PACKS.get('keyword-packs/latest.json'))!.text();
    const manifest = JSON.parse(latestText) as {
      pack_version: string;
      generated_at: string;
      files: Array<{ path: string; sha256: string; rules: number }>;
      signature?: { key_id: string; alg: 'ed25519'; sig: string };
    };
    expect(manifest.pack_version).toBe(published.version);
    const release = await env.DB.prepare('SELECT kind, actor_email FROM admin_releases WHERE id = ?1')
      .bind(published.release_id)
      .first<{ kind: string; actor_email: string }>();
    expect(release).toEqual({ kind: 'keywords', actor_email: 'maintainer@example.com' });

    // 配置了发布密钥（本地 .dev.vars / 生产 secrets）时，manifest 必须带 release-1
    // 签名且扩展内置公钥可验签 —— 无签名 latest 会被扩展 signature_missing 拒绝。
    if (env.SIGNING_PRIVATE_KEY && env.SIGNING_KEY_ID) {
      expect(manifest.signature?.key_id).toBe('release-1');
      const check = await verifyManifestSignature(
        buildSigningMessage({
          schemaVersion: 1,
          version: manifest.pack_version,
          generatedAt: manifest.generated_at,
          files: manifest.files.map((file) => ({
            path: file.path,
            sha256: file.sha256,
            count: file.rules,
          })),
        }),
        manifest.signature!,
        TRUSTED_KEYS,
      );
      expect(check).toEqual({ ok: true });
    }
  });

  it('rolls a keyword release back as a new signed version, not a version reuse', async () => {
    if (!env.KEYWORD_PACKS) return;
    await env.DB.batch([
      env.DB.prepare('DELETE FROM admin_keyword_rules'),
      env.DB.prepare('DELETE FROM admin_keyword_packs'),
      env.DB.prepare('DELETE FROM admin_releases'),
      env.DB.prepare('DELETE FROM admin_audit_log'),
    ]);
    const pack = await saveAdminKeywordPack(env, {
      name_zh: '回滚分类',
      description_zh: '回滚测试分类',
      source_refs: ['test'],
    }, 'maintainer@example.com');
    expect(pack?.id).toMatch(/^pack_/);
    await saveAdminKeywordRule(env, {
      pack_id: pack?.id,
      phrase: '回滚词一',
    }, 'maintainer@example.com');
    const v1 = await publishAdminKeywords(env, 'maintainer@example.com');
    await saveAdminKeywordRule(env, {
      pack_id: pack?.id,
      phrase: '回滚词二',
    }, 'maintainer@example.com');
    const v2 = await publishAdminKeywords(env, 'maintainer@example.com');
    expect(compareManifestVersions(v2.version, v1.version)).toBe(1);

    const rolled = await rollbackAdminKeywordRelease(env, v1.version, 'maintainer@example.com');
    expect(rolled.restored_version).toBe(v1.version);
    // 客户端防回滚：内容回滚必须以比最新版更大的版本号下发
    expect(compareManifestVersions(rolled.version, v2.version)).toBe(1);

    const restoredBody = await (await env.KEYWORD_PACKS.get(`keyword-packs/${rolled.version}/official.json`))!.text();
    const restored = JSON.parse(restoredBody) as {
      pack_version: string;
      packs: Array<{ rules: unknown[] }>;
    };
    expect(restored.pack_version).toBe(rolled.version);
    // 恢复的是 v1 的内容（一条规则），而不是 v2 的两条
    expect(restored.packs.flatMap((entry) => entry.rules)).toHaveLength(1);

    const latestText = await (await env.KEYWORD_PACKS.get('keyword-packs/latest.json'))!.text();
    const latest = JSON.parse(latestText) as {
      pack_version: string;
      generated_at: string;
      files: Array<{ path: string; sha256: string; rules: number }>;
      signature?: { key_id: string; alg: 'ed25519'; sig: string };
    };
    expect(latest.pack_version).toBe(rolled.version);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(restoredBody));
    const sha256 = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    expect(latest.files[0]!.sha256).toBe(sha256);
    if (env.SIGNING_PRIVATE_KEY && env.SIGNING_KEY_ID) {
      expect(latest.signature?.key_id).toBe('release-1');
      const check = await verifyManifestSignature(
        buildSigningMessage({
          schemaVersion: 1,
          version: latest.pack_version,
          generatedAt: latest.generated_at,
          files: latest.files.map((file) => ({
            path: file.path,
            sha256: file.sha256,
            count: file.rules,
          })),
        }),
        latest.signature!,
        TRUSTED_KEYS,
      );
      expect(check).toEqual({ ok: true });
    }

    const releaseRecord = await env.DB
      .prepare('SELECT kind, version, detail FROM admin_releases WHERE id = ?1')
      .bind(rolled.release_id)
      .first<{ kind: string; version: string; detail: string }>();
    expect(releaseRecord?.kind).toBe('keywords');
    expect(releaseRecord?.version).toBe(rolled.version);
    expect(JSON.parse(releaseRecord?.detail ?? '{}')).toEqual({
      action: 'rollback',
      restored_version: v1.version,
      sha256,
    });
    expect(await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = ?1 AND target_type = ?2 AND target_id = ?3',
    ).bind('rollback', 'keywords', rolled.version).first<{ n: number }>()).toEqual({ n: 1 });
  });

  it('refuses to publish when REQUIRE_SIGNED_KEYWORD_PACKS=1 but signing keys are missing', async () => {
    if (!env.KEYWORD_PACKS) return;
    await env.DB.batch([
      env.DB.prepare('DELETE FROM admin_keyword_rules'),
      env.DB.prepare('DELETE FROM admin_keyword_packs'),
    ]);
    const pack = await saveAdminKeywordPack(env, {
      name_zh: '门禁分类',
      description_zh: '门禁测试分类',
    }, 'maintainer@example.com');
    await saveAdminKeywordRule(env, { pack_id: pack?.id, phrase: '门禁词' }, 'maintainer@example.com');
    const strictEnv = {
      ...env,
      SIGNING_PRIVATE_KEY: undefined,
      SIGNING_KEY_ID: undefined,
      REQUIRE_SIGNED_KEYWORD_PACKS: '1',
    };
    await expect(publishAdminKeywords(strictEnv, 'maintainer@example.com')).rejects.toThrow(
      'signing_key_missing',
    );
  });

  it('keeps account edits as drafts until publication and restores an account release', async () => {
    if (!env.KEYWORD_PACKS) return;
    const handle = 'draftworkflow1';
    const saved = await saveAdminAccountDraft(env, {
      handle,
      category: 'scam_phishing',
      note: '用于验证名单草稿和发布流程',
    });
    expect(saved).toMatchObject({ ok: true, action: 'add', entry: { handle, active: true } });
    expect(await saveAdminAccountDraft(env, {
      handle,
      category: 'scam_phishing',
      note: '用于验证名单草稿和发布流程二',
    })).toMatchObject({ ok: true, action: 'update' });
    expect((await listMaintainerEntries(env, true)).find((entry) => entry.handle === handle)).toBeUndefined();

    // 搜索参数过滤草稿列表。
    expect(await listAdminAccountDrafts(env, { q: handle })).toHaveLength(1);
    expect(await listAdminAccountDrafts(env, { q: 'nomatchhandle' })).toHaveLength(0);

    const first = await publishAdminAccountDrafts(env, 'maintainer@example.com');
    expect(first.snapshot_version).toMatch(/^\d{4}\.\d{2}\.\d{2}\.\d+$/);
    expect((await listMaintainerEntries(env, true)).find((entry) => entry.handle === handle)?.active).toBe(true);

    expect(await deactivateAdminAccountDraft(env, handle)).toEqual({ ok: true, changed: true });
    await publishAdminAccountDrafts(env, 'maintainer@example.com');
    expect((await listMaintainerEntries(env, true)).find((entry) => entry.handle === handle)?.active).toBe(false);

    const restored = await rollbackAdminAccountRelease(env, first.release_id, 'maintainer@example.com');
    expect(restored.rollback_of).toBe(first.release_id);
    expect((await listAdminAccountDrafts(env)).find((entry) => entry.handle === handle)?.active).toBe(true);
    expect((await listMaintainerEntries(env, true)).find((entry) => entry.handle === handle)?.active).toBe(true);
  });

  it('词库并发发布不产出 torn 写（manifest 与文件体 sha256 一致）', async () => {
    if (!env.KEYWORD_PACKS) return;
    await env.DB.batch([
      env.DB.prepare('DELETE FROM admin_keyword_rules'),
      env.DB.prepare('DELETE FROM admin_keyword_packs'),
      env.DB.prepare('DELETE FROM admin_releases'),
    ]);
    const pack = await saveAdminKeywordPack(env, {
      name_zh: '并发分类',
      description_zh: '并发发布互斥测试',
      source_refs: ['test'],
    }, 'maintainer@example.com');
    expect(pack?.id).toMatch(/^pack_/);
    await saveAdminKeywordRule(env, {
      pack_id: pack?.id,
      phrase: '并发词一',
    }, 'maintainer@example.com');
    // 保存即发布与双击都会并发进 publish：互斥后必须串行算版本号，
    // 最终 latest manifest 的 sha256 必须与版本化文件体一致。
    const [a, b] = await Promise.all([
      publishAdminKeywords(env, 'maintainer@example.com'),
      publishAdminKeywords(env, 'maintainer@example.com'),
    ]);
    const latestRaw = await (await env.KEYWORD_PACKS.get('keyword-packs/latest.json'))!.text();
    const manifest = JSON.parse(latestRaw) as {
      pack_version: string;
      files: Array<{ path: string; sha256: string }>;
    };
    const body = await (await env.KEYWORD_PACKS.get(`keyword-packs/${manifest.pack_version}/official.json`))!.text();
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
    const actualSha = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
    expect(manifest.files[0]?.sha256).toBe(actualSha);
    expect([a.version, b.version]).toContain(manifest.pack_version);
  });
});
