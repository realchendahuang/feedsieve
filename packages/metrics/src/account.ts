/**
 * 账号量级与附加标记（文档第 10.5 节）。
 */
import { DAY_MS, resolveConfig, type MetricsConfig } from './config';

export type AccountTier = 1 | 2 | 3 | 4 | 5 | 6;

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
  return tier as AccountTier;
}

/**
 * 量级名称，用中文创作者行业的通行说法（素人 / 尾部 / 腰部 / 肩部 / 头部 / 顶流），
 * 比 L1–L6 一眼能懂。英文对应常见的 KOL 分层。
 */
export const TIER_NAMES: Record<
  AccountTier,
  { zh: string; en: string; range: { zh: string; en: string } }
> = {
  1: { zh: '素人', en: 'Starter', range: { zh: '1 千粉以下', en: 'under 1K' } },
  2: { zh: '尾部', en: 'Nano', range: { zh: '1 千–1 万粉', en: '1K–10K' } },
  3: { zh: '腰部', en: 'Micro', range: { zh: '1 万–5 万粉', en: '10K–50K' } },
  4: { zh: '肩部', en: 'Mid', range: { zh: '5 万–20 万粉', en: '50K–200K' } },
  5: { zh: '头部', en: 'Macro', range: { zh: '20 万–100 万粉', en: '200K–1M' } },
  6: { zh: '顶流', en: 'Mega', range: { zh: '100 万粉以上', en: '1M+' } },
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
