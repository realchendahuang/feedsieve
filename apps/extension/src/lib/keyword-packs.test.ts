// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildSigningMessage,
  bytesToBase64,
  type ManifestSignature,
  type TrustedKey,
} from '@feedsieve/community-lists';
import {
  BUNDLED_KEYWORD_PACK_CATALOG,
  getKeywordPackCatalog,
  KEYWORD_PACK_SYNC_MAX_AGE_MS,
  parseKeywordPackCatalog,
  syncKeywordPackCatalog,
} from './keyword-packs';

let storage: Record<string, unknown>;

beforeEach(() => {
  storage = {};
  vi.stubGlobal('browser', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
        set: vi.fn(async (patch: Record<string, unknown>) => Object.assign(storage, patch)),
      },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  });
});

describe('远程关键词包契约', () => {
  it('构建时词库包含八个可订阅行业包、成人高召回规则和分词组合', () => {
    expect(BUNDLED_KEYWORD_PACK_CATALOG.pack_version).toBe('2026.09.02.5');
    expect(BUNDLED_KEYWORD_PACK_CATALOG.packs).toHaveLength(8);
    expect(
      BUNDLED_KEYWORD_PACK_CATALOG.packs.reduce((count, pack) => count + pack.rules.length, 0),
    ).toBe(778);
    expect(
      BUNDLED_KEYWORD_PACK_CATALOG.packs
        .find((pack) => pack.id === 'task_job_scam')
        ?.rules.some((rule) => rule.phrase === '刷单返利'),
    ).toBe(true);
    expect(
      BUNDLED_KEYWORD_PACK_CATALOG.packs.find((pack) => pack.id === 'adult_gray_traffic')?.rules,
    ).toHaveLength(629);
    expect(
      BUNDLED_KEYWORD_PACK_CATALOG.packs
        .find((pack) => pack.id === 'adult_gray_traffic')
        ?.rules.find((rule) => rule.id === 'adult-terms-local-door'),
    ).toMatchObject({
      phrase: '同城 + 上门',
      terms: ['同城', '上门'],
      max_gap: 12,
      name: { zh: '同城 + 上门', en: '同城 + 上门' },
    });
    expect(KEYWORD_PACK_SYNC_MAX_AGE_MS).toBe(15 * 60 * 1000);
  });

  it('拒绝重复规则 ID，避免远程包覆盖或混淆用户的逐条开关', () => {
    const invalid = structuredClone(BUNDLED_KEYWORD_PACK_CATALOG) as unknown as {
      packs: Array<{ rules: Array<{ id: string }> }>;
    };
    invalid.packs[1]!.rules[0]!.id = invalid.packs[0]!.rules[0]!.id;
    expect(parseKeywordPackCatalog(invalid)).toBeNull();
  });

  it('没有校验通过的远程缓存时，使用随扩展打包的公开版本', async () => {
    const catalog = await getKeywordPackCatalog();
    expect(catalog.pack_version).toBe(BUNDLED_KEYWORD_PACK_CATALOG.pack_version);
  });
});

const VERSION = '2026.09.02.5';

