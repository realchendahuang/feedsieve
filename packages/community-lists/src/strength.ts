import type { CommunityStatus, MarkStrength } from './types';

/**
 * status 越高越可信；强度档位决定可见下限。
 * 档位必须真正对应三层名单：
 * - candidate 只在「大扫除」可见；
 * - recommended 在「标准 / 大扫除」可见；
 * - strong 在全档可见。
 *
 * 此前 candidate 和 recommended 都是 rank=2，导致「标准」与「大扫除」
 * 消费同一批账号，与 UI 承诺不一致。
 */
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

export function isStatusAllowed(status: CommunityStatus, strength: MarkStrength): boolean {
  return (STATUS_RANK[status] ?? 0) >= MIN_RANK[strength];
}
