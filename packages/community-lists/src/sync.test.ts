import { beforeAll, describe, expect, it, vi } from 'vitest';
import { sha256Hex } from './hash';
import {
  buildSigningMessage,
  bytesToBase64,
  type ManifestSignature,
  type TrustedKey,
} from './signing';
import { syncCommunitySnapshot, workerSource, type SnapshotStore, type SyncSource } from './sync';
import { parseSnapshotBody } from './validate';
import type { StoredSnapshot } from './types';

const API = 'https://api.example.com';
const VERSION = '2026.08.28.1';
const SHA = 'b'.repeat(64);

/** 测试专用 ephemeral 密钥：manifest 需由调用方用可信公钥验签，缺省用内置 TRUSTED_KEYS。 */
interface TestKey {
  keyId: string;
  trustedKeys: TrustedKey[];
  sign: (message: string) => Promise<ManifestSignature>;
}

/** 用 WebCrypto 生成 —— 与 Worker 侧 signManifestMessage 走同一套实现。 */
async function testKey(keyId = 'test-1'): Promise<TestKey> {
  const { publicKey, privateKey } = await crypto.subtle.generateKey(
    { name: 'Ed25519' },
    true,
    ['sign', 'verify'],
  );
  const pubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', publicKey));
  return {
    keyId,
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

let TEST_KEY: TestKey;

beforeAll(async () => {
  TEST_KEY = await testKey();
});

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function snapshotBodyText(version = VERSION, entries: unknown[] = []): string {
  return JSON.stringify({
    schema_version: 2,
    snapshot_version: version,
    generated_at: '2026-08-28T00:00:00Z',
    entries,
  });
}

async function signManifestPayload(
  payload: {
    schema_version: number;
    snapshot_version: string;
    generated_at: string;
    files: Array<{ path: string; sha256: string; entries: number }>;
  },
  key: TestKey = TEST_KEY,
): Promise<Record<string, unknown>> {
  const message = buildSigningMessage({
    schemaVersion: payload.schema_version,
    version: payload.snapshot_version,
    generatedAt: payload.generated_at,
    files: payload.files.map((f) => ({ path: f.path, sha256: f.sha256, count: f.entries })),
  });
  return { ...payload, signature: await key.sign(message) };
}

function manifest(overrides: Record<string, unknown> = {}, key: TestKey = TEST_KEY) {
  return signManifestPayload(
    {
      schema_version: 2,
      snapshot_version: VERSION,
      generated_at: '2026-08-28T00:00:00Z',
      files: [
        { path: 'blocklist.yaml', sha256: 'a'.repeat(64), entries: 0 },
        { path: 'official.json', sha256: SHA, entries: 0 },
      ],
      ...overrides,
    },
    key,
  );
}

function memoryStore(initial: StoredSnapshot | null = null): SnapshotStore & {
  readonly data: StoredSnapshot | null;
} {
  const impl = { data: initial } as { data: StoredSnapshot | null };
  return {
    get: async () => impl.data,
    set: async (v: StoredSnapshot) => {
      impl.data = v;
    },
    get data() {
      return impl.data;
    },
  };
}

function okFetch(bodyText: string, manifestPayload: unknown) {
  return vi.fn(async (url: string) => {
    if (url.endsWith('/v1/snapshots/latest')) {
      return jsonResponse(manifestPayload);
    }
    return new Response(bodyText, { status: 200 });
  }) as unknown as (url: string) => Promise<Response>;
}

async function realSha(bodyText: string): Promise<string> {
  return sha256Hex(bodyText);
}

describe('syncCommunitySnapshot', () => {
  it('downloads, verifies checksum, and stores a new snapshot', async () => {
    const body = snapshotBodyText();
    const store = memoryStore();
    const fetchImpl = okFetch(
      body,
      await manifest({ files: [{ path: 'official.json', sha256: await realSha(body), entries: 0 }] }),
    );

    const outcome = await syncCommunitySnapshot({
      sources: [workerSource(API)],
      fetchImpl,
      store,
      force: true,
      trustedKeys: TEST_KEY.trustedKeys,
    });

    expect(outcome).toEqual({ status: 'updated', version: VERSION });
    expect(store.data?.snapshot_version).toBe(VERSION);
    expect(JSON.parse(store.data!.body).entries).toEqual([]);
  });

  it('selects official.json when the readable YAML is listed first', async () => {
    const body = snapshotBodyText();
    const store = memoryStore();
    const fetchImpl = okFetch(
      body,
      await manifest({
        files: [
          { path: 'blocklist.yaml', sha256: 'a'.repeat(64), entries: 0 },
          { path: 'official.json', sha256: await realSha(body), entries: 0 },
        ],
      }),
    );

    expect(
      await syncCommunitySnapshot({
        sources: [workerSource(API)],
        fetchImpl,
        store,
        force: true,
        trustedKeys: TEST_KEY.trustedKeys,
      }),
    ).toEqual({ status: 'updated', version: VERSION });
    expect(store.data?.body).toBe(body);
  });

  it('rejects an unsigned manifest', async () => {
    const store = memoryStore();
    const unsigned = await manifest();
    delete unsigned.signature;
    const fetchImpl = okFetch(snapshotBodyText(), unsigned);

    const outcome = await syncCommunitySnapshot({
      sources: [workerSource(API)],
      fetchImpl,
      store,
      force: true,
      trustedKeys: TEST_KEY.trustedKeys,
    });

    expect(outcome).toEqual({ status: 'error', error: 'signature_missing' });
    expect(store.data).toBeNull();
  });

  it('rejects a manifest signed with an unknown key', async () => {
    const store = memoryStore();
    const otherKey = await testKey('other-1');
    const fetchImpl = okFetch(
      snapshotBodyText(),
      await manifest({}, otherKey),
    );

    const outcome = await syncCommunitySnapshot({
      sources: [workerSource(API)],
      fetchImpl,
      store,
      force: true,
      trustedKeys: TEST_KEY.trustedKeys,
    });

    expect(outcome).toEqual({ status: 'error', error: 'unknown_key' });
    expect(store.data).toBeNull();
  });

  it('rejects a signature that does not match the manifest (tampered version)', async () => {
    const store = memoryStore();
    // 先按 VERSION 签名，再把版本字段换成另一个 —— 模拟「同时替换 manifest 与内容」
    const tampered = await signManifestPayload({
      schema_version: 2,
      snapshot_version: VERSION,
      generated_at: '2026-08-28T00:00:00Z',
      files: [{ path: 'official.json', sha256: SHA, entries: 0 }],
    });
    tampered.snapshot_version = '2026.08.28.2';
    const fetchImpl = okFetch(snapshotBodyText('2026.08.28.2'), tampered);

    const outcome = await syncCommunitySnapshot({
      sources: [workerSource(API)],
      fetchImpl,
      store,
      force: true,
      trustedKeys: TEST_KEY.trustedKeys,
    });

    expect(outcome).toEqual({ status: 'error', error: 'signature_invalid' });
    expect(store.data).toBeNull();
  });

  it('rejects a signed rollback to an older snapshot version', async () => {
    const store = memoryStore({
      snapshot_version: '2026.08.29.1',
      body: snapshotBodyText('2026.08.29.1'),
      synced_at: 1,
    });
    // 旧版本由同一发布者正确签名 —— 签名只能证明「官方签过」，不能让它覆盖较新的缓存
    const older = await manifest({ snapshot_version: '2026.08.28.1' });
    const fetchImpl = okFetch(snapshotBodyText('2026.08.28.1'), older);

    const outcome = await syncCommunitySnapshot({
      sources: [workerSource(API)],
      fetchImpl,
      store,
      force: true,
      trustedKeys: TEST_KEY.trustedKeys,
    });

    expect(outcome).toEqual({ status: 'error', error: 'rollback_rejected' });
    expect(store.data?.snapshot_version).toBe('2026.08.29.1');
  });

  it('rejects a snapshot whose checksum does not match the manifest', async () => {
    const store = memoryStore();
    const fetchImpl = okFetch(snapshotBodyText(), await manifest());

    const outcome = await syncCommunitySnapshot({
      sources: [workerSource(API)],
      fetchImpl,
      store,
      force: true,
      trustedKeys: TEST_KEY.trustedKeys,
    });

    expect(outcome).toEqual({ status: 'error', error: 'checksum_mismatch' });
    expect(store.data).toBeNull();
  });

  it('keeps last-known-good when the server errors', async () => {
    const good: StoredSnapshot = {
      snapshot_version: '2026.08.27.3',
      body: snapshotBodyText('2026.08.27.3'),
      synced_at: 1,
    };
    const store = memoryStore(good);
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 500 })) as unknown as (
      url: string,
    ) => Promise<Response>;

    const outcome = await syncCommunitySnapshot({
      sources: [workerSource(API)],
      fetchImpl,
      store,
      force: true,
      trustedKeys: TEST_KEY.trustedKeys,
    });

    expect(outcome).toEqual({ status: 'error', error: 'manifest_http_500' });
    expect(store.data?.snapshot_version).toBe('2026.08.27.3');
  });

  it('falls back to the next source when the first one fails', async () => {
    const body = snapshotBodyText();
    const store = memoryStore();
    const mirror: SyncSource = {
      manifestUrl: 'https://mirror.example.com/manifest.json',
      fileUrl: (_version, path) => `https://mirror.example.com/${path}`,
    };
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.startsWith(API)) {
        return new Response('down', { status: 503 });
      }
      if (url === mirror.manifestUrl) {
        return jsonResponse(
          await manifest({ files: [{ path: 'official.json', sha256: await realSha(body), entries: 0 }] }),
        );
      }
      return new Response(body, { status: 200 });
    }) as unknown as (url: string) => Promise<Response>;

    const outcome = await syncCommunitySnapshot({
      sources: [workerSource(API), mirror],
      fetchImpl,
      store,
      force: true,
      trustedKeys: TEST_KEY.trustedKeys,
    });

    expect(outcome).toEqual({ status: 'updated', version: VERSION });
    expect(store.data?.snapshot_version).toBe(VERSION);
  });

  it('skips when synced recently and not forced', async () => {
    const store = memoryStore({ snapshot_version: VERSION, body: '{}', synced_at: 1000 });
    const fetchImpl = vi.fn(async () => {
      throw new Error('must not be called');
    }) as unknown as (url: string) => Promise<Response>;

    const outcome = await syncCommunitySnapshot({
      sources: [workerSource(API)],
      fetchImpl,
      store,
      now: () => 1000 + 60 * 60 * 1000,
    });

    expect(outcome).toEqual({ status: 'skipped' });
  });

  it('unchanged version only refreshes synced_at', async () => {
    const body = snapshotBodyText();
    const store = memoryStore({
      snapshot_version: VERSION,
      body,
      synced_at: 0,
    });
    const fetchImpl = okFetch(
      body,
      await manifest({ files: [{ path: 'official.json', sha256: await realSha(body), entries: 0 }] }),
    );

    const outcome = await syncCommunitySnapshot({
      sources: [workerSource(API)],
      fetchImpl,
      store,
      force: true,
      now: () => 5555,
      trustedKeys: TEST_KEY.trustedKeys,
    });

    expect(outcome).toEqual({ status: 'unchanged' });
    expect(store.data?.synced_at).toBe(5555);
    expect(store.data?.body).toBe(body);
  });

  it('rejects malformed manifests and bodies', async () => {
    const store = memoryStore();
    const badManifest = await syncCommunitySnapshot({
      sources: [workerSource(API)],
      fetchImpl: okFetch('{}', await manifest({ snapshot_version: 'not-a-version' })),
      store,
      force: true,
      trustedKeys: TEST_KEY.trustedKeys,
    });
    expect(badManifest).toMatchObject({ status: 'error' });

    const badBody = snapshotBodyText(VERSION, [{ handle: '!!!' }]);
    const badEntries = await syncCommunitySnapshot({
      sources: [workerSource(API)],
      fetchImpl: okFetch(
        badBody,
        await manifest({
          files: [{ path: 'official.json', sha256: await realSha(badBody), entries: 1 }],
        }),
      ),
      store,
      force: true,
      trustedKeys: TEST_KEY.trustedKeys,
    });
    expect(badEntries).toEqual({ status: 'error', error: 'invalid_snapshot_entry' });
    expect(await store.get()).toBeNull();
  });
});

