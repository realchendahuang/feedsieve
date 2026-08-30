import type { CommunityStatus, MarkStrength } from './types';

/**
 * status 越高越可信；强度档位决定可见下限。
 * v0.5 零人工：candidate 由 >=2 独立安装自动产生（默认档可见），
 * strong 由 owner 票或 >=3 独立安装产生（全档可见）。
 * recommended 保兼容（旧快照可能有）；dismissed 不出快照。
 */
const STATUS_RANK: Record<CommunityStatus, number> = {
  candidate: 2,
  recommended: 2,
  strong: 3,
};

const MIN_RANK: Record<MarkStrength, number> = {
  refresh: 3,
  standard: 2,
  deep_clean: 1,
};

export const STRENGTH_LABELS: Record<MarkStrength, string> = {
  refresh: '清爽',
  standard: '标准',
  deep_clean: '大扫除',
};

export function isStatusAllowed(
  status: CommunityStatus,
  strength: MarkStrength,
): boolean {
  return (STATUS_RANK[status] ?? 0) >= MIN_RANK[strength];
}
