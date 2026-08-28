import { isStatusAllowed } from './strength';
import type { CommunityEntry, MarkStrength, SnapshotBody } from './types';

export interface CommunityIndex {
  /** 构建自的快照版本 */
  version: string;
  /** 当前强度下可见的条目数 */
  size: number;
  /**
   * x_user_id 优先（handle 会改名，rest_id 稳定）；handle 大小写不敏感。
   * 未命中返回 null。
   */
  lookup(
    handle: string | null | undefined,
    xUserId?: string | null,
  ): CommunityEntry | null;
}

/** 从快照构建当前强度的本地索引；查询纯内存，滚动时间线零网络请求 */
export function buildIndex(
  snapshot: SnapshotBody,
  strength: MarkStrength,
): CommunityIndex {
  const byHandle = new Map<string, CommunityEntry>();
  const byUserId = new Map<string, CommunityEntry>();
  for (const entry of snapshot.entries) {
    if (!isStatusAllowed(entry.status, strength)) {
      continue;
    }
    byHandle.set(entry.handle, entry);
    if (entry.x_user_id) {
      byUserId.set(entry.x_user_id, entry);
    }
  }
  return {
    version: snapshot.snapshot_version,
    size: byHandle.size,
    lookup(handle, xUserId) {
      if (xUserId) {
        const byId = byUserId.get(xUserId);
        if (byId) {
          return byId;
        }
      }
      if (handle) {
        const normalized = handle.trim().replace(/^@+/, '').toLowerCase();
        return byHandle.get(normalized) ?? null;
      }
      return null;
    },
  };
}
