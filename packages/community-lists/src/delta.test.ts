import { describe, expect, it, vi } from 'vitest';
import { applySnapshotDelta, buildSnapshotDelta } from './delta';
import { sha256Hex } from './hash';
import { buildSigningMessage, bytesToBase64, type TrustedKey } from './signing';
import { syncCommunitySnapshot, workerSource } from './sync';
import type { StoredSnapshot } from './types';

function entry(handle: string, report = 3) {
  return {
    handle,
    x_user_id: null,
    aliases: [],
    category: 'other',
    sources: ['community'],
    community_score: 0.5,
    report_count: report,
    rescue_count: 0,
    net_votes: report,
    first_seen_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
    evidence_post_ids: [],
  };
}

function verifiedEntry(handle: string) {
  return {
    handle,
    x_user_id: null,
    rescue_count: 3,
    report_count: 0,
    net_votes: 3,
    first_seen_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
  };
}

/** 和服务端 generateSnapshot 同一种序列化。 */
function body(version: string, extra: Record<string, unknown>): string {
  const entries = (extra.entries as Array<{ handle: string }>).sort((a, b) =>
    a.handle < b.handle ? -1 : a.handle > b.handle ? 1 : 0,
  );
  return `${JSON.stringify(
    {
      schema_version: 2,
      policy_version: 4,
      snapshot_version: version,
      generated_at: `${version.slice(0, 10).replaceAll('.', '-')}T00:00:00.000Z`,
      ...extra,
      entries,
    },
    null,
    2,
  )}\n`;
}

const V1 = '2026.10.31.1';
const V2 = '2026.10.31.2';
const BASE = body(V1, {
  entries: [entry('spam_a'), entry('spam_b'), entry('spam_c')],
  verified: [verifiedEntry('good_a')],
});
const TARGET = body(V2, {
  entries: [entry('spam_a', 4), entry('spam_c'), entry('new_one'), entry('_under')],
  // 服务端按字节序给 verified 排序
  verified: [verifiedEntry('aa_good'), verifiedEntry('good_a')],
  muted_rules: ['weak-signal-combo'],
});

describe('snapshot delta', () => {
  it('rebuilds the exact target text from the base and the delta', () => {
    const delta = buildSnapshotDelta(BASE, TARGET);
    expect(delta.entries.remove).toEqual(['spam_b']);
    expect(delta.entries.upsert.map((row) => row.handle).sort()).toEqual([
      '_under',
      'new_one',
      'spam_a',
    ]);
    expect(applySnapshotDelta(BASE, JSON.parse(JSON.stringify(delta)))).toBe(TARGET);
  });

  it('refuses a delta made for another base version', () => {
    const delta = buildSnapshotDelta(BASE, TARGET);
    expect(applySnapshotDelta(TARGET, delta)).toBeNull();
    expect(applySnapshotDelta(BASE, { delta_version: 99 })).toBeNull();
  });
});

async function signedManifest(
  version: string,
  bodyText: string,
  entries: number,
): Promise<{ manifest: unknown; trustedKeys: TrustedKey[] }> {
  const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ]);
  const files = [{ path: 'official.json', sha256: await sha256Hex(bodyText), entries }];
  const payload = {
    schema_version: 2,
    snapshot_version: version,
    generated_at: '2026-10-31T00:00:00.000Z',
    files,
  };
  const message = buildSigningMessage({
    schemaVersion: 2,
    version,
    generatedAt: payload.generated_at,
    files: files.map((f) => ({ path: f.path, sha256: f.sha256, count: f.entries })),
  });
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: 'Ed25519' }, privateKey, new TextEncoder().encode(message)),
  );
  return {
    manifest: { ...payload, signature: { key_id: 't', alg: 'ed25519', sig: bytesToBase64(sig) } },
    trustedKeys: [
      {
        key_id: 't',
        publicKeyBase64: bytesToBase64(
          new Uint8Array(await crypto.subtle.exportKey('raw', publicKey)),
        ),
      },
    ],
  };
}

function store(initial: StoredSnapshot) {
  let data: StoredSnapshot | null = initial;
  return {
    get: async () => data,
    set: async (value: StoredSnapshot) => {
      data = value;
    },
    current: () => data,
  };
}

describe('syncCommunitySnapshot with deltas', () => {
  it('applies the delta and skips the full download', async () => {
    const { manifest, trustedKeys } = await signedManifest(V2, TARGET, 4);
    const delta = buildSnapshotDelta(BASE, TARGET);
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/v1/snapshots/latest')) return Response.json(manifest);
      if (url.includes('/v1/snapshots/delta/')) return Response.json(delta);
      throw new Error(`unexpected ${url}`);
    });
    const s = store({ snapshot_version: V1, body: BASE, synced_at: 0 });
    const outcome = await syncCommunitySnapshot({
      sources: [workerSource('https://api.example.com')],
      fetchImpl,
      store: s,
      force: true,
      trustedKeys,
    });
    expect(outcome).toEqual({ status: 'updated', version: V2, via: 'delta' });
    expect(s.current()?.body).toBe(TARGET);
    expect(fetchImpl).toHaveBeenCalledWith(
      `https://api.example.com/v1/snapshots/delta/${V1}/${V2}`,
    );
  });

  it('falls back to the full file when the rebuilt text does not match the signed hash', async () => {
    const { manifest, trustedKeys } = await signedManifest(V2, TARGET, 4);
    const tampered = buildSnapshotDelta(BASE, TARGET);
    tampered.entries.remove.push('spam_c');
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/v1/snapshots/latest')) return Response.json(manifest);
      if (url.includes('/v1/snapshots/delta/')) return Response.json(tampered);
      return new Response(TARGET);
    });
    const s = store({ snapshot_version: V1, body: BASE, synced_at: 0 });
    const outcome = await syncCommunitySnapshot({
      sources: [workerSource('https://api.example.com')],
      fetchImpl,
      store: s,
      force: true,
      trustedKeys,
    });
    expect(outcome).toEqual({ status: 'updated', version: V2 });
    expect(s.current()?.body).toBe(TARGET);
  });
});
