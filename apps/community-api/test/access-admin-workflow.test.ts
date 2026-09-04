import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
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
    const manifest = JSON.parse(await (await env.KEYWORD_PACKS.get('keyword-packs/latest.json'))!.text()) as { pack_version: string };
    expect(manifest.pack_version).toBe(published.version);
    const release = await env.DB.prepare('SELECT kind, actor_email FROM admin_releases WHERE id = ?1')
      .bind(published.release_id)
      .first<{ kind: string; actor_email: string }>();
    expect(release).toEqual({ kind: 'keywords', actor_email: 'maintainer@example.com' });
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
});
