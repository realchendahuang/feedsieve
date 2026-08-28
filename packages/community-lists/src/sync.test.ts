import { describe, expect, it, vi } from 'vitest';
import { sha256Hex } from './hash';
import {
  syncCommunitySnapshot,
  workerSource,
  type SnapshotStore,
  type SyncSource,
} from './sync';
import { parseSnapshotBody } from './validate';
import type { StoredSnapshot } from './types';

const API = 'https://api.example.com';
const VERSION = '2026.08.28.1';
const SHA = 'b'.repeat(64);

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function snapshotBodyText(version = VERSION, entries: unknown[] = []): string {
  return JSON.stringify({
    schema_version: 1,
    snapshot_version: version,
    generated_at: '2026-08-28T00:00:00Z',
    entries,
  });
}

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    snapshot_version: VERSION,
    generated_at: '2026-08-28T00:00:00Z',
    files: [{ path: 'official.json', sha256: SHA, entries: 0 }],
    ...overrides,
  };
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

function okFetch(bodyText: string, manifestPayload = manifest()) {
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
    const fetchImpl = okFetch(body, manifest({ files: [{ path: 'official.json', sha256: await realSha(body), entries: 0 }] }));

    const outcome = await syncCommunitySnapshot({
      sources: [workerSource(API)],
      fetchImpl,
      store,
      force: true,
    });

    expect(outcome).toEqual({ status: 'updated', version: VERSION });
    expect(store.data?.snapshot_version).toBe(VERSION);
    expect(JSON.parse(store.data!.body).entries).toEqual([]);
  });

  it('rejects a snapshot whose checksum does not match the manifest', async () => {
    const store = memoryStore();
    const fetchImpl = okFetch(snapshotBodyText(), manifest());

    const outcome = await syncCommunitySnapshot({
      sources: [workerSource(API)],
      fetchImpl,
      store,
      force: true,
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
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 500 })) as unknown as (url: string) => Promise<Response>;

    const outcome = await syncCommunitySnapshot({
      sources: [workerSource(API)],
      fetchImpl,
      store,
      force: true,
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
        return jsonResponse(manifest({ files: [{ path: 'official.json', sha256: await realSha(body), entries: 0 }] }));
      }
      return new Response(body, { status: 200 });
    }) as unknown as (url: string) => Promise<Response>;

    const outcome = await syncCommunitySnapshot({
      sources: [workerSource(API), mirror],
      fetchImpl,
      store,
      force: true,
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
    const fetchImpl = okFetch(body, manifest({ files: [{ path: 'official.json', sha256: await realSha(body), entries: 0 }] }));

    const outcome = await syncCommunitySnapshot({
      sources: [workerSource(API)],
      fetchImpl,
      store,
      force: true,
      now: () => 5555,
    });

    expect(outcome).toEqual({ status: 'unchanged' });
    expect(store.data?.synced_at).toBe(5555);
    expect(store.data?.body).toBe(body);
  });

  it('rejects malformed manifests and bodies', async () => {
    const store = memoryStore();
    const badManifest = await syncCommunitySnapshot({
      sources: [workerSource(API)],
      fetchImpl: okFetch('{}', manifest({ snapshot_version: 'not-a-version' })),
      store,
      force: true,
    });
    expect(badManifest).toMatchObject({ status: 'error' });

    const badBody = snapshotBodyText(VERSION, [{ handle: '!!!' }]);
    const badEntries = await syncCommunitySnapshot({
      sources: [workerSource(API)],
      fetchImpl: okFetch(badBody, manifest({ files: [{ path: 'official.json', sha256: await realSha(badBody), entries: 1 }] })),
      store,
      force: true,
    });
    // 坏条目被跳过后 entries=[] 仍是合法快照；存储保留原始字节，索引层负责再过滤
    expect(badEntries).toEqual({ status: 'updated', version: VERSION });
    const stored = parseSnapshotBody((await store.get())!.body);
    expect(stored.ok && stored.value.entries).toEqual([]);
  });
});
