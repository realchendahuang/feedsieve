import { sha256Hex } from './hash';
import { parseManifest, parseSnapshotBody } from './validate';
import type { StoredSnapshot } from './types';

export const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;

export type SyncOutcome =
  | { status: 'updated'; version: string }
  | { status: 'unchanged' }
  | { status: 'skipped' }
  | { status: 'error'; error: string };

export type FetchLike = (url: string) => Promise<Response>;

/** 一个快照来源：manifest 地址 + 快照文件地址的拼装方式 */
export interface SyncSource {
  manifestUrl: string;
  fileUrl: (version: string, path: string) => string;
}

/** 社区 API（Worker）来源 */
export function workerSource(apiBase: string): SyncSource {
  return {
    manifestUrl: `${apiBase}/v1/snapshots/latest`,
    fileUrl: (version, path) => `${apiBase}/v1/snapshots/${version}/${path}`,
  };
}

/** 宿主环境的存储适配器（扩展侧用 browser.storage.local 实现） */
export interface SnapshotStore {
  get(): Promise<StoredSnapshot | null>;
  set(value: StoredSnapshot): Promise<void>;
}

export interface SyncOptions {
  /** 依次尝试的来源；前面的源报错时自动落到下一个 */
  sources: SyncSource[];
  fetchImpl: FetchLike;
  store: SnapshotStore;
  now?: () => number;
  /** 跳过 6h 节流（onInstalled / 用户手动刷新时用） */
  force?: boolean;
}

/**
 * 快照同步：manifest 比对版本 -> 变了才下载 -> sha256 校验 -> 结构校验 -> 整体写入。
 * 任何一步失败都保持 last-known-good 不动（store.set 只在全部通过后调用）。
 */
export async function syncCommunitySnapshot(options: SyncOptions): Promise<SyncOutcome> {
  const now = options.now ?? Date.now;
  try {
    const current = await options.store.get();
    if (!options.force && current && now() - current.synced_at < SYNC_INTERVAL_MS) {
      return { status: 'skipped' };
    }
  } catch (error) {
    return {
      status: 'error',
      error: error instanceof Error ? error.message : 'unknown',
    };
  }

  let lastError: SyncOutcome = { status: 'error', error: 'no_sources' };
  for (const source of options.sources) {
    const outcome = await syncFromSource(source, options);
    if (outcome.status !== 'error') {
      return outcome;
    }
    lastError = outcome;
  }
  return lastError;
}

async function syncFromSource(source: SyncSource, options: SyncOptions): Promise<SyncOutcome> {
  const now = options.now ?? Date.now;
  try {
    const current = await options.store.get();

    const manifestRes = await options.fetchImpl(source.manifestUrl);
    if (!manifestRes.ok) {
      return { status: 'error', error: `manifest_http_${manifestRes.status}` };
    }
    const manifest = parseManifest(await manifestRes.json());
    if (!manifest.ok) {
      return { status: 'error', error: manifest.error };
    }

    if (current && manifest.value.snapshot_version === current.snapshot_version) {
      await options.store.set({ ...current, synced_at: now() });
      return { status: 'unchanged' };
    }

    // manifest 同时公开机器 JSON 和人类可读 YAML；扩展必须明确选择机器文件。
    const file = manifest.value.files.find((candidate) => candidate.path === 'official.json');
    if (!file) {
      return { status: 'error', error: 'machine_snapshot_missing' };
    }
    const snapshotRes = await options.fetchImpl(
      source.fileUrl(manifest.value.snapshot_version, file.path),
    );
    if (!snapshotRes.ok) {
      return { status: 'error', error: `snapshot_http_${snapshotRes.status}` };
    }
    const body = await snapshotRes.text();
    if ((await sha256Hex(body)) !== file.sha256) {
      return { status: 'error', error: 'checksum_mismatch' };
    }
    const snapshot = parseSnapshotBody(body);
    if (!snapshot.ok) {
      return { status: 'error', error: snapshot.error };
    }
    if (snapshot.value.snapshot_version !== manifest.value.snapshot_version) {
      return { status: 'error', error: 'version_mismatch' };
    }
    if (snapshot.value.entries.length !== file.entries) {
      return { status: 'error', error: 'entry_count_mismatch' };
    }

    await options.store.set({
      snapshot_version: manifest.value.snapshot_version,
      body,
      synced_at: now(),
    });
    return { status: 'updated', version: manifest.value.snapshot_version };
  } catch (error) {
    return {
      status: 'error',
      error: error instanceof Error ? error.message : 'unknown',
    };
  }
}