describe('parseSnapshotBody: content evidence (v0.4)', () => {
  const baseEntry = {
    handle: 'evidence_user',
    x_user_id: null,
    category: 'copy_paste',
    sources: ['community'],
    community_score: 0.63,
    report_count: 5,
    rescue_count: 0,
    net_votes: 5,
    first_seen_at: '2026-08-28T00:00:00Z',
    updated_at: '2026-08-28T00:00:00Z',
    evidence_post_ids: [],
  };

  function parse(entries: unknown[]) {
    const result = parseSnapshotBody(
      JSON.stringify({
        schema_version: 2,
        snapshot_version: VERSION,
        generated_at: '2026-08-28T00:00:00Z',
        entries,
      }),
    );
    expect(result.ok).toBe(true);
    return result.ok ? result.value.entries : [];
  }

  it('keeps valid fingerprint/domain lists', () => {
    const entries = parse([
      {
        ...baseEntry,
        fingerprints: ['aaaaaaaaaaaaaaaa', 'abcdef0123456789'],
        domains: ['Scam-Sity.Example'],
      },
    ]);
    expect(entries[0]?.fingerprints).toEqual(['aaaaaaaaaaaaaaaa', 'abcdef0123456789']);
    expect(entries[0]?.domains).toEqual(['scam-sity.example']);
  });

  it('rejects the whole snapshot when an evidence field is malformed', () => {
    const result = parseSnapshotBody(
      JSON.stringify({
        schema_version: 2,
        snapshot_version: VERSION,
        generated_at: '2026-08-28T00:00:00Z',
        entries: [{ ...baseEntry, fingerprints: ['NOT-HEX'] }],
      }),
    );
    expect(result).toEqual({ ok: false, error: 'invalid_snapshot_entry' });
  });

  it('tolerates entries without evidence fields (older snapshots)', () => {
    const entries = parse([{ ...baseEntry }]);
    expect(entries[0]?.fingerprints).toBeUndefined();
    expect(entries[0]?.domains).toBeUndefined();
  });
});

