/**
 * 本地检测日志与按规则日统计（规则质量观测，永不上报）。
 *
 * 回答「某条识别规则在真实页面上触发了多少次」——评测层金标没有真实分布，
 * 组合层这类刚升档的规则，放行与否最终由这份现场数据说话。
 *
 * 存储：
 * - detectionLogV1：最近 200 条检测命中（handle / ruleId / 来源 / 理由 / 指纹），
 *   环形淘汰。不含推文原文（隐私红线：原文不落盘）；理由文本是页面上已经
 *   展示给用户的标注文案，指纹是归一化文本的单向哈希。
 * - detectionRuleStatsV1：按本地日聚合的 ruleId 计数，保留 30 天。
 *
 * 写入串行化（read-modify-write 不丢条目）；同一 handle+rule 5 分钟内去重——
 * 虚拟列表重建 DOM 会把同一推文重新入队，不去重会成倍膨胀。
 */

export interface DetectionLogEntry {
  at: number;
  handle: string;
  ruleId: string;
  source: string;
  category?: string;
  reason?: string;
  fingerprint?: string;
}

const LOG_KEY = 'detectionLogV1';
const STATS_KEY = 'detectionRuleStatsV1';
const MAX_LOG_ENTRIES = 200;
const KEEP_DAYS = 30;
const DEDUP_TTL_MS = 5 * 60 * 1000;

const dedupCache = new Map<string, number>();

/** 测试隔离用：清空运行时去重缓存（模块级状态，跨用例共享）。 */
export function resetDeduplicationForTests(): void {
  dedupCache.clear();
}

function isDuplicate(key: string, now: number): boolean {
  for (const [k, ts] of dedupCache) {
    if (now - ts > DEDUP_TTL_MS) {
      dedupCache.delete(k);
    } else {
      break;
    }
  }
  const last = dedupCache.get(key);
  if (last !== undefined && now - last < DEDUP_TTL_MS) {
    dedupCache.set(key, now);
    return true;
  }
  dedupCache.set(key, now);
  return false;
}

export function todayKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 串行化 read-modify-write：并发 record 不会丢日志/丢计数。 */
let queue: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn) as Promise<T>;
  queue = next.catch(() => {});
  return next;
}

export async function readDetectionLog(): Promise<DetectionLogEntry[]> {
  const data = await browser.storage.local.get(LOG_KEY);
  const raw = data[LOG_KEY];
  return Array.isArray(raw) ? (raw as DetectionLogEntry[]) : [];
}

export async function readRuleStats(): Promise<Record<string, Record<string, number>>> {
  const data = await browser.storage.local.get(STATS_KEY);
  const raw = data[STATS_KEY];
  return raw && typeof raw === 'object' ? (raw as Record<string, Record<string, number>>) : {};
}

export async function clearDetectionLog(): Promise<void> {
  await browser.storage.local.remove([LOG_KEY, STATS_KEY]);
}

export function recordDetection(
  entry: Omit<DetectionLogEntry, 'at'>,
  now: number = Date.now(),
): Promise<void> {
  const key = `${entry.handle}|${entry.ruleId}`;
  if (isDuplicate(key, now)) {
    return Promise.resolve();
  }
  return serialize(async () => {
    const [log, stats] = await Promise.all([readDetectionLog(), readRuleStats()]);
    const nextLog = [{ at: now, ...entry }, ...log].slice(0, MAX_LOG_ENTRIES);

    const today = todayKey(new Date(now));
    const nextStats: Record<string, Record<string, number>> = {};
    const cutoff = now - KEEP_DAYS * 24 * 60 * 60 * 1000;
    for (const [day, byRule] of Object.entries(stats)) {
      const ts = new Date(`${day}T00:00:00`).getTime();
      if (Number.isFinite(ts) && ts >= cutoff) {
        nextStats[day] = byRule;
      }
    }
    const todayStats = nextStats[today] ?? {};
    todayStats[entry.ruleId] = (todayStats[entry.ruleId] ?? 0) + 1;
    nextStats[today] = todayStats;

    await browser.storage.local.set({ [LOG_KEY]: nextLog, [STATS_KEY]: nextStats });
  });
}
