/**
 * 社区快照协议 v1（与 apps/community-api 的产出一一对应）。
 * 该包是纯 TS 消费端：不依赖 chrome/browser，同步逻辑全部依赖注入，可完整单测。
 */

export interface SnapshotManifestFile {
  path: string;
  sha256: string;
  entries: number;
}

export interface SnapshotManifest {
  schema_version: number;
  snapshot_version: string;
  generated_at: string;
  files: SnapshotManifestFile[];
}

export type CommunityStatus = 'candidate' | 'recommended' | 'strong';

export interface CommunityEntry {
  handle: string;
  x_user_id: string | null;
  category: string;
  status: CommunityStatus;
  report_count: number;
  rescue_count: number;
  first_seen_at: string;
  updated_at: string;
  evidence_post_ids: string[];
}

export interface SnapshotBody {
  schema_version: number;
  snapshot_version: string;
  generated_at: string;
  entries: CommunityEntry[];
}

/** 本地缓存的快照（last-known-good：只在全部校验通过后整体写入） */
export interface StoredSnapshot {
  snapshot_version: string;
  /** 序列化好的快照 JSON（原样保存，构建索引时再解析） */
  body: string;
  synced_at: number;
}

/** 标注强度：清爽(仅 strong) / 标准(strong+recommended) / 大扫除(全部) */
export type MarkStrength = 'refresh' | 'standard' | 'deep_clean';

export const MARK_STRENGTHS: readonly MarkStrength[] = [
  'refresh',
  'standard',
  'deep_clean',
] as const;

export const DEFAULT_MARK_STRENGTH: MarkStrength = 'standard';

export function isMarkStrength(value: unknown): value is MarkStrength {
  return (
    typeof value === 'string' &&
    (MARK_STRENGTHS as readonly string[]).includes(value)
  );
}
