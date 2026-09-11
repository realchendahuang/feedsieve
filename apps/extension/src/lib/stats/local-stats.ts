/**
 * 本地统计计数器（v0.1：标注 / 拉黑 / 撤销）。
 *
 * Phase 1 重构时被删，现按原意图接回：
 * - detected：新推文 cell 被黄框标注的次数（每次新标注 +1）
 * - blocked：拉黑 API 确认成功的次数（顺手 / 批量共用）
 * - unblocked：撤销 API 确认成功的次数
 * 全部本地累计，不上报。
 */

export interface LocalStats {
  detected: number;
  blocked: number;
  unblocked: number;
}

const STORAGE_KEY = 'stats';

const EMPTY: LocalStats = { detected: 0, blocked: 0, unblocked: 0 };

export async function getStats(): Promise<LocalStats> {
  const result = await browser.storage.local.get(STORAGE_KEY);
  const value = result[STORAGE_KEY];
  if (!value || typeof value !== 'object') {
    return { ...EMPTY };
  }
  const raw = value as Partial<Record<keyof LocalStats, unknown>>;
  return {
    detected: Number(raw.detected) || 0,
    blocked: Number(raw.blocked) || 0,
    unblocked: Number(raw.unblocked) || 0,
  };
}

/** 单项计数 +delta（默认 +1）。调用方串行等待即可，不做并发合并。 */
export async function bumpStat(key: keyof LocalStats, delta = 1): Promise<void> {
  const stats = await getStats();
  stats[key] = (stats[key] ?? 0) + delta;
  await browser.storage.local.set({ [STORAGE_KEY]: stats });
}

/** 订阅变化（popup 实时刷新）。返回解绑函数。 */
export function subscribeStats(onChange: (stats: LocalStats) => void): () => void {
  const listener = (
    changes: Record<string, { newValue?: unknown }>,
    areaName: string,
  ) => {
    if (areaName === 'local' && changes[STORAGE_KEY]) {
      void getStats().then(onChange);
    }
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}