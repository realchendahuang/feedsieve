/**
 * 主页洞察的概况（资料卡下的那一行、推文上的倍数标签用）：只带算倍数需要的基线和几个数，
 * 不把整份帖子库传给内容脚本。
 */
import {
  accountTier,
  analyzeProfile,
  followRatio,
  TIER_MAX,
  type ProfileBaseline,
} from '@feedsieve/metrics';
import type { CatalogEntry } from './profile-catalog';

export interface ProfileSummary {
  handle: string;
  followers?: number;
  followingCount?: number;
  tier: number | null;
  /** 关注数 ÷ 粉丝数。 */
  ratio: number | null;
  baseline: ProfileBaseline | null;
  outlierRate: number | null;
  /** 帖子库里的帖子数。 */
  postCount: number;
}

export function summarizeProfile(entry: CatalogEntry, now: number): ProfileSummary {
  const posts = Object.values(entry.posts);
  const analysis = analyzeProfile(posts, now);
  const { account } = entry;
  return {
    handle: account.handle,
    ...(account.followers !== undefined ? { followers: account.followers } : {}),
    ...(account.followingCount !== undefined ? { followingCount: account.followingCount } : {}),
    tier: accountTier(account.followers),
    ratio:
      account.followers !== undefined && account.followingCount !== undefined
        ? followRatio(account.followingCount, account.followers)
        : null,
    baseline: analysis.baseline,
    outlierRate: analysis.outlierRate,
    postCount: posts.length,
  };
}

const nonNegativeFinite = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;

/** 内容脚本收到的概况：跨消息边界再按形状校验一遍。 */
export function asProfileSummary(value: unknown): ProfileSummary | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.handle !== 'string' || typeof raw.postCount !== 'number') return null;
  const b = raw.baseline as Record<string, unknown> | null | undefined;
  const medianViews = nonNegativeFinite(b?.medianViews);
  const baseline =
    b && medianViews !== undefined && medianViews > 0
      ? {
          medianViews,
          medianLikes: nonNegativeFinite(b.medianLikes) ?? 0,
          sample: nonNegativeFinite(b.sample) ?? 0,
        }
      : null;
  const tier = nonNegativeFinite(raw.tier);
  return {
    handle: raw.handle,
    ...(nonNegativeFinite(raw.followers) !== undefined
      ? { followers: nonNegativeFinite(raw.followers)! }
      : {}),
    ...(nonNegativeFinite(raw.followingCount) !== undefined
      ? { followingCount: nonNegativeFinite(raw.followingCount)! }
      : {}),
    tier:
      tier !== undefined && Number.isInteger(tier) && tier >= 1 && tier <= TIER_MAX ? tier : null,
    ratio: nonNegativeFinite(raw.ratio) ?? null,
    baseline,
    outlierRate: nonNegativeFinite(raw.outlierRate) ?? null,
    postCount: raw.postCount,
  };
}
