/**
 * 批量拉黑安全账本（P0，规格与背景见 docs/BLOCK_SAFETY.md）。
 *
 * X 不公布 block 限额，且风控是账号级、自适应的：同一数字对不同账号含义不同
 * （新号/刚锁定过的号远低于 400，信誉好的老号远高于 400；2026-05 后 X 按
 * rate-limit header 响应，部分号能到 6000+/天）。因此本模块用**响应式预算**：
 * 档位数值只是预算起点，不是天花板——风控信号收缩预算，连续无信号逐日回补。
 *
 * - 顺手拉黑与队列拉黑共用同一本账（撤销在 PR2 并入，见 BLOCK_SAFETY.md）；
 * - 只计确认成功的 block；失败 / no-id / 跳过不计；
 * - 到量后队列整队 pause（quota_exhausted），剩余任务保留；额度是友情提醒不是硬闸，
 *   用户点「仍要继续」即放行本轮（quotaOverride），X 侧真实推力由 429 风暴 / 认证失效兜底；
 * - 成功后相邻间隔（base + 抖动）也由此处给出，速度与日量一处置于扩展。
 *
 * 纯函数与 storage 适配分离：runQueuedBlocks 不引用本模块；额度判断由宿主
 * perform 返回 { ok: false, code: 'quota_exhausted' }，classifyFailure 归为 pause。
 */

import { jitteredPaceMs } from '@feedsieve/block-queue';

export type SafetyPreset = 'conservative' | 'balanced' | 'aggressive';

export interface SafetyPresetConfig {
  /** 滚动 24h 成功写操作的预算起点（block + unblock 合并） */
  dailyLimit: number;
  /** 成功后相邻请求间隔 base（ms） */
  paceBaseMs: number;
  /** 间隔抖动上界（ms）：实际间隔 = base + random(0, jitter) */
  paceJitterMs: number;
  /** 每成功 N 次插入一次强制休息（PR3 启用，先落表） */
  cooldownEvery: number;
}

export const SAFETY_PRESETS: Record<SafetyPreset, SafetyPresetConfig> = {
  conservative: { dailyLimit: 200, paceBaseMs: 1200, paceJitterMs: 1300, cooldownEvery: 80 },
  balanced: { dailyLimit: 400, paceBaseMs: 800, paceJitterMs: 1000, cooldownEvery: 80 },
  aggressive: { dailyLimit: 500, paceBaseMs: 600, paceJitterMs: 800, cooldownEvery: 80 },
};

export const SAFETY_PRESET_ORDER: SafetyPreset[] = ['conservative', 'balanced', 'aggressive'];
export const DEFAULT_PRESET: SafetyPreset = 'balanced';
/**
 * 用户自定日预算没有上限：想设多大设多大，风险自负（设置页只给一句话提示）。
 * 这个常量只是「无自定义时」各档位起点之外的口径展示兜底，不再是任何闸门。
 */
export const HARD_LIMIT_MAX = 800;
/** 用户自定义预算的 storage 键（全局偏好，不分账号；账本本身分账号）。 */
const BUDGET_OVERRIDE_KEY = 'blockSafetyBudgetV1';
/** 滚动窗口：24 小时（不用本地日历日，避免 23:50 打满、00:10 再打一轮的连续爆发）。 */
export const SAFETY_WINDOW_MS = 24 * 60 * 60 * 1000;
/** 连续无风控信号达到该自然日后，预算开始逐日回补。 */
export const CLEAN_STREAK_FOR_RECOVERY = 3;
/** 每个干净自然日的预算回补量；封顶只在用户设了保险丝（budget_cap）时生效。 */
export const RECOVERY_STEP_PER_DAY = 50;
/** 连续 429 达到该次数后升级为 rate_limit_storm（收缩预算 + 整队暂停）。 */
export const RATE_LIMIT_STORM_THRESHOLD = 3;
/** 读不到 cookie 时的兜底账号键：按匿名账本保守计数。 */
export const FALLBACK_ACCOUNT_KEY = 'no-account';

/**
 * 风控收缩信号：风暴砍半，其余（认证失效 / 人机挑战）当天清零。
 * TODO(block-safety PR2, docs/BLOCK_SAFETY.md)：`challenge` 分支已支持、尚未接线——
 * 需用真机验证 X 验证码响应的特征（如 429+challenge、登录墙跳转）后在宿主侧检测上报。
 */