async function testKey(keyId = 'test-key-1'): Promise<{
  trustedKeys: TrustedKey[];
  sign: (message: string) => Promise<ManifestSignature>;
}> {
  const { publicKey, privateKey } = await crypto.subtle.generateKey(
    { name: 'Ed25519' },
    true,
    ['sign', 'verify'],
  );
  const pubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', publicKey));
  return {
    trustedKeys: [{ key_id: keyId, publicKeyBase64: bytesToBase64(pubRaw) }],
    sign: async (message: string) => {
      const sig = new Uint8Array(
        await crypto.subtle.sign(
          { name: 'Ed25519' },
          privateKey,
          new TextEncoder().encode(message),
        ),
      );
      return { key_id: keyId, alg: 'ed25519', sig: bytesToBase64(sig) };
    },
  };
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function catalogBody(version = VERSION): string {
  return JSON.stringify({
    schema_version: 1,
    pack_version: version,
    generated_at: '2026-09-02T00:00:00Z',
    packs: [
      {
        id: 'test_pack',
        name: { zh: '测试包', en: 'Test' },
        description: { zh: '测试', en: 'Test' },
        source_refs: ['test'],
        rules: [
          {
            id: 'test-rule-1',
            phrase: '测试规则',
            name: { zh: '测试规则', en: 'Test rule' },
          },
        ],
      },
    ],
  });
}

async function signedManifest(
  body: string,
  key: { trustedKeys: TrustedKey[]; sign: (m: string) => Promise<ManifestSignature> },
  overrides: Record<string, unknown> = {},
) {
  const sha256 = await sha256Hex(body);
  const payload = {
    schema_version: 1,
    pack_version: VERSION,
    generated_at: '2026-09-02T00:00:00Z',
    files: [{ path: 'official.json', sha256, packs: 1, rules: 1 }],
    ...overrides,
  };
  const message = buildSigningMessage({
    schemaVersion: payload.schema_version,
    version: payload.pack_version,
    generatedAt: payload.generated_at,
    files: payload.files.map((f) => ({ path: f.path, sha256: f.sha256, count: f.rules })),
  });
  return { ...payload, signature: await key.sign(message) };
}

describe('关键字词库同步与发布者签名', () => {
  async function setup(key: { trustedKeys: TrustedKey[]; sign: (m: string) => Promise<ManifestSignature> }, body = catalogBody()) {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/v1/keyword-packs/latest')) {
        return new Response(JSON.stringify(await signedManifest(body, key)), { status: 200 });
      }
      return new Response(body, { status: 200 });
    }) as unknown as typeof fetch;
    return fetchImpl;
  }

  it('签名有效时下载并缓存词库', async () => {
    const key = await testKey();
    const body = catalogBody();
    const fetchImpl = await setup(key, body);
    const outcome = await syncKeywordPackCatalog({
      force: true,
      fetchImpl,
      trustedKeys: key.trustedKeys,
    });
    expect(outcome).toEqual({ status: 'updated', version: VERSION });
    const catalog = await getKeywordPackCatalog();
    expect(catalog.pack_version).toBe(VERSION);
  });

  it('接受仓库构建产物中 generated_at 为 null 的 manifest（签名按 "null" 字节验证）', async () => {
    const key = await testKey();
    const body = catalogBody();
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/v1/keyword-packs/latest')) {
        return new Response(
          JSON.stringify(await signedManifest(body, key, { generated_at: null })),
          { status: 200 },
        );
      }
      return new Response(body, { status: 200 });
    }) as unknown as typeof fetch;
    const outcome = await syncKeywordPackCatalog({
      force: true,
      fetchImpl,
      trustedKeys: key.trustedKeys,
    });
    expect(outcome).toEqual({ status: 'updated', version: VERSION });
    expect((await getKeywordPackCatalog()).pack_version).toBe(VERSION);
  });

  it('拒绝无签名的 manifest，并保留 last-known-good', async () => {
    const key = await testKey();
    const body = catalogBody();
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/v1/keyword-packs/latest')) {
        const unsigned: Record<string, unknown> = await signedManifest(body, key);
        delete unsigned.signature;
        return new Response(JSON.stringify(unsigned), { status: 200 });
      }
      return new Response(body, { status: 200 });
    }) as unknown as typeof fetch;
    const outcome = await syncKeywordPackCatalog({
      force: true,
      fetchImpl,
      trustedKeys: key.trustedKeys,
    });
    expect(outcome).toEqual({ status: 'error', error: 'signature_missing' });
    expect((await getKeywordPackCatalog()).pack_version).toBe(
      BUNDLED_KEYWORD_PACK_CATALOG.pack_version,
    );
  });

  it('拒绝签名与 manifest 不匹配（篡改版本字段）', async () => {
    const key = await testKey();
    const body = catalogBody();
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/v1/keyword-packs/latest')) {
        const tampered = await signedManifest(body, key);
        tampered.pack_version = '2026.09.02.99';
        return new Response(JSON.stringify(tampered), { status: 200 });
      }
      return new Response(body, { status: 200 });
    }) as unknown as typeof fetch;
    const outcome = await syncKeywordPackCatalog({
      force: true,
      fetchImpl,
      trustedKeys: key.trustedKeys,
    });
    expect(outcome).toEqual({ status: 'error', error: 'signature_invalid' });
  });

  it('拒绝签名降级到旧版本', async () => {
    const key = await testKey();
    // 先存一个较新的缓存
    const newer = `2026.09.03.1`;
    storage['keywordPacksSnapshotV1'] = {
      pack_version: newer,
      body: catalogBody(newer),
      synced_at: 0,
    };
    const body = catalogBody(VERSION);
    const fetchImpl = await setup(key, body);
    const outcome = await syncKeywordPackCatalog({
      force: true,
      fetchImpl,
      trustedKeys: key.trustedKeys,
    });
    expect(outcome).toEqual({ status: 'error', error: 'rollback_rejected' });
    expect((await getKeywordPackCatalog()).pack_version).toBe(newer);
  });

  it('拒绝未知 key_id 的签名', async () => {
    const key = await testKey('main-key');
    const otherKey = await testKey('impostor-key');
    const body = catalogBody();
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/v1/keyword-packs/latest')) {
        return new Response(JSON.stringify(await signedManifest(body, otherKey)), { status: 200 });
      }
      return new Response(body, { status: 200 });
    }) as unknown as typeof fetch;
    const outcome = await syncKeywordPackCatalog({
      force: true,
      fetchImpl,
      trustedKeys: key.trustedKeys,
    });
    expect(outcome).toEqual({ status: 'error', error: 'unknown_key' });
  });
});
