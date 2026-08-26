import type { Detection } from './types';

export function normalizeHandle(handle: string): string {
  return handle.trim().replace(/^@+/, '').toLowerCase();
}

/**
 * 社区/内置名单命中检测。
 *
 * Phase 0 的最小可用实现：handle 与名单精确匹配（大小写、@ 前缀归一化）。
 * Phase 1 将接入 aliases 展开、x_user_id 匹配与启发式规则。
 *
 * 未命中返回 null（clean），命中返回带理由与来源的标注结论。
 */
export function detectByHandleList(
  handle: string,
  list: ReadonlySet<string>,
): Detection | null {
  const normalized = normalizeHandle(handle);
  if (normalized.length === 0) {
    return null;
  }
  if (!list.has(normalized)) {
    return null;
  }
  return {
    handle: normalized,
    marked: true,
    source: 'community-list',
    reason: '名单命中',
  };
}