export type SafetySignal = 'rate_limit_storm' | 'auth_required' | 'challenge';

export interface SafetyLedger {
  accountKey: string;
  preset: SafetyPreset;
  /** 档位预算起点（50–800 可调，PR3 设置页）；不是固定闸门 */
  dailyLimit: number;
  /**
   * 用户自定的回补封顶（保险丝）。缺省 = 不封顶：干净账号预算一路自动爬升，
   * X 的真实风控（429 / 锁号）就是天花板。设了保险丝则回补到该值为止。
   */
  budget_cap?: number;
  /** 当前生效预算（≤ HARD_LIMIT_MAX）：信号收缩、连续无信号逐日回补 */
  budget: number;
  /** 连续无风控信号的自然日数（信号日清零，跨日 +1） */
  cleanStreak: number;
  /** 最近一次风控信号的日期键（YYYY-MM-DD） */
  lastSignalDay?: string;
  /** 上次完成跨日回补/标记的日期键（幂等，同一天不重复回补） */
  lastCleanDay?: string;
  /** 滚动 24h 内成功写操作的时间戳（Unix ms，升序） */
  events: number[];
  lastPausedReason?: string;
  updatedAt: number;
}

/** storage 外层：按账号分槽，换账号不销毁旧账（旧账保留但不混算）。 */
interface SafetyLedgerStore {
  activeAccountKey: string;
  ledgers: Record<string, SafetyLedger>;
}

const STORAGE_KEY = 'blockSafetyLedgerV1';

