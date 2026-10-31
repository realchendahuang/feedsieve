/**
 * 指标参数。依据见 docs/03-X推荐算法与指标设计.md（xai-org/x-algorithm @ 606b254，2026-10-29）。
 *
 * 调用方可以整体或部分覆盖：计算函数都接受 `Partial<MetricsConfig>`，缺省字段回落到这里。
 */
export interface MetricsConfig {
  /**
   * 发帖超过这么多小时不再计算流速。X 的 For You 用 AgeFilter 丢掉 48 小时以上的帖子
   * （home-mixer/params/config.rs MAX_POST_AGE），之后基本不再有推荐流量。
   */
  velocityMaxAgeHours: number;
  /** 两次观测至少隔这么久才用差分算流速，否则噪声太大。 */
  velocityMinGapMs: number;
  /**
   * 浏览量衰减模型（与 X「热门帖子」候选源 home-mixer/util/popular_posts.rs 一致）：
   * 累计浏览 V(t) = A·(1 − e^(−λt))，λ = ln2 / 半衰期；帖子年龄下限 floorHours。
   */
  decayHalfLifeHours: number;
  decayFloorHours: number;
  /** 「预计 24 小时浏览」的窗口，同 X 热门帖子的 window_hours。 */
  projectionWindowHours: number;
  /** 流速 ≥ 此值才在推文上显示（浏览/小时），低于它的数字只是噪声。 */
  velocityShowAtLeast: number;
  /** 流速 ≥ 此值算「火了」（浏览/小时）。 */
  velocityHotPerHour: number;
  /** 流速 ≥ 此值算「爆了」（浏览/小时）。 */
  velocityRocketPerHour: number;
  /** 破圈系数分母的粉丝数下限，防止小号除以接近 0 的粉丝。 */
  breakoutMinFollowers: number;
  /** 破圈系数 ≥ 此值才在界面显示。 */
  breakoutShowAtLeast: number;
  /** 本页热度分的时间衰减：半衰的小时尺度与指数。 */
  heatDecayHours: number;
  heatDecayPower: number;
  /** 本页热度分里破圈系数的权重与 log10 上限。 */
  heatBreakoutWeight: number;
  heatBreakoutLogCap: number;
  /**
   * 爆帖指数的互动加权，取自 X 排序模型的动作权重（home-mixer/params/param.rs）：
   * 点赞 0.66、回复 5、转发 1、引用 5。X 用它乘「预测概率」，我们用它乘「实际发生率」，
   * 只借用相对重要性。
   */
  engagementWeights: { like: number; reply: number; retweet: number; quote: number };
  /** 爆帖指数三项：预计 24h 浏览（log 刻度）、加权互动率、破圈系数；各自的满分值与分数。 */
  viralCaps: { projectedViews: number; weightedEngagement: number; breakout: number };
  viralWeights: { projectedViews: number; weightedEngagement: number; breakout: number };
  /** 回复机会：帖子发出后这么多小时内还值得去回复。 */
  replyWindowHours: number;
  /** 回复机会分母里的平滑量，避免 0 回复的帖子分数无限大。 */
  replyCompetitionSmoothing: number;
  /**
   * 冷启动扶持（home-mixer/scorers/author_cold_start.rs + params）：
   * 粉丝 ≤ coldStartFollowerCap 的作者、发出 ≤ coldStartMaxAgeHours、曝光 < coldStartImpressions 的帖子
   * 会被插进少量推荐位试水。
   */
  coldStartFollowerCap: number;
  coldStartMaxAgeHours: number;
  coldStartImpressions: number;
  /** 量级档位的粉丝数下限：第 2..6 档（第 1 档为其余）。 */
  tierFollowerFloors: readonly [number, number, number, number, number];
  /** 互关号：关注数 ≥ 此值且关注/粉丝落在区间内。 */
  mutualFarmMinFollowing: number;
  mutualFarmRatioRange: readonly [number, number];
  /** 新号：注册不满这么多天。 */
  newAccountDays: number;
  /** 关注比异常：关注/粉丝 > 此值且粉丝 < abnormalRatioMaxFollowers。 */
  abnormalRatio: number;
  abnormalRatioMaxFollowers: number;
}

export const DEFAULT_METRICS_CONFIG: Readonly<MetricsConfig> = Object.freeze({
  velocityMaxAgeHours: 48,
  velocityMinGapMs: 10 * 60 * 1000,
  decayHalfLifeHours: 8,
  decayFloorHours: 0.5,
  projectionWindowHours: 24,
  velocityShowAtLeast: 10,
  velocityHotPerHour: 1_000,
  velocityRocketPerHour: 10_000,
  breakoutMinFollowers: 100,
  breakoutShowAtLeast: 3,
  heatDecayHours: 12,
  heatDecayPower: 1.5,
  heatBreakoutWeight: 0.5,
  heatBreakoutLogCap: 2,
  engagementWeights: { like: 0.66, reply: 5, retweet: 1, quote: 5 },
  viralCaps: { projectedViews: 1_000_000, weightedEngagement: 0.05, breakout: 10 },
  viralWeights: { projectedViews: 45, weightedEngagement: 35, breakout: 20 },
  replyWindowHours: 24,
  replyCompetitionSmoothing: 20,
  coldStartFollowerCap: 50_000,
  coldStartMaxAgeHours: 2,
  coldStartImpressions: 200,
  tierFollowerFloors: [1_000, 10_000, 50_000, 200_000, 1_000_000] as const,
  mutualFarmMinFollowing: 2_000,
  mutualFarmRatioRange: [0.8, 1.25] as const,
  newAccountDays: 90,
  abnormalRatio: 10,
  abnormalRatioMaxFollowers: 500,
});

export function resolveConfig(overrides?: Partial<MetricsConfig>): MetricsConfig {
  return overrides ? { ...DEFAULT_METRICS_CONFIG, ...overrides } : DEFAULT_METRICS_CONFIG;
}

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;
