/**
 * 原生静音词的 content script 消息处理。
 *
 * 写请求只由 popup 里用户的逐次操作触发；这里再做一层硬护栏：
 * - create/destroy 之前用户必须已经确认过「写入我的 X 账号」（consented）；
 * - 两条写请求之间至少隔 2 秒；
 * - 每天最多 30 次新增写入，超了就停，不自动重试；
 * - 删除不占新增额度（否则删到一半会被额度卡住）。
 */
import {
  createNativeMute,
  destroyNativeMutes,
  listNativeMutes,
  type NativeMuteResult,
} from '../mute/native-mutes';
import { getMuteSettings, normalizeMutePhrase, type NativeMute } from '../mute/mute-store';

const BUDGET_KEY = 'muteWriteBudgetV1';
const MIN_INTERVAL_MS = 2_000;
const DAILY_LIMIT = 30;
const LIST_CACHE_MS = 60_000;

let listCache: { at: number; data: NativeMute[] } | null = null;

interface WriteBudget {
  date: string;
  count: number;
}

let lastWriteAt = 0;

function localDate(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
}

async function readBudget(): Promise<WriteBudget> {
  const stored = await browser.storage.local.get(BUDGET_KEY);
  const value = stored[BUDGET_KEY] as Partial<WriteBudget> | undefined;
  const today = localDate();
  return value?.date === today
    ? { date: today, count: Math.max(0, Math.floor(Number(value.count) || 0)) }
    : { date: today, count: 0 };
}

async function recordWrite(): Promise<void> {
  const budget = await readBudget();
  await browser.storage.local.set({
    [BUDGET_KEY]: { date: budget.date, count: budget.count + 1 },
  });
}

async function waitForSlot(): Promise<void> {
  const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastWriteAt));
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastWriteAt = Date.now();
}

export function registerMuteMessageHandlers(): void {
  browser.runtime.onMessage.addListener((message: unknown) => {
    const msg = message as {
      type?: string;
      keyword?: unknown;
      ids?: unknown;
      force?: unknown;
    } | null;
    const type = msg?.type;
    if (type === 'feedsieve:mute-list') {
      if (msg?.force !== true && listCache && Date.now() - listCache.at < LIST_CACHE_MS) {
        return Promise.resolve({ ok: true, data: listCache.data });
      }
      return listNativeMutes().then((result) => {
        if (result.ok) listCache = { at: Date.now(), data: result.data };
        return result;
      });
    }
    if (type === 'feedsieve:mute-create') {
      const phrase = normalizeMutePhrase(msg?.keyword);
      if (!phrase) return Promise.resolve({ ok: false, code: 'invalid_keyword' });
      return (async (): Promise<NativeMuteResult<{ mute: unknown; list: unknown }> | { ok: false; code: string }> => {
        const settings = await getMuteSettings();
        if (!settings.consented) return { ok: false, code: 'consent_required' };
        const budget = await readBudget();
        if (budget.count >= DAILY_LIMIT) return { ok: false, code: 'daily_limit' };
        await waitForSlot();
        const result = await createNativeMute(phrase);
        if (result.ok) {
          listCache = null;
          await recordWrite();
        }
        return result;
      })();
    }
    if (type === 'feedsieve:mute-destroy') {
      const ids = Array.isArray(msg?.ids)
        ? msg.ids.filter((id): id is string => typeof id === 'string')
        : [];
      if (ids.length === 0) return Promise.resolve({ ok: false, code: 'invalid_ids' });
      return (async () => {
        await waitForSlot();
        const result = await destroyNativeMutes(ids);
        if (result.ok) listCache = null;
        return result;
      })();
    }
    return undefined;
  });
}