function dayKey(now: number): string {
  const d = new Date(now);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const date = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${date}`;
}

function freshLedger(accountKey: string): SafetyLedger {
  const preset = DEFAULT_PRESET;
  const dailyLimit = SAFETY_PRESETS[preset].dailyLimit;
  return {
    accountKey,
    preset,
    dailyLimit,
    budget: dailyLimit,
    cleanStreak: 0,
    events: [],
    updatedAt: Date.now(),
  };
}

/** 只保留窗口内的时间戳（输入已升序时输出也升序）。 */
export function trimEvents(events: number[], now: number): number[] {
  const cutoff = now - SAFETY_WINDOW_MS;
  return events.filter((timestamp) => timestamp >= cutoff);
}

export function usedInWindow(ledger: SafetyLedger, now: number): number {
  return trimEvents(ledger.events, now).length;
}

/** 剩余预算 = 当前生效预算 − 滚动 24h 已用；到 0 即队列不再发请求。 */
export function remainingQuota(ledger: SafetyLedger, now: number): number {
  return Math.max(0, ledger.budget - usedInWindow(ledger, now));
}

/**
 * 队列是否应因额度暂停。额度是友情提醒而不是硬闸：用户对「额度用尽」暂停点了
 * 「仍要继续」（队列 quotaOverride）后，本轮不再因额度停队——X 侧真实推力仍由
 * 429 风暴 / 认证失效信号负责兜底。
 */
export function shouldPauseForQuota(
  queue: { quotaOverride?: boolean } | null | undefined,
  ledger: SafetyLedger,
  now: number,
): boolean {
  return !queue?.quotaOverride && remainingQuota(ledger, now) <= 0;
}

/**
 * 风控信号收缩预算：429 风暴砍半，认证失效 / 人机挑战清零。
 * 信号日 cleanStreak 归零，当天不再回补（rolloverBudget 幂等标记）。
 */
export function applySignal(ledger: SafetyLedger, signal: SafetySignal, now: number): SafetyLedger {
  const budget = signal === 'rate_limit_storm' ? Math.floor(ledger.budget / 2) : 0;
  return {
    ...ledger,
    budget: Math.max(0, budget),
    cleanStreak: 0,
    lastSignalDay: dayKey(now),
    updatedAt: now,
  };
}

/**
 * 跨日回补：每个无信号自然日 cleanStreak +1；连续 CLEAN_STREAK_FOR_RECOVERY 天
 * 无信号后每天 +RECOVERY_STEP_PER_DAY，直到用户自定的预算值（dailyLimit）。
 * 信号日只标记不清零。同一天多次调用幂等（lastCleanDay 做闸）。
 */
export function rolloverBudget(ledger: SafetyLedger, now: number): SafetyLedger {
  const day = dayKey(now);
  if (ledger.lastCleanDay === day) {
    return ledger;
  }
  if (ledger.lastSignalDay === day) {
    return { ...ledger, lastCleanDay: day };
  }
  const cleanStreak = ledger.cleanStreak + 1;
  // 保险丝（budget_cap）在才封顶；没设就一路爬升，X 的真实接受度是天花板
  const cap = ledger.budget_cap ?? Number.POSITIVE_INFINITY;
  const budget =
    cleanStreak >= CLEAN_STREAK_FOR_RECOVERY
      ? Math.min(ledger.budget + RECOVERY_STEP_PER_DAY, cap)
      : ledger.budget;
  return { ...ledger, cleanStreak, budget, lastCleanDay: day, updatedAt: now };
}

/**
 * 用户自定预算（保险丝，无硬顶）。应用规则：
 * - dailyLimit 与 budget_cap 都改成用户值；
 * - budget 只在「未被风控信号收缩」（即等于旧 dailyLimit）时跟随新值；
 * - 已被收缩的 budget 保持原样——提高上限不等于清掉风控惩罚，等逐日回补。
 */
export function applyBudgetOverride(ledger: SafetyLedger, override: number): SafetyLedger {
  if (ledger.dailyLimit === override && ledger.budget_cap === override) {
    return ledger;
  }
  const shrunk = ledger.budget < ledger.dailyLimit;
  return {
    ...ledger,
    dailyLimit: override,
    budget_cap: override,
    budget: shrunk ? Math.min(ledger.budget, override) : override,
    updatedAt: Date.now(),
  };
}

/** 成功后相邻间隔：base + jitter 内抖动，避免固定节拍器被 X 的规律自动化识别。 */
export function paceForPreset(preset: SafetyPreset, random: () => number = Math.random): number {
  const config = SAFETY_PRESETS[preset] ?? SAFETY_PRESETS[DEFAULT_PRESET];
  return jitteredPaceMs(config.paceBaseMs, config.paceJitterMs, random);
}

/** storage 装载守卫：损坏/旧格式丢弃，字段逐项收敛（与 block-queue-store 同风格）。 */
export function normalizeLedger(value: unknown): SafetyLedger | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<SafetyLedger>;
  if (typeof raw.accountKey !== 'string' || !raw.accountKey) return null;
  const preset: SafetyPreset = SAFETY_PRESETS[raw.preset as SafetyPreset]
    ? (raw.preset as SafetyPreset)
    : DEFAULT_PRESET;
  const dailyLimit = Number.isFinite(raw.dailyLimit)
    ? Math.max(1, Math.round(raw.dailyLimit as number))
    : SAFETY_PRESETS[preset].dailyLimit;
  const events = Array.isArray(raw.events)
    ? raw.events
        .filter(
          (timestamp): timestamp is number =>
            typeof timestamp === 'number' && Number.isFinite(timestamp),
        )
        .sort((a, b) => a - b)
        .slice(-dailyLimit)
    : [];
  return {
    accountKey: raw.accountKey,
    preset,
    dailyLimit,
    // PR1 存量账本没有 budget：无缝升级为以档位基线起步
    budget: Number.isFinite(raw.budget)
      ? Math.max(0, Math.round(raw.budget as number))
      : dailyLimit,
    cleanStreak: Number.isFinite(raw.cleanStreak)
      ? Math.max(0, Math.round(raw.cleanStreak as number))
      : 0,
    events,
    // 保险丝缺省即不封顶（存量账本没有这字段 → 纯自适应，行为等同升级）
    ...(Number.isFinite(raw.budget_cap)
      ? { budget_cap: Math.max(1, Math.round(raw.budget_cap as number)) }
      : {}),
    ...(typeof raw.lastSignalDay === 'string' ? { lastSignalDay: raw.lastSignalDay } : {}),
    ...(typeof raw.lastCleanDay === 'string' ? { lastCleanDay: raw.lastCleanDay } : {}),
    ...(typeof raw.lastPausedReason === 'string' ? { lastPausedReason: raw.lastPausedReason } : {}),
    updatedAt: Number(raw.updatedAt) || Date.now(),
  };
}

/** storage 外层守卫：旧版单账号直存（无 ledgers 字段）视为空仓库，回退新结构。 */
function normalizeStore(value: unknown): SafetyLedgerStore | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<SafetyLedgerStore>;
  if (typeof raw.activeAccountKey !== 'string' || !raw.ledgers || typeof raw.ledgers !== 'object') {
    return null;
  }
  const ledgers: Record<string, SafetyLedger> = {};
  for (const [accountKey, ledger] of Object.entries(raw.ledgers)) {
    const normalized = normalizeLedger(ledger);
    if (normalized && normalized.accountKey === accountKey) {
      ledgers[accountKey] = normalized;
    }
  }
  const active =
    typeof ledgers[raw.activeAccountKey] === 'undefined'
      ? Object.entries(ledgers).sort((a, b) => b[1].updatedAt - a[1].updatedAt)[0]?.[0]
      : raw.activeAccountKey;
  if (!active) return null;
  return { activeAccountKey: active, ledgers };
}

async function readStore(): Promise<SafetyLedgerStore | null> {
  const stored = await browser.storage.local.get(STORAGE_KEY);
  return normalizeStore(stored[STORAGE_KEY]);
}

function normalizeBudgetOverride(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(1, Math.round(parsed));
}

async function readBudgetOverride(): Promise<number | null> {
  const stored = await browser.storage.local.get(BUDGET_OVERRIDE_KEY);
  const raw = (stored[BUDGET_OVERRIDE_KEY] as { dailyLimit?: unknown } | undefined)?.dailyLimit;
  return normalizeBudgetOverride(raw);
}

/** 当前生效保险丝 = 用户自定义值；未设置过为 null（默认不封顶，纯自适应爬升）。 */
export async function getSafetyBudgetOverride(): Promise<number | null> {
  return readBudgetOverride();
}

/**
 * 我说了算的日预算（保险丝）：设置页任意整数（≥1），无上限。写入 override 存储，
 * 现存账本在下次 loadSafetyLedger 时套用（未被信号收缩的预算跟随新值）。
 * 传 null 恢复默认自适应（无封顶，爬升由 X 的真实接受度决定）。
 */
export async function setSafetyBudgetOverride(value: number | null): Promise<number | null> {
  if (value == null) {
    await browser.storage.local.remove(BUDGET_OVERRIDE_KEY);
    return null;
  }
  const dailyLimit = Math.max(1, Math.round(value));
  await browser.storage.local.set({ [BUDGET_OVERRIDE_KEY]: { dailyLimit } });
  return dailyLimit;
}

async function writeStore(next: SafetyLedgerStore): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEY]: next });
}

/**
 * 账本写互斥：读-改-写不是原子操作，单条拉黑与队列执行可并发进入，
 * 两个调用同时读到同一 events 数组会丢掉其中一笔成功写记录（额度少计）。
 * 模块级 Promise 链把整段读改写串行化；某次失败不影响后续排队写入。
 */
let ledgerWriteQueue: Promise<unknown> = Promise.resolve();
function enqueueLedgerWrite<T>(operation: () => Promise<T>): Promise<T> {
  const next = ledgerWriteQueue.then(operation, operation);
  ledgerWriteQueue = next.catch(() => {
    // 吞掉让后续写不受前次失败影响；调用方自己拿原始 rejection
  });
  return next;
}

/**
 * 读取账本（含惰性跨日回补）。accountKey 给定时读该账号自己的账（缺则新建并落盘，
 * 作为「当前账号」），回补变化持久化；accountKey 为空（popup 场景）只读最近活跃
 * 账号的账，回补仅用于展示、不落盘（下次 content 动作时落盘）。
 */
export async function loadSafetyLedger(accountKey?: string | null): Promise<SafetyLedger> {
  const store = await readStore();
  const override = await readBudgetOverride();
  const now = Date.now();
  if (!accountKey) {
    const fallback = store
      ? store.ledgers[store.activeAccountKey]
      : freshLedger(FALLBACK_ACCOUNT_KEY);
    let ledger = rolloverBudget(fallback ?? freshLedger(FALLBACK_ACCOUNT_KEY), now);
    if (override != null) {
      ledger = applyBudgetOverride(ledger, override);
    }
    return ledger;
  }
  const existing = store?.ledgers[accountKey];
  if (existing) {
    let next = rolloverBudget(existing, now);
    const overrideChanged = override != null && next.dailyLimit !== override;
    if (overrideChanged) {
      next = applyBudgetOverride(next, override);
    }
    const changed =
      next.budget !== existing.budget ||
      next.cleanStreak !== existing.cleanStreak ||
      next.dailyLimit !== existing.dailyLimit ||
      next.lastCleanDay !== existing.lastCleanDay;
    if (changed || (store && store.activeAccountKey !== accountKey)) {
      await writeStore({
        ...(store ?? { activeAccountKey: accountKey, ledgers: {} }),
        activeAccountKey: accountKey,
        ledgers: { ...(store?.ledgers ?? {}), [accountKey]: next },
      });
    }
    return next;
  }
  let fresh = freshLedger(accountKey);
  if (override != null) {
    fresh = applyBudgetOverride(fresh, override);
  }
  const ledgers = store ? { ...store.ledgers, [accountKey]: fresh } : { [accountKey]: fresh };
  await writeStore({ activeAccountKey: accountKey, ledgers });
  return fresh;
}

/** 记一笔成功的破坏性写操作（block/unblock 都算）。accountKey 拿不到时退化为匿名账本。 */
export async function recordSafetyEvent(
  accountKey: string | null,
  now: number = Date.now(),
): Promise<SafetyLedger> {
  return enqueueLedgerWrite(async () => {
    const key = accountKey ?? FALLBACK_ACCOUNT_KEY;
    const ledger = await loadSafetyLedger(key);
    const events = [...trimEvents(ledger.events, now), now].slice(-ledger.dailyLimit);
    const next: SafetyLedger = { ...ledger, events, updatedAt: now };
    const store = (await readStore()) ?? {
      activeAccountKey: key,
      ledgers: { [key]: next },
    };
    await writeStore({ ...store, ledgers: { ...store.ledgers, [key]: next } });
    return next;
  });
}

/** 风控信号落账：收缩预算 + cleanStreak 归零（host 在 429 风暴 / 认证失效时调用）。 */
export async function persistSignal(
  accountKey: string | null,
  signal: SafetySignal,
  now: number = Date.now(),
): Promise<SafetyLedger> {
  return enqueueLedgerWrite(async () => {
    const key = accountKey ?? FALLBACK_ACCOUNT_KEY;
    const ledger = await loadSafetyLedger(key);
    const next = rolloverBudget(applySignal(ledger, signal, now), now);
    const store = (await readStore()) ?? {
      activeAccountKey: key,
      ledgers: { [key]: next },
    };
    await writeStore({ ...store, ledgers: { ...store.ledgers, [key]: next } });
    return next;
  });
}

/** 订阅账本变化（popup 额度条实时刷新）。返回解绑函数。 */
export function subscribeSafetyLedger(onChange: (ledger: SafetyLedger) => void): () => void {
  const listener = (changes: Record<string, unknown>, areaName: string) => {
    if (areaName === 'local' && changes[STORAGE_KEY]) {
      void loadSafetyLedger().then(onChange);
    }
  };
  browser.storage.onChanged.addListener(
    listener as Parameters<typeof browser.storage.onChanged.addListener>[0],
  );
  return () =>
    browser.storage.onChanged.removeListener(
      listener as Parameters<typeof browser.storage.onChanged.removeListener>[0],
    );
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  for (const part of document.cookie.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${name}=`)) {
      return trimmed.substring(name.length + 1) || null;
    }
  }
  return null;
}

/**
 * 当前登录 X 账号 id（cookie 通道，与 x-adapter 读 ct0 同源；ISOLATED world 可读）。
 * 拿不到时返回 null——调用方走匿名账本保守计数，而不是停记。
 */
export function currentAccountKey(): string | null {
  try {
    const uid = readCookie('auth_user_id');
    if (uid) return uid;
    const twid = readCookie('twid');
    if (!twid) return null;
    // X 的 twid 值是 URL 编码的 "u=<id>"（如 u%3D12345），两种形态都兜住
    const decoded = decodeURIComponent(twid).replace(/^u=/, '');
    return decoded || null;
  } catch {
    return null;
  }
}
