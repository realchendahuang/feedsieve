import type { CommunityStatus, MarkStrength } from './types';

/** status 越高越可信；强度档位决定可见下限 */
const STATUS_RANK: Record<CommunityStatus, number> = {
  candidate: 1,
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
  return STATUS_RANK[status] >= MIN_RANK[strength];
}
