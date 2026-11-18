/**
 * 单条推文指标：流速、预计 24h 浏览、破圈系数、爆帖指数、回复机会、本页热度分。
 *
 * 浏览量模型与 X「热门帖子」候选源一致（xai-org/x-algorithm home-mixer/util/popular_posts.rs）：
 *   累计浏览 V(t) = A·(1 − e^(−λt))，λ = ln2 / 8h，t 下限 0.5h
 * X 用 A·(1 − e^(−24λ)) 作为「预计 24 小时浏览」给全站热门帖子排序。我们沿用这个模型：
 * - 只看到一次时，当前流速 = V'(t) = A·λ·e^(−λt)，而不是全程平均（全程平均会高估老帖子的速度）；
 * - 两次观测间隔够长时，用实际增量，更准。
 *
 * 纯函数，时间一律用 Unix 毫秒，由调用方传入 `now`。输入缺字段时返回 null（界面不显示），而不是 0。
 */
import { HOUR_MS, resolveConfig, type MetricsConfig } from './config';

export interface ViewObservation {
  views: number;
  /** 观测时间，Unix 毫秒。 */
  at: number;
}

export interface VelocityInput {
  /** 发帖时间，Unix 毫秒。 */
  createdAt?: number;
  views?: number;
  now: number;
  /** 本次 `views` 实际被观测到的时刻（Unix 毫秒）；缺省时认为就是 `now`。 */
  observedAt?: number;
  /** 同一帖子更早的一次观测；有它且间隔足够时用差分。 */
  previous?: ViewObservation;
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** 发帖后经过的小时数；时间缺失或在未来时返回 null。 */
export function ageHours(createdAt: number | undefined, now: number): number | null {
  if (!isCount(createdAt) || !Number.isFinite(now) || now < createdAt) return null;
  return (now - createdAt) / HOUR_MS;
}

function lambda(config: MetricsConfig): number {
  return Math.LN2 / config.decayHalfLifeHours;
}

/** 到 t 小时为止已经发生的浏览占总量的比例：1 − e^(−λt)。 */
function elapsedShare(age: number, config: MetricsConfig): number {
  return 1 - Math.exp(-lambda(config) * Math.max(age, config.decayFloorHours));
}

/**
 * 预计 24 小时浏览（X 热门帖子同款公式）。超过 24 小时的帖子返回实际浏览量。
 */
export function projectedViews(
  views: number | undefined,
  age: number | null,
  overrides?: Partial<MetricsConfig>,
): number | null {
  if (!isCount(views) || age === null) return null;
  const config = resolveConfig(overrides);
  if (age >= config.projectionWindowHours) return views;
  const saturation = 1 - Math.exp(-lambda(config) * config.projectionWindowHours);
  return Math.max(views, (views * saturation) / elapsedShare(age, config));
}

/**
 * 当前流速（浏览/小时）。
 * - 先在观测时刻 `observedAt`（缺省为 `now`）求流速：间隔 ≥ velocityMinGapMs 且未倒退时用差分，否则用衰减模型；
 * - 若距上次观测已过去一段时间（`now > observedAt`），按同一指数衰减因子推进到 `now`，避免过期帖流速冻结；
 * - 帖子超过 velocityMaxAgeHours（X 不再推荐）返回 null。
 */
export function velocityPerHour(
  input: VelocityInput,
  overrides?: Partial<MetricsConfig>,
): number | null {
  const config = resolveConfig(overrides);
  const ageAtNow = ageHours(input.createdAt, input.now);
  if (ageAtNow === null || !isCount(input.views) || ageAtNow > config.velocityMaxAgeHours) {
    return null;
  }

  let obsTime = input.now;
  if (input.observedAt !== undefined) {
    if (!isCount(input.observedAt)) return null;
    obsTime = Math.min(input.now, input.observedAt);
  }
  const obsAge = ageHours(input.createdAt, obsTime);
  if (obsAge === null) return null;

  const l = lambda(config);
  const obsDecay = Math.exp(-l * Math.max(0, (input.now - obsTime) / HOUR_MS));
  const previous = input.previous;
  if (
    previous &&
    isCount(previous.views) &&
    isCount(previous.at) &&
    obsTime - previous.at >= config.velocityMinGapMs &&
    input.views >= previous.views
  ) {
    const rateAtObs = (input.views - previous.views) / ((obsTime - previous.at) / HOUR_MS);
    return rateAtObs * obsDecay;
  }
  const t = Math.max(obsAge, config.decayFloorHours);
  const total = input.views / elapsedShare(obsAge, config);
  return total * l * Math.exp(-l * t) * obsDecay;
}

export function shouldShowVelocity(
  perHour: number | null,
  overrides?: Partial<MetricsConfig>,
): boolean {
  return perHour !== null && perHour >= resolveConfig(overrides).velocityShowAtLeast;
}

/** none = 还没火；hot = 火了；rocket = 爆了。 */
export type VelocityLevel = 'none' | 'hot' | 'rocket';

export function velocityLevel(
  perHour: number | null,
  overrides?: Partial<MetricsConfig>,
): VelocityLevel {
  if (perHour === null) return 'none';
  const config = resolveConfig(overrides);
  if (perHour >= config.velocityRocketPerHour) return 'rocket';
  if (perHour >= config.velocityHotPerHour) return 'hot';
  return 'none';
}

/** 破圈系数 = 浏览量 / max(作者粉丝数, breakoutMinFollowers)。 */
export function breakoutRatio(
  views: number | undefined,
  followers: number | undefined,
  overrides?: Partial<MetricsConfig>,
): number | null {
  if (!isCount(views) || !isCount(followers)) return null;
  const config = resolveConfig(overrides);
  return views / Math.max(followers, config.breakoutMinFollowers);
}

export function shouldShowBreakout(
  ratio: number | null,
  overrides?: Partial<MetricsConfig>,
): boolean {
  return ratio !== null && ratio >= resolveConfig(overrides).breakoutShowAtLeast;
}

export interface EngagementInput {
  views?: number;
  likes?: number;
  retweets?: number;
  replies?: number;
  quotes?: number;
}

function weightedEngagement(input: EngagementInput, config: MetricsConfig): number {
  const w = config.engagementWeights;
  const n = (value: number | undefined) => (isCount(value) ? value : 0);
  return (
    w.like * n(input.likes) +
    w.reply * n(input.replies) +
    w.retweet * n(input.retweets) +
    w.quote * n(input.quotes)
  );
}

/**
 * 加权互动率 = (0.708×点赞 + 5×回复 + 1×转发 + 5×引用) ÷ 浏览。
 * 权重取自 X 排序模型（config.engagementWeights）：回复和引用远比点赞值钱。
 * 没有浏览量时返回 null；单项互动缺失按 0 计。
 */
export function engagementRate(
  input: EngagementInput,
  overrides?: Partial<MetricsConfig>,
): number | null {
  if (!isCount(input.views) || input.views === 0) return null;
  return weightedEngagement(input, resolveConfig(overrides)) / input.views;
}

export interface HeatInput {
  velocityPerHour: number | null;
  breakout: number | null;
  ageHours: number | null;
}

/**
 * 本页热度分（「本页热帖」排序用）：
 *   H = log10(1 + v) × (1 + w × min(log10(1 + r), cap)) × 1 / (1 + age / decayHours)^power
 * 流速或年龄缺失时返回 null（不参与排序）；破圈系数缺失按 0。
 */
export function heatScore(input: HeatInput, overrides?: Partial<MetricsConfig>): number | null {
  if (input.velocityPerHour === null || input.ageHours === null) return null;
  const config = resolveConfig(overrides);
  const velocityTerm = Math.log10(1 + Math.max(0, input.velocityPerHour));
  const breakoutTerm =
    1 +
    config.heatBreakoutWeight *
      Math.min(Math.log10(1 + Math.max(0, input.breakout ?? 0)), config.heatBreakoutLogCap);
  const decay =
    1 / Math.pow(1 + Math.max(0, input.ageHours) / config.heatDecayHours, config.heatDecayPower);
  return velocityTerm * breakoutTerm * decay;
}

export interface ViralScoreInput extends EngagementInput {
  ageHours: number | null;
  followers?: number;
}

/** 爆帖指数里「预计 24h 浏览」从这个量开始得分（log 刻度，1 千 → 0，满分值 → 满分）。 */
const VIRAL_VIEWS_FLOOR = 1_000;

/**
 * 爆帖指数 0–100，三项对应 X 推荐的三个关键事实：
 * 1. 预计 24h 浏览（45 分）：X 全站热门帖子就按这个数排序；log 刻度，1 千 0 分，100 万满分。
 * 2. 加权互动率（35 分）：按 X 排序模型的动作权重加权，并做小样本收缩（防止几十浏览就满分）。
 * 3. 破圈系数（20 分）：统一用预计 24h 浏览算破圈倍数并乘以样本置信度，避免新帖前两小时被低估或小样本噪点放大。
 * 没有浏览量时返回 null；粉丝数未知时第 3 项按 0。
 */
export function viralScore(
  input: ViralScoreInput,
  overrides?: Partial<MetricsConfig>,
): number | null {
  if (!isCount(input.views) || input.views === 0) return null;
  const config = resolveConfig(overrides);
  const { viralCaps: caps, viralWeights: weights } = config;
  const clamp = (value: number) => Math.min(Math.max(value, 0), 1);

  const projected = projectedViews(input.views, input.ageHours, config) ?? input.views;
  const prior = Math.max(0, config.viralPriorViews);
  const confidence = input.views / (input.views + prior);
  const viewsPart = clamp(
    (Math.log10(Math.max(projected, 1)) - Math.log10(VIRAL_VIEWS_FLOOR)) /
      (Math.log10(caps.projectedViews) - Math.log10(VIRAL_VIEWS_FLOOR)),
  );
  const smoothedRate = weightedEngagement(input, config) / (input.views + prior);
  const engagementPart = clamp(smoothedRate / caps.weightedEngagement);
  const breakout = breakoutRatio(projected, input.followers, config);
  const breakoutPart = breakout === null ? 0 : clamp(breakout / caps.breakout) * confidence;

  const score =
    viewsPart * weights.projectedViews +
    engagementPart * weights.weightedEngagement +
    breakoutPart * weights.breakout;
  return Math.min(100, Math.round(score));
}

export interface ColdStartInput {
  followers?: number;
  ageHours: number | null;
  views?: number;
  /** 回复和转发不参与 X 的作者冷启动试水（author_cold_start.rs）。 */
  kind?: 'original' | 'reply' | 'quote';
  isRetweet?: boolean;
}

/**
 * 是否处在 X 的冷启动试水期：非回复且非转发、粉丝 ≤ 5 万的作者、发出 ≤ 2 小时、曝光 < 200 的帖子，
 * X 会拿少量推荐位给它试水。用浏览量近似曝光。
 */
export function isColdStartWindow(
  input: ColdStartInput,
  overrides?: Partial<MetricsConfig>,
): boolean {
  if (input.kind === 'reply' || input.isRetweet === true) return false;
  const config = resolveConfig(overrides);
  return (
    isCount(input.followers) &&
    input.followers <= config.coldStartFollowerCap &&
    input.ageHours !== null &&
    input.ageHours <= config.coldStartMaxAgeHours &&
    isCount(input.views) &&
    input.views < config.coldStartImpressions
  );
}

export interface ReplyOpportunityInput {
  velocityPerHour: number | null;
  ageHours: number | null;
  replies?: number;
}

export interface ReplyOpportunity {
  /** 热度窗口还剩多少小时。 */
  hoursLeft: number;
  /** 窗口内预计还能新增的浏览量（按衰减模型积分）。 */
  remainingViews: number;
  /** 已有回复数：越多，新回复越难被看到。 */
  competition: number;
  /** 排序分 = 预计剩余浏览 ÷ (已有回复 + 平滑量)。 */
  score: number;
}

/**
 * 回复机会：回答「现在去哪条帖子下面回复最划算」。
 * 剩余浏览 = ∫ 当前流速 × e^(−λs) ds（s 从 0 到窗口剩余时长）= v/λ × (1 − e^(−λ·剩余))。
 * 窗口已过、流速未知时返回 null。
 */
export function replyOpportunity(
  input: ReplyOpportunityInput,
  overrides?: Partial<MetricsConfig>,
): ReplyOpportunity | null {
  if (input.velocityPerHour === null || input.ageHours === null) return null;
  const config = resolveConfig(overrides);
  const hoursLeft = config.replyWindowHours - input.ageHours;
  if (hoursLeft <= 0) return null;
  const l = lambda(config);
  const remainingViews = (Math.max(0, input.velocityPerHour) / l) * (1 - Math.exp(-l * hoursLeft));
  const competition = isCount(input.replies) ? input.replies : 0;
  return {
    hoursLeft,
    remainingViews,
    competition,
    score: remainingViews / (competition + config.replyCompetitionSmoothing),
  };
}