describe('parseSnapshotBody: kill_switch（官方暂停开关）', () => {
  function bodyWithKillSwitch(killSwitch: unknown): string {
    return JSON.stringify({
      schema_version: 2,
      snapshot_version: VERSION,
      generated_at: '2026-08-28T00:00:00Z',
      entries: [],
      ...(killSwitch !== undefined ? { kill_switch: killSwitch } : {}),
    });
  }

  it('接受合法 kill_switch 并透出 reason', () => {
    const result = parseSnapshotBody(
      bodyWithKillSwitch({
        destructive_actions_disabled: true,
        reason: '接口排查中',
        disabled_since: '2026-09-07T00:00:00Z',
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.ok ? result.value.kill_switch : null).toEqual({
      destructive_actions_disabled: true,
      reason: '接口排查中',
      disabled_since: '2026-09-07T00:00:00Z',
    });
  });

  it('无 kill_switch 字段时保持缺省（旧快照兼容）', () => {
    const result = parseSnapshotBody(bodyWithKillSwitch(undefined));
    expect(result.ok).toBe(true);
    expect(result.ok ? result.value.kill_switch : undefined).toBeUndefined();
  });

  it('畸形 kill_switch 使整份快照失败（保持 last-known-good）', () => {
    expect(parseSnapshotBody(bodyWithKillSwitch({ destructive_actions_disabled: false }))).toEqual(
      { ok: false, error: 'invalid_kill_switch' },
    );
    expect(parseSnapshotBody(bodyWithKillSwitch('yes'))).toEqual({
      ok: false,
      error: 'invalid_kill_switch',
    });
    expect(
      parseSnapshotBody(bodyWithKillSwitch({ destructive_actions_disabled: true, reason: '' })),
    ).toEqual({ ok: false, error: 'invalid_kill_switch' });
    expect(
      parseSnapshotBody(
        bodyWithKillSwitch({ destructive_actions_disabled: true, reason: 'x'.repeat(201) }),
      ),
    ).toEqual({ ok: false, error: 'invalid_kill_switch' });
  });
});

describe('parseSnapshotBody: verified（社区白名单）', () => {
  function bodyWithVerified(verified: unknown, entries: unknown[] = []): string {
    return JSON.stringify({
      schema_version: 2,
      snapshot_version: VERSION,
      generated_at: '2026-08-28T00:00:00Z',
      entries,
      ...(verified !== undefined ? { verified } : {}),
    });
  }

  const validEntry = {
    handle: 'verified_user',
    x_user_id: null,
    rescue_count: 5,
    report_count: 1,
    net_votes: 4,
    first_seen_at: '2026-08-28T00:00:00Z',
    updated_at: '2026-08-28T00:00:00Z',
  };

  it('接受合法 verified 列表并透出条目', () => {
    const result = parseSnapshotBody(bodyWithVerified([validEntry]));
    expect(result.ok).toBe(true);
    expect(result.ok ? result.value.verified : null).toEqual([validEntry]);
  });

  it('无 verified 字段时保持缺省（旧快照兼容）', () => {
    const result = parseSnapshotBody(bodyWithVerified(undefined));
    expect(result.ok).toBe(true);
    expect(result.ok ? result.value.verified : undefined).toBeUndefined();
  });

  it('net_votes invariant 不符（rescue - report）整份拒绝', () => {
    const result = parseSnapshotBody(
      bodyWithVerified([{ ...validEntry, net_votes: 9 }]),
    );
    expect(result).toEqual({ ok: false, error: 'invalid_verified_list' });
  });

  it('净票 < 3 的条目整份拒绝（豁免门槛防呆）', () => {
    const result = parseSnapshotBody(
      bodyWithVerified([{ ...validEntry, rescue_count: 2, report_count: 1, net_votes: 1 }]),
    );
    expect(result).toEqual({ ok: false, error: 'invalid_verified_list' });
  });

  it('verified 内部重复 handle 整份拒绝', () => {
    const result = parseSnapshotBody(bodyWithVerified([validEntry, validEntry]));
    expect(result).toEqual({ ok: false, error: 'invalid_verified_list' });
  });

  it('verified 与黑名单 entries handle 重复整份拒绝（防御双发）', () => {
    const entry = {
      handle: 'dupe_user',
      x_user_id: null,
      aliases: [],
      category: 'bot_spam',
      sources: ['community'],
      community_score: 0.8,
      report_count: 5,
      rescue_count: 0,
      net_votes: 5,
      first_seen_at: '2026-08-28T00:00:00Z',
      updated_at: '2026-08-28T00:00:00Z',
      evidence_post_ids: [],
    };
    const result = parseSnapshotBody(
      bodyWithVerified([{ ...validEntry, handle: 'dupe_user' }], [entry]),
    );
    expect(result).toEqual({ ok: false, error: 'duplicate_snapshot_handle' });
  });

  it('畸形 verified（非数组 / 坏条目）整份拒绝（保持 last-known-good）', () => {
    expect(parseSnapshotBody(bodyWithVerified('yes'))).toEqual({
      ok: false,
      error: 'invalid_verified_list',
    });
    expect(parseSnapshotBody(bodyWithVerified([{ ...validEntry, handle: 'TOO_LONG_HANDLE!!!!' }]))).toEqual({
      ok: false,
      error: 'invalid_verified_list',
    });
  });
});
