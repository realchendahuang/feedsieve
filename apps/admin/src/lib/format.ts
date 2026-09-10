import { formatAgo as sharedFormatAgo } from '@feedsieve/shared';

/** 相对时间格式化：1 分钟内显示「刚刚」，社区候选与验证正常列表共用。文案权威源在 @feedsieve/shared。 */
export function formatAgo(unix: number): string {
  return sharedFormatAgo(unix, 'zh');
}
