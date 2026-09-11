import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applySignal,
  CLEAN_STREAK_FOR_RECOVERY,
  FALLBACK_ACCOUNT_KEY,
  loadSafetyLedger,
  normalizeLedger,
  paceForPreset,
  persistSignal,
  recordSafetyEvent,
  remainingQuota,
  rolloverBudget,
  SAFETY_PRESETS,
  setSafetyBudgetOverride,
  shouldPauseForQuota,
  usedInWindow,
  type SafetyLedger,
} from './block-safety';

let storage: Record<string, unknown>;

beforeEach(() => {
  storage = {};
  vi.stubGlobal('browser', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
        set: vi.fn(async (patch: Record<string, unknown>) => Object.assign(storage, patch)),
        remove: vi.fn(async (key: string) => {
          delete storage[key];
        }),
      },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  });
});

const NOW = 1_800_000_000_000;
const HOUR_MS = 60 * 60 * 1000;

describe('block-safety 安全账本', () => {
  it('新账号从零计账：默认 balanced 400，记录成功后额度递减', async () => {
    const ledger = await loadSafetyLedger('acc-1');
    expect(ledger).toMatchObject({ accountKey: 'acc-1', preset: 'balanced', dailyLimit: 400 });
    expect(usedInWindow(ledger, NOW)).toBe(0);
    expect(remainingQuota(ledger, NOW)).toBe(400);

    await recordSafetyEvent('acc-1', NOW);
    await recordSafetyEvent('acc-1', NOW + 1000);
    const after = await loadSafetyLedger('acc-1');
    expect(usedInWindow(after, NOW + 1000)).toBe(2);
    expect(remainingQuota(after, NOW + 1000)).toBe(398);
  });

  it('滚动窗口：24h 之前的事件不计，超时自动滑出', async () => {
    for (let i = 0; i < 25; i += 1) {
      await recordSafetyEvent('acc-1', NOW - 25 * HOUR_MS + i * HOUR_MS);
    }
    const ledger = await loadSafetyLedger('acc-1');
    // 25 次分布在 NOW-25h … NOW-1h；窗口起点 NOW-24h，最早的 NOW-25h 被滑出
    expect(usedInWindow(ledger, NOW)).toBe(24);
  });

  it('换账号换一本账，旧账不混算', async () => {
    await recordSafetyEvent('acc-1', NOW);
    const ledgerB = await loadSafetyLedger('acc-2');
    expect(usedInWindow(ledgerB, NOW)).toBe(0);
    // 回读 acc-1 仍是它自己的账
    const ledgerA = await loadSafetyLedger('acc-1');
    expect(usedInWindow(ledgerA, NOW)).toBe(1);
  });

  it('到量后 remaining 为 0；「仍要继续」的队列本轮放行（友情提醒不是硬闸）', async () => {
    for (let i = 0; i < SAFETY_PRESETS.balanced.dailyLimit; i += 1) {
      await recordSafetyEvent('acc-1', NOW + i);
    }
    const ledger = await loadSafetyLedger('acc-1');
    expect(usedInWindow(ledger, NOW + 10_000)).toBe(SAFETY_PRESETS.balanced.dailyLimit);
    expect(remainingQuota(ledger, NOW + 10_000)).toBe(0);
    expect(shouldPauseForQuota(null, ledger, NOW + 10_000)).toBe(true);
    expect(shouldPauseForQuota({}, ledger, NOW + 10_000)).toBe(true);
    expect(shouldPauseForQuota({ quotaOverride: true }, ledger, NOW + 10_000)).toBe(false);
    // 有余量时无论是否 override 都不停
    expect(shouldPauseForQuota({}, { ...ledger, events: [] }, NOW + 10_000)).toBe(false);
  });

  it('pace 抖动：间隔落在 [base, base+jitter]，随机注入时非固定节拍', () => {
    expect(paceForPreset('balanced', () => 0)).toBe(800);
    expect(paceForPreset('balanced', () => 1)).toBe(1800);
    // 相同随机序列稳定输出
    expect(paceForPreset('balanced', () => 0.5)).toBe(1300);
    const samples = [0.1, 0.2, 0.9, 0.4, 0.7].map((r) => paceForPreset('balanced', () => r));
    expect(new Set(samples).size).toBe(5);
    // 未知档位回退默认
    expect(paceForPreset('aggressive', () => 0)).toBe(600);
  });

  it('normalizeLedger 丢弃损坏结构，未知档位回退默认', () => {
    expect(normalizeLedger(null)).toBeNull();
    expect(normalizeLedger({ preset: 'balanced' })).toBeNull();
    expect(
      normalizeLedger({
        accountKey: 'acc-1',
        preset: 'hyper',
        dailyLimit: 5000,
        events: ['nope', NOW, NOW - HOUR_MS * 30],
      }),
    ).toMatchObject({
      accountKey: 'acc-1',
      preset: 'balanced', // 未知档位回退
      dailyLimit: 5000, // 用户自定预算无硬顶，不再收敛到 800
      events: [NOW - HOUR_MS * 30, NOW], // 非数字剔除；窗口过滤在使用时（trimEvents）做
    });
  });

  it('无 accountKey 时只读：未存储则返回匿名空账本，不落盘', async () => {
    const ledger = await loadSafetyLedger();
    expect(ledger.accountKey).toBe(FALLBACK_ACCOUNT_KEY);
    expect(usedInWindow(ledger, NOW)).toBe(0);
    expect(storage.blockSafetyLedgerV1).toBeUndefined();
  });

  it('currentAccountKey 从 cookie 取（auth_user_id 优先，twid 兜底）', async () => {
    vi.stubGlobal('document', { cookie: 'ct0=abc; auth_user_id=9876543210; other=1' });
    const { currentAccountKey } = await import('./block-safety');
    expect(currentAccountKey()).toBe('9876543210');

    vi.stubGlobal('document', { cookie: 'twid=u%3D12345; ct0=abc' });
    expect(currentAccountKey()).toBe('12345');

    vi.stubGlobal('document', { cookie: 'ct0=abc' });
    expect(currentAccountKey()).toBeNull();
  });

  /** 本地正午时刻（避免凌晨边界跨日的时区抖动） */
  const dayMs = (y: number, m: number, d: number): number => new Date(y, m - 1, d, 12, 0, 0).getTime();

  it('响应式预算：429 风暴砍半、认证失效清零，连续无信号逐日回补', async () => {
    let ledger = await loadSafetyLedger('acc-1');
    // 风暴：默认 balanced 400 → 200
    ledger = applySignal(ledger, 'rate_limit_storm', dayMs(2026, 9, 1));
    expect(ledger.budget).toBe(200);
    expect(ledger.cleanStreak).toBe(0);
    expect(ledger.lastSignalDay).toBe('2026-09-01');

    // 信号日当天不回补、不算干净天
    ledger = rolloverBudget(ledger, dayMs(2026, 9, 1));
    expect(ledger.budget).toBe(200);
    expect(ledger.cleanStreak).toBe(0);

    // 9-2 → streak1，9-3 → streak2（都不回补）；9-4 → streak3 → +50
    ledger = rolloverBudget(ledger, dayMs(2026, 9, 2));
    expect(ledger.cleanStreak).toBe(1);
    expect(ledger.budget).toBe(200);
    ledger = rolloverBudget(ledger, dayMs(2026, 9, 3));
    expect(ledger.budget).toBe(200);
    ledger = rolloverBudget(ledger, dayMs(2026, 9, 4));
    expect(ledger.cleanStreak).toBe(3);
    expect(ledger.budget).toBe(250);

    // 同一天幂等：不会重复回补
    ledger = rolloverBudget(ledger, dayMs(2026, 9, 4));
    expect(ledger.budget).toBe(250);

    // 9-5 → streak4 → 300（每天 +50）
    ledger = rolloverBudget(ledger, dayMs(2026, 9, 5));
    expect(ledger.budget).toBe(300);

    // 认证失效：当天预算清零
    ledger = applySignal(ledger, 'auth_required', dayMs(2026, 9, 6));
    expect(ledger.budget).toBe(0);
  });

  it('回补：预算存档仅封顶；未参保收则无限爬升', () => {
    const fuse: SafetyLedger = {
      accountKey: 'acc-1',
      preset: 'balanced',
      dailyLimit: 800,
      budget_cap: 800,
      budget: 780,
      cleanStreak: CLEAN_STREAK_FOR_RECOVERY,
      events: [],
      lastCleanDay: '2026-09-01',
      updatedAt: dayMs(2026, 9, 1),
    };
    // 780 + 50 → 800 封顶（上限 = 保险丝）
    expect(rolloverBudget(fuse, dayMs(2026, 9, 2)).budget).toBe(800);
    expect(rolloverBudget({ ...fuse, budget: 800 }, dayMs(2026, 9, 2)).budget).toBe(800);

    // 未设保险丝：不封顶，一路爬升（800 + 50 也继续涨）
    const adaptive: SafetyLedger = { ...fuse, budget_cap: undefined };
    expect(rolloverBudget(adaptive, dayMs(2026, 9, 2)).budget).toBe(830);
    expect(rolloverBudget({ ...adaptive, dailyLimit: 400 }, dayMs(2026, 9, 2)).budget).toBe(830);
    // 没保险丝的用户预算再低也不回填 dailyLimit 的短板
    expect(rolloverBudget({ ...adaptive, dailyLimit: 600, budget: 1500 }, dayMs(2026, 9, 2)).budget).toBe(1550);

    // 信号后 redo streak：信号日从 0 重新计
    const signaled = applySignal(fuse, 'rate_limit_storm', dayMs(2026, 9, 2));
    expect(signaled.budget).toBe(390);
    expect(signaled.cleanStreak).toBe(0);
    const nextDay = rolloverBudget(signaled, dayMs(2026, 9, 3));
    expect(nextDay.cleanStreak).toBe(1);
    expect(nextDay.budget).toBe(390);
  });

  it('用户自定预算 override：未被信号收缩时跟随新值；被收缩时保持惩罚等回补', async () => {
    await setSafetyBudgetOverride(1200);
    // 新账号直接以自定义值起步
    const fresh = await loadSafetyLedger('acc-1');
    expect(fresh.dailyLimit).toBe(1200);
    expect(fresh.budget).toBe(1200);

    // 已有账本未被收缩：预算跟随
    storage.blockSafetyBudgetV1 = { dailyLimit: 600 };
    const raised = await loadSafetyLedger('acc-1');
    expect(raised.dailyLimit).toBe(600);
    expect(raised.budget).toBe(600);

    // 被信号收缩过的账本（风暴砍半 600→300）：提高上限不清惩罚，只改 dailyLimit
    storage.blockSafetyBudgetV1 = { dailyLimit: 600 };
    await loadSafetyLedger('acc-1');
    await persistSignal('acc-1', 'rate_limit_storm', NOW);
    storage.blockSafetyBudgetV1 = { dailyLimit: 1500 };
    const shrunk = await loadSafetyLedger('acc-1');
    expect(shrunk.dailyLimit).toBe(1500);
    expect(shrunk.budget).toBe(300);
  });

  it('清空保险丝：恢复自适应（无 budget_cap），新账号回到档位起点', async () => {
    await setSafetyBudgetOverride(1200);
    await loadSafetyLedger('acc-1');
    storage.blockSafetyBudgetV1 = { dailyLimit: 1200 };
    await expect(setSafetyBudgetOverride(null)).resolves.toBeNull();
    expect(storage.blockSafetyBudgetV1).toBeUndefined();
    const fresh = await loadSafetyLedger('acc-2');
    expect(fresh.dailyLimit).toBe(400);
    expect(fresh.budget).toBe(400);
    expect(fresh.budget_cap).toBeUndefined();
  });

  it('PR1 存量账本（无 budget 字段）无缝升级：预算 = 档位基线', async () => {
    storage.blockSafetyLedgerV1 = {
      activeAccountKey: 'acc-1',
      ledgers: {
        'acc-1': {
          accountKey: 'acc-1',
          preset: 'balanced',
          dailyLimit: 400,
          events: [NOW],
          updatedAt: NOW,
        },
      },
    };
    const ledger = await loadSafetyLedger('acc-1');
    expect(ledger.budget).toBe(400);
    // 升级后首次读取即完成当日回补标记（cleanStreak 1，未满 3 天不回补）
    expect(ledger.cleanStreak).toBe(1);
    expect(usedInWindow(ledger, NOW)).toBe(1);
  });

  it('persistSignal 落盘：风暴收缩后可回读，remainingQuota 用当前预算', async () => {
    await persistSignal('acc-1', 'rate_limit_storm', dayMs(2026, 9, 1));
    const ledger = await loadSafetyLedger('acc-1');
    expect(ledger.budget).toBe(200);
    expect(ledger.lastSignalDay).toBe('2026-09-01');
    expect(remainingQuota(ledger, dayMs(2026, 9, 1) + HOUR_MS)).toBe(200);

    // 已用 50 后剩余 = budget − used
    const used = { ...ledger, events: [dayMs(2026, 9, 1) + HOUR_MS] };
    expect(remainingQuota(used, dayMs(2026, 9, 1) + HOUR_MS * 2)).toBe(199);
  });
});