/**
 * 战报数据层（v0.6）：按日累计的本地统计。
 *
 * 与 local-stats（全量累计）互补：战报只关心「今天」，
 * 分享文案需要分类计数（送走 N 个：机器人 X · 色情引流 Y …）。
 *
 * 数据模型：{ [date: 'YYYY-MM-DD']: { blocked, detected, unblocked, byCategory } }
 * - blocked：拉黑 API 确认成功（顺手 / 批量共用同一入口）
 * - detected：新推文 cell 被黄框标注
 * - unblocked：撤销 API 确认成功
 * - byCategory：拉黑账号的贡献分类（categoryFromDetection 输出）
 *
 * 只保留最近 30 天（战报只看今天，历史只用于「连续 N 天」类文案）。
 * 全部本地累计，不上报。
 */

export interface DailyStat {
  blocked: number;
  detected: number;
  unblocked: number;
  /** 分类 -> 今日拉黑数（贡献分类，见 contribute.ts categoryFromDetection） */
  byCategory: Record<string, number>;
}

export interface DailyStats {
  /** date('YYYY-MM-DD') -> 当日统计 */
  days: Record<string, DailyStat>;
}

const STORAGE_KEY = 'dailyStats';
const KEEP_DAYS = 30;

const EMPTY_DAY: DailyStat = { blocked: 0, detected: 0, unblocked: 0, byCategory: {} };

export function todayKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export async function getDailyStats(): Promise<DailyStats> {
  const result = await browser.storage.local.get(STORAGE_KEY);
  const value = result[STORAGE_KEY] as DailyStats | undefined;
  if (!value || typeof value !== 'object' || typeof value.days !== 'object') {
    return { days: {} };
  }
  return value;
}

/** 今日战报（无记录时返回全零，不抛错）。 */
export async function getTodayStat(): Promise<DailyStat> {
  const stats = await getDailyStats();
  return stats.days[todayKey()] ?? { ...EMPTY_DAY, byCategory: {} };
}

/**
 * 记一笔今日账。key 与 local-stats 对齐；category 只对 blocked 有意义
 * （顺手拉黑 / 批量拉黑都带贡献分类，撤销不带）。
 */
export async function bumpDaily(
  key: 'blocked' | 'detected' | 'unblocked',
  category?: string,
): Promise<void> {
  const stats = await getDailyStats();
  const today = todayKey();
  const day = stats.days[today] ?? { ...EMPTY_DAY, byCategory: {} };
  day[key] = (day[key] ?? 0) + 1;
  if (key === 'blocked' && category) {
    day.byCategory[category] = (day.byCategory[category] ?? 0) + 1;
  }
  stats.days[today] = day;
  // 只保留最近 KEEP_DAYS 天：按日期字符串排序，淘汰最旧的
  const dates = Object.keys(stats.days).sort();
  if (dates.length > KEEP_DAYS) {
    for (const old of dates.slice(0, dates.length - KEEP_DAYS)) {
      delete stats.days[old];
    }
  }
  await browser.storage.local.set({ [STORAGE_KEY]: stats });
}

/** 订阅变化（popup 实时刷新）。返回解绑函数。 */
export function subscribeDaily(
  onChange: (stats: DailyStats) => void,
): () => void {
  const listener = (
    changes: Record<string, { newValue?: unknown }>,
    areaName: string,
  ) => {
    if (areaName === 'local' && changes[STORAGE_KEY]) {
      void getDailyStats().then(onChange);
    }
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
