import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { adminKeywordPacks, adminKeywordRules, meta } from '../src/db/schema';
import {
  getKeywordDetectorConfig,
  publishAdminKeywords,
  setKeywordDetectorConfig,
} from '../src/keyword-admin';
import {
  readAgentKeywordDetectorConfig,
  writeAgentKeywordDetectorConfig,
} from '../src/agent-admin';

const CONFIG = { combo: { minNameEmoji: 4 } } as const;
const BAD_CONFIG = { combo: { unknown_key: 1 } };

describe('keyword 发布链的 detector_config', () => {
  it('未设置且线上无携带时发布不带 config 段；设置后随发布写入官方 body', async () => {
    if (!env.KEYWORD_PACKS) return;
    const db = getDb(env);
    await db.delete(adminKeywordRules);
    await db.delete(adminKeywordPacks);
    await db.delete(meta).where(eq(meta.key, 'keyword_detector_config'));
    const seededAt = Math.floor(Date.now() / 1000);
    await db.insert(adminKeywordPacks).values({
      id: 'cfgpack',
      nameZh: '测试分类',
      nameEn: 'Test',
      descriptionZh: '测试',
      descriptionEn: 'Test',
      sourceRefs: '[]',
      active: 1,
      createdAt: seededAt,
      updatedAt: seededAt,
    });
    await db.insert(adminKeywordRules).values({
      id: 'cfg-rule',
      packId: 'cfgpack',
      phrase: '测试词组',
      active: 1,
      createdAt: seededAt,
      updatedAt: seededAt,
    });

    // 1. 无存值：发布不带段
    const plain = await publishAdminKeywords(env);
    const plainBody = JSON.parse(
      await (await env.KEYWORD_PACKS.get(`keyword-packs/${plain.version}/official.json`))!.text(),
    ) as Record<string, unknown>;
    expect('detector_config' in plainBody).toBe(false);

    // 2. 写入合法配置 → 保存即出现在 meta 且发布携带
    expect(await setKeywordDetectorConfig(env, CONFIG)).toBe(true);
    expect(await getKeywordDetectorConfig(env)).toEqual(CONFIG);
    const configured = await publishAdminKeywords(env);
    const configuredBody = JSON.parse(
      await (await env.KEYWORD_PACKS.get(
        `keyword-packs/${configured.version}/official.json`,
      ))!.text(),
    ) as { detector_config?: unknown };
    expect(configuredBody.detector_config).toEqual(CONFIG);

    // 3. 非法值 fail closed：不落库，旧值保留
    expect(await setKeywordDetectorConfig(env, BAD_CONFIG)).toBe(false);
    expect(await getKeywordDetectorConfig(env)).toEqual(CONFIG);

    // 4. meta 清除但线上最近发布携带 config：发布继承（不意外回退参数）
    expect(await setKeywordDetectorConfig(env, null)).toBe(true);
    const cleared = await publishAdminKeywords(env);
    const clearedBody = JSON.parse(
      await (await env.KEYWORD_PACKS.get(`keyword-packs/${cleared.version}/official.json`))!.text(),
    ) as { detector_config?: unknown };
    expect(clearedBody.detector_config).toEqual(CONFIG);

    // 5. 线上 latest 携带 config 时，下一次发布即使 meta 为空也继承（不意外回退参数）
    await env.KEYWORD_PACKS.put(
      `keyword-packs/${configured.version}/official.json`,
      JSON.stringify({ ...plainBody, detector_config: CONFIG }),
    );
    await env.KEYWORD_PACKS.put(
      'keyword-packs/latest.json',
      JSON.stringify({
        schema_version: 1,
        pack_version: configured.version,
        files: [{ path: 'official.json', sha256: 'a'.repeat(64), packs: 1, rules: 1 }],
      }),
    );
    const inherited = await publishAdminKeywords(env);
    const inheritedBody = JSON.parse(
      await (await env.KEYWORD_PACKS.get(
        `keyword-packs/${inherited.version}/official.json`,
      ))!.text(),
    ) as { detector_config?: unknown };
    expect(inheritedBody.detector_config).toEqual(CONFIG);
  });

  it('agent 读写端点复用同一存储：非法值拒绝，null 清除', async () => {
    if (!env.KEYWORD_PACKS) return;
    expect((await writeAgentKeywordDetectorConfig(env, BAD_CONFIG, 'agent:test')).ok).toBe(false);
    const written = await writeAgentKeywordDetectorConfig(env, CONFIG, 'agent:test');
    expect(written).toEqual({ ok: true, saved: true });
    expect(await readAgentKeywordDetectorConfig(env)).toEqual({ detector_config: CONFIG });
    const cleared = await writeAgentKeywordDetectorConfig(env, null, 'agent:test');
    expect(cleared).toEqual({ ok: true, saved: false });
    expect(await readAgentKeywordDetectorConfig(env)).toEqual({ detector_config: null });
  });
});
