/**
 * 「替你少看了多少垃圾时间」估算（v0.6 余项）。
 *
 * 纯函数：detected 数 × 单条推文平均阅读时间。
 * 单条取值 15 秒（X 信息流平均停留，保守估计；不吹数字）。
 * 输出「约 X 小时 Y 分钟」/「约 Y 分钟」，克制不夸大。
 */

/** 单条标注推文的平均阅读时间（秒）。 */
export const SECONDS_PER_TWEET = 15;

export interface TimeSaved {
  seconds: number;
  /** 人可读文案：>= 1 小时给「约 X 小时 Y 分钟」，否则「约 Y 分钟」 */
  label: string;
}

import type { UiLanguage } from './i18n';

export function estimateTimeSaved(
  detected: number,
  language: UiLanguage = 'zh',
): TimeSaved {
  const seconds = Math.max(0, detected) * SECONDS_PER_TWEET;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) {
    return { seconds, label: language === 'zh' ? '不到 1 分钟' : 'under 1 minute' };
  }
  if (minutes < 60) {
    return {
      seconds,
      label: language === 'zh' ? `约 ${minutes} 分钟` : `about ${minutes} minutes`,
    };
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return {
    seconds,
    label:
      language === 'zh'
        ? rest > 0
          ? `约 ${hours} 小时 ${rest} 分钟`
          : `约 ${hours} 小时`
        : rest > 0
          ? `about ${hours}h ${rest}m`
          : `about ${hours}h`,
  };
}
