/**
 * 账号量级与附加标记（文档第 10.5 节）。
 */
import { DAY_MS, resolveConfig, type MetricsConfig } from './config';

export type AccountTier = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

/** 全部档位，供 UI 遍历和统计初始化。 */
export const TIER_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
export const TIER_MAX: AccountTier = 10;

/** 按粉丝数分 L1–L6；粉丝数缺失时返回 null。 */
export function accountTier(
  followers: number | undefined,
  overrides?: Partial<MetricsConfig>,
): AccountTier | null {
  if (typeof followers !== 'number' || !Number.isFinite(followers) || followers < 0) return null;
  const floors = resolveConfig(overrides).tierFollowerFloors;
  let tier = 1;
  for (const floor of floors) {
    if (followers >= floor) tier += 1;
  }
  return Math.min(tier, TIER_MAX) as AccountTier;
}

/**
 * 量级名称：从「微光」到「顶流」十个正向称呼，覆盖 0 到 500 万粉。
 * 不用「尾部 / 肩部」这类行业黑话，避免给作者贴贬义标签。
 */
export const TIER_NAMES: Record<
  AccountTier,
  { zh: string; en: string; range: { zh: string; en: string } }
> = {
  1: { zh: '微光', en: 'Glow', range: { zh: '100 粉以下', en: 'under 100' } },
  2: { zh: '新芽', en: 'Sprout', range: { zh: '100–1 千粉', en: '100–1K' } },
  3: { zh: '新锐', en: 'Rising', range: { zh: '1 千–5 千粉', en: '1K–5K' } },
  4: { zh: '星火', en: 'Spark', range: { zh: '5 千–1 万粉', en: '5K–10K' } },
  5: { zh: '人气', en: 'Popular', range: { zh: '1 万–3 万粉', en: '10K–30K' } },
  6: { zh: '达人', en: 'Creator', range: { zh: '3 万–10 万粉', en: '30K–100K' } },
  7: { zh: '知名', en: 'Known', range: { zh: '10 万–30 万粉', en: '100K–300K' } },
  8: { zh: '影响力', en: 'Influential', range: { zh: '30 万–100 万粉', en: '300K–1M' } },
  9: { zh: '头部', en: 'Macro', range: { zh: '100 万–500 万粉', en: '1M–5M' } },
  10: { zh: '顶流', en: 'Mega', range: { zh: '500 万粉以上', en: '5M+' } },
};

/** 关注比 = 关注数 / 粉丝数（粉丝为 0 时按 1 算）。 */
export function followRatio(
  followingCount: number | undefined,
  followers: number | undefined,
): number | null {
  if (typeof followingCount !== 'number' || typeof followers !== 'number') return null;
  if (followingCount < 0 || followers < 0) return null;
  return followingCount / Math.max(followers, 1);
}

export interface AccountFlagInput {
  followers?: number;
  followingCount?: number;
  /** 注册时间，Unix 毫秒。 */
  createdAt?: number;
  now: number;
}

export interface AccountFlags {
  /** 互关号：大量关注，且关注数和粉丝数接近。 */
  mutualFollowFarm: boolean;
  /** 注册不满 newAccountDays 天。 */
  newAccount: boolean;
  /** 关注远多于粉丝的小号。 */
  abnormalFollowRatio: boolean;
}

export function accountFlags(
  input: AccountFlagInput,
  overrides?: Partial<MetricsConfig>,
): AccountFlags {
  const config = resolveConfig(overrides);
  const ratio = followRatio(input.followingCount, input.followers);
  const [low, high] = config.mutualFarmRatioRange;
  const mutualFollowFarm =
    ratio !== null &&
    (input.followingCount ?? 0) >= config.mutualFarmMinFollowing &&
    ratio >= low &&
    ratio <= high;
  const newAccount =
    typeof input.createdAt === 'number' &&
    input.now >= input.createdAt &&
    input.now - input.createdAt < config.newAccountDays * DAY_MS;
  const abnormalFollowRatio =
    ratio !== null &&
    ratio > config.abnormalRatio &&
    (input.followers ?? 0) < config.abnormalRatioMaxFollowers;
  return { mutualFollowFarm, newAccount, abnormalFollowRatio };
}
