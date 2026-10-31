/**
 * 流速与量级的展示文案（content script 徽标与 popup 本页热帖共用）。
 *
 * - 流速一律用英文紧凑单位：`168/h`、`5.2K/h`、`1.2M/h`。短、和 X 自带计数风格一致。
 * - 粉丝、浏览等计数跟 X 自己的中文界面一致：`3.2万`、`1.5亿`。
 */
import {
  formatCountZh,
  shouldShowVelocity,
  TIER_NAMES,
  velocityLevel,
  type AccountTier,
  type VelocityLevel,
} from '@feedsieve/metrics';
import type { UiLanguage } from '../platform/i18n';

const EN_COMPACT = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

export function formatCount(value: number, language: UiLanguage): string {
  if (!Number.isFinite(value) || value < 0) return '';
  return language === 'zh' ? formatCountZh(value) : EN_COMPACT.format(Math.round(value));
}

/** `168/h` / `5.2K/h`（两种语言相同）。 */
export function formatVelocity(perHour: number): string {
  if (!Number.isFinite(perHour) || perHour < 0) return '';
  return `${EN_COMPACT.format(Math.round(perHour))}/h`;
}

/**
 * 推文徽标与本页热帖共用的流速文案：低于显示门槛返回 null；
 * level 决定图标（📈 / 🔥）和颜色（绿 / 红），由调用方渲染。
 */
export function velocityLabel(
  perHour: number | null,
): { text: string; level: VelocityLevel } | null {
  if (!shouldShowVelocity(perHour)) return null;
  const level = velocityLevel(perHour);
  return { text: formatVelocity(perHour!), level };
}

/** 英文紧凑数字（32K、1.2M），用在不随语言变化的徽标上。 */
export function compact(value: number): string {
  return EN_COMPACT.format(Math.round(value));
}

/** 破圈倍数：`×16`、`×8.5`。 */
export function formatReach(ratio: number): string {
  return `×${ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1).replace(/\.0$/, '')}`;
}

/** 量级英文缩写：`MICRO`。 */
export function tierCode(tier: number): string {
  return (TIER_NAMES[tier as AccountTier]?.en ?? `L${tier}`).toUpperCase();
}

/** 量级 + 粉丝数，不随语言变化：`MICRO 32K`。 */
export function formatTier(tier: number, followers: number): string {
  return `${tierCode(tier)} ${compact(followers)}`;
}
