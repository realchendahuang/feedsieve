import { sha256Hex } from './hash';
import { applySnapshotDelta } from './delta';
import { parseManifest, parseSnapshotBody } from './validate';
import {
  buildSigningMessage,
  compareManifestVersions,
  verifyManifestSignature,
  type TrustedKey,
} from './signing';
import { TRUSTED_KEYS } from './trusted-keys';
import type { StoredSnapshot } from './types';

/**
 * 两次检查 manifest 的最短间隔。服务端每 30 分钟可能发一版，版本变了优先走增量
 * （/v1/snapshots/delta），只有增量不可用或校验不过才下载全量文件。
 */
export const SYNC_INTERVAL_MS = 30 * 60 * 1000;

export type SyncOutcome =
  | { status: 'updated'; version: string; via?: 'delta' }
  | { status: 'unchanged' }
  | { status: 'skipped' }
  | { status: 'error'; error: string };

export type FetchLike = (url: string) => Promise<Response>;

/** 一个快照来源：manifest 地址 + 快照文件地址的拼装方式 */
export interface SyncSource {
  manifestUrl: string;
  fileUrl: (version: string, path: string) => string;
  /** 两版之间的增量地址；缺省时总是下载全量 */
  deltaUrl?: (from: string, to: string) => string;
}

/** 社区 API（Worker）来源 */
export function workerSource(apiBase: string): SyncSource {
  return {
    manifestUrl: `${apiBase}/v1/snapshots/latest`,
    fileUrl: (version, path) => `${apiBase}/v1/snapshots/${version}/${path}`,
    deltaUrl: (from, to) => `${apiBase}/v1/snapshots/delta/${from}/${to}`,
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
  /** 校验 manifest 签名的可信公钥；缺省用扩展内置 TRUSTED_KEYS */
  trustedKeys?: readonly TrustedKey[];
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

    // 发布者签名：SHA-256 只能证明文件与 manifest 匹配，无法证明 manifest 是谁签发的。
    // 验签失败（即使 manifest 和文件被同时替换）也保持 last-known-good 不动。
    if (!manifest.value.signature) {
      return { status: 'error', error: 'signature_missing' };
    }
    const signatureCheck = await verifyManifestSignature(
      buildSigningMessage({
        schemaVersion: manifest.value.schema_version,
        version: manifest.value.snapshot_version,
        generatedAt: manifest.value.generated_at,
        files: manifest.value.files.map((f) => ({
          path: f.path,
          sha256: f.sha256,
          count: f.entries,
        })),
      }),
      manifest.value.signature,
      options.trustedKeys ?? TRUSTED_KEYS,
    );
    if (!signatureCheck.ok) {
      return { status: 'error', error: signatureCheck.error };
    }

    // 防回滚：远程版本必须不早于已接受的版本。发布侧回滚通过「旧内容套新版本号」表达，
    // 因此严格单调比较是安全的 —— 被签名证明是官方的旧版本也不能覆盖本地较新的缓存。
    if (
      current &&
      compareManifestVersions(manifest.value.snapshot_version, current.snapshot_version) < 0
    ) {
      return { status: 'error', error: 'rollback_rejected' };
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
    const accept = async (body: string): Promise<boolean> => {
      if ((await sha256Hex(body)) !== file.sha256) return false;
      const parsed = parseSnapshotBody(body);
      return (
        parsed.ok &&
        parsed.value.snapshot_version === manifest.value.snapshot_version &&
        parsed.value.entries.length === file.entries
      );
    };
    // 增量：套在本地已验签的旧版上，重建出的全文必须和签名 manifest 的哈希一致，否则退回全量
    if (current && source.deltaUrl) {
      try {
        const deltaRes = await options.fetchImpl(
          source.deltaUrl(current.snapshot_version, manifest.value.snapshot_version),
        );
        if (deltaRes.ok) {
          const rebuilt = applySnapshotDelta(current.body, await deltaRes.json());
          if (rebuilt !== null && (await accept(rebuilt))) {
            await options.store.set({
              snapshot_version: manifest.value.snapshot_version,
              body: rebuilt,
              synced_at: now(),
            });
            return { status: 'updated', version: manifest.value.snapshot_version, via: 'delta' };
          }
        }
      } catch {
        // 增量不可用：走全量
      }
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
