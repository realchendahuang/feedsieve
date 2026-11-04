/**
 * 页面装饰的悬停说明文案（i18n）。
 *
 * 约定：推文上直接显示的徽标不出现任何汉字，只用图标、数字和英文缩写（`168/h`、`MICRO 32K`），
 * 解释性文字只出现在悬停卡片里，并跟随界面语言。
 */
import { TIER_NAMES, type AccountTier } from '@feedsieve/metrics';
import type { UiLanguage } from '../platform/i18n';

export const INSIGHT_COPY = {
  zh: {
    velocityTitle: { none: '当前流速', hot: '正在升温', rocket: '正在爆' },
    velocityNow: '当前流速',
    projected: '预计 24 小时浏览',
    views: '浏览',
    likes: '点赞',
    replies: '回复',
    reposts: '转发',
    quotes: '引用',
    bookmarks: '收藏',
    breakout: '破圈',
    breakoutValue: (x: string) => `浏览是博主粉丝的 ${x} 倍`,
    viral: '传播指数',
    coldStart: '发出不到 2 小时、曝光不足 200：X 正在给它试水推荐',
    velocityFoot: '按 X 推荐算法的浏览衰减模型估算',
    tierTitle: (name: string, range: string) => `${name}博主 · ${range}`,
    followers: '粉丝',
    following: '关注',
    ratio: '关注比',
    joined: '注册',
    coldStartTier: '粉丝 ≤ 5 万：新帖前 2 小时有 X 冷启动扶持',
    flagMutual: '疑似互关号',
    flagNew: '注册不满 90 天',
    flagRatio: '关注远多于粉丝',
    multipleTitle: { outlier: '爆款', normal: '相对表现' },
    multipleValue: (x: string, handle: string) => `浏览是 @${handle} 帖子中位数的 ${x} 倍`,
    multipleEstimated: '发出不满 24 小时：按预计 24 小时浏览估算',
    multipleMedian: '中位浏览',
    multipleSample: (n: number) => `基于本机收到的 ${n} 条帖子，只算原创和引用`,
  },
  en: {
    velocityTitle: { none: 'Velocity', hot: 'Heating up', rocket: 'Going viral' },
    velocityNow: 'Velocity',
    projected: 'Projected 24h views',
    views: 'Views',
    likes: 'Likes',
    replies: 'Replies',
    reposts: 'Reposts',
    quotes: 'Quotes',
    bookmarks: 'Bookmarks',
    breakout: 'Reach',
    breakoutValue: (x: string) => `${x}× the author's followers`,
    viral: 'Viral score',
    coldStart: 'Under 2h old with fewer than 200 views: X is test-boosting it',
    velocityFoot: "Estimated with the view-decay model from X's recommender",
    tierTitle: (name: string, range: string) => `${name} creator · ${range}`,
    followers: 'Followers',
    following: 'Following',
    ratio: 'Follow ratio',
    joined: 'Joined',
    coldStartTier: '≤50K followers: new posts get X cold-start boost for 2h',
    flagMutual: 'Likely follow-back farm',
    flagNew: 'Account under 90 days old',
    flagRatio: 'Follows far more than followed',
    multipleTitle: { outlier: 'Outlier', normal: 'Relative performance' },
    multipleValue: (x: string, handle: string) => `${x}× @${handle}'s median views`,
    multipleEstimated: 'Under 24h old: estimated from projected 24h views',
    multipleMedian: 'Median views',
    multipleSample: (n: number) =>
      `Based on ${n} posts collected on this device; originals and quotes only`,
  },
} as const;

export function tierTitle(tier: AccountTier, language: UiLanguage): string {
  const names = TIER_NAMES[tier];
  return INSIGHT_COPY[language].tierTitle(
    language === 'zh' ? names.zh : names.en,
    names.range[language],
  );
}
