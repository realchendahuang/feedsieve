/**
 * 规则命中上报（黄推识别的众包被动信号，服务端见 apps/community-api/src/rule-hits.ts）。
 *
 * 本地规则给某个账号打了黄框，就匿名记一条「哪个账号、哪条规则、正文指纹」，攒着定期发给服务器：
 * - 命中不是票：服务器只用它给已有人工票的账号做独立佐证、统计每条规则的误伤率（误伤率高的规则
 *   会被静音，随签名快照下发）、推断分类、排复核队列；
 * - 只报官方规则和内置启发式。个人自定义关键词（keyword:custom:*）、名单命中、已拉黑回显都不报；
 * - 不带安装 ID、Cookie、自己的 X 账号，只带每天轮换的随机会话 ID（和全站热榜的不是同一个）；
 * - 数据全部来自用户正常浏览时页面已经加载的内容，扩展不为此多请求 X 一次；上传从扩展后台
 *   直接发往福滤娃服务器，X 看不到这条流量。
 *
 * 节奏和全站热榜一样：默认 15 分钟一轮、间隔听服务端 next_upload_ms，一轮最多 200 条，
 * 同一账号同一规则每天只报一次；失败指数退避，限额用完按服务端给的时间等。
 */

/** 和服务端 RULE_ID_RE 一致：只收这些规则。 */
export const REPORTABLE_RULE_ID =
  /^(?:keyword:official:[a-z][a-z0-9-]{2,95}|keyword:profile:[a-z][a-z0-9-]{2,40}|weak-signal-combo|fresh-account-combo|contact-number-bait|community-fingerprint|community-fingerprint-sim|community-domain)$/;
const REPORTABLE_SOURCES = new Set(['heuristic', 'fingerprint', 'domain']);

export const RULE_HIT_MESSAGE = 'feedsieve:rule-hits';

export interface RuleHitItem {
  handle: string;
  rule_id: string;
  source: string;
  category?: string;
  fingerprint?: string;
  x_user_id?: string;
  post_id?: string;
}

/** 这条命中能不能上报。 */
export function toReportableHit(input: {
  handle: string;
  ruleId?: string;
  source: string;
  category?: string;
  fingerprint?: string;
  xUserId?: string;
  postId?: string;
}): RuleHitItem | null {
  const ruleId = input.ruleId ?? '';
  const handle = input.handle.trim().replace(/^@+/, '').toLowerCase();
  if (!REPORTABLE_RULE_ID.test(ruleId) || !REPORTABLE_SOURCES.has(input.source)) return null;
  if (!/^[a-z0-9_]{1,15}$/.test(handle)) return null;
  return {
    handle,
    rule_id: ruleId,
    source: input.source,
    ...(input.category ? { category: input.category } : {}),
    ...(input.fingerprint && /^[0-9a-f]{16}$/.test(input.fingerprint)
      ? { fingerprint: input.fingerprint }
      : {}),
    ...(input.xUserId && /^\d{1,20}$/.test(input.xUserId) ? { x_user_id: input.xUserId } : {}),
    ...(input.postId && /^\d{1,20}$/.test(input.postId) ? { post_id: input.postId } : {}),
  };
}

/**
 * 内容脚本一侧：本页命中先去重、攒 5 秒再交给后台（不为每条黄框唤醒 service worker）。
 */
export function createRuleHitQueue(deps: {
  send: (hits: RuleHitItem[]) => Promise<unknown>;
  flushMs?: number;
}) {
  const flushMs = deps.flushMs ?? 5_000;
  const seen = new Set<string>();
  let pending: RuleHitItem[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  function flush(): void {
    timer = undefined;
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    void deps.send(batch).catch(() => undefined);
  }

  function push(hit: RuleHitItem | null): void {
    if (!hit) return;
    const key = `${hit.handle}\u0000${hit.rule_id}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (seen.size > 5_000) seen.clear();
    pending.push(hit);
    timer ??= setTimeout(flush, flushMs);
  }

  return { push, flush };
}

const MINUTE_MS = 60_000;
export const RULE_HIT_INTERVAL_MS = 15 * MINUTE_MS;
const INTERVAL_MIN_MS = 5 * MINUTE_MS;
const INTERVAL_MAX_MS = 60 * MINUTE_MS;
const BACKOFF_MAX_MS = 2 * 60 * MINUTE_MS;
const RETRY_AFTER_MAX_MS = 24 * 60 * MINUTE_MS;
const FIRST_UPLOAD_DELAY_MS = 2 * MINUTE_MS;
const CHUNK = 100;
export const RULE_HIT_MAX_PER_ROUND = 200;
const MAX_PENDING = 2_000;
const MAX_SENT = 5_000;
const SESSION_KEY = 'hitSessionV1';
const STATE_KEY = 'ruleHitUplinkStateV1';

interface Storage {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface RuleHitUplinkDeps {
  /** 「仅本地运行」关闭且「上报规则命中」开启 */
  isAllowed: () => Promise<boolean>;
  post: (body: { session_id: string; hits: RuleHitItem[] }) => Promise<Response>;
  /** 每日会话 ID */
  storage: Storage;
  /** 待发队列（storage.session）；缺省只放内存 */
  stateStorage?: Storage;
  now?: () => number;
  randomId?: () => string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function utcDay(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await response.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** 后台 service worker 一侧：合并所有标签页的命中，按节奏上报。 */
export function createRuleHitUplink(deps: RuleHitUplinkDeps) {
  const now = deps.now ?? (() => Date.now());
  const randomId = deps.randomId ?? (() => crypto.randomUUID());
  const pending = new Map<string, RuleHitItem>();
  /** 今天已经发过的（账号, 规则） */
  let sentDay = '';
  let sent = new Set<string>();
  let nextUploadAt: number | null = null;
  let intervalMs = RULE_HIT_INTERVAL_MS;
  let failures = 0;
  let uploading: Promise<void> | null = null;
  let loaded: Promise<void> | null = null;

  const keyOf = (hit: RuleHitItem): string => `${hit.handle}\u0000${hit.rule_id}`;

  function loadState(): Promise<void> {
    loaded ??= (deps.stateStorage?.get(STATE_KEY) ?? Promise.resolve<Record<string, unknown>>({}))
      .then((result) => {
        const state = result[STATE_KEY] as
          | {
              pending?: unknown;
              sentDay?: unknown;
              sent?: unknown;
              nextUploadAt?: unknown;
              intervalMs?: unknown;
              failures?: unknown;
            }
          | undefined;
        if (Array.isArray(state?.pending)) {
          for (const item of state.pending as RuleHitItem[]) {
            if (item && typeof item.handle === 'string' && typeof item.rule_id === 'string') {
              pending.set(keyOf(item), item);
            }
          }
        }
        if (typeof state?.sentDay === 'string' && Array.isArray(state.sent)) {
          sentDay = state.sentDay;
          sent = new Set(state.sent.filter((key): key is string => typeof key === 'string'));
        }
        if (typeof state?.nextUploadAt === 'number') nextUploadAt = state.nextUploadAt;
        if (typeof state?.intervalMs === 'number') {
          intervalMs = clamp(state.intervalMs, INTERVAL_MIN_MS, INTERVAL_MAX_MS);
        }
        if (typeof state?.failures === 'number') failures = state.failures;
      })
      .catch(() => undefined)
      .then(() => {
        nextUploadAt ??= now() + FIRST_UPLOAD_DELAY_MS;
      });
    return loaded;
  }

  function saveState(): Promise<void> {
    if (!deps.stateStorage) return Promise.resolve();
    return deps.stateStorage
      .set({
        [STATE_KEY]: {
          pending: [...pending.values()],
          sentDay,
          sent: [...sent],
          nextUploadAt,
          intervalMs,
          failures,
        },
      })
      .catch(() => undefined);
  }

  function rollDay(at: number): boolean {
    const day = utcDay(at);
    if (day === sentDay) return false;
    sentDay = day;
    sent = new Set();
    return true;
  }

  async function sessionId(): Promise<string> {
    const day = utcDay(now());
    const stored = (await deps.storage.get(SESSION_KEY))[SESSION_KEY] as
      { day?: string; id?: string } | undefined;
    if (stored?.day === day && typeof stored.id === 'string') return stored.id;
    const id = randomId();
    await deps.storage.set({ [SESSION_KEY]: { day, id } });
    return id;
  }

  /** 记下新命中；返回是否有变化。 */
  function record(hits: unknown): boolean {
    if (!Array.isArray(hits)) return false;
    let changed = false;
    for (const raw of hits as Array<Record<string, unknown>>) {
      if (!raw || typeof raw.handle !== 'string' || typeof raw.source !== 'string') continue;
      const hit = toReportableHit({
        handle: raw.handle,
        ruleId: typeof raw.rule_id === 'string' ? raw.rule_id : undefined,
        source: raw.source,
        category: typeof raw.category === 'string' ? raw.category : undefined,
        fingerprint: typeof raw.fingerprint === 'string' ? raw.fingerprint : undefined,
        xUserId: typeof raw.x_user_id === 'string' ? raw.x_user_id : undefined,
        postId: typeof raw.post_id === 'string' ? raw.post_id : undefined,
      });
      if (!hit) continue;
      const key = keyOf(hit);
      if (sent.has(key)) continue;
      if (pending.has(key)) continue;
      pending.set(key, hit);
      changed = true;
      if (pending.size > MAX_PENDING) {
        const oldest = pending.keys().next().value;
        if (oldest !== undefined) pending.delete(oldest);
      }
    }
    return changed;
  }

  async function upload(): Promise<void> {
    const at = now();
    const items = [...pending.values()].slice(0, RULE_HIT_MAX_PER_ROUND);
    if (items.length === 0) return;
    const id = await sessionId();
    for (let i = 0; i < items.length; i += CHUNK) {
      const chunk = items.slice(i, i + CHUNK);
      const response = await deps.post({ session_id: id, hits: chunk });
      const body = await readJson(response);
      if (!response.ok) {
        failures += 1;
        const retry = typeof body.retry_after_ms === 'number' ? body.retry_after_ms : null;
        nextUploadAt =
          response.status === 429 && retry !== null
            ? at + clamp(retry, intervalMs, RETRY_AFTER_MAX_MS)
            : at + Math.min(intervalMs * 2 ** failures, BACKOFF_MAX_MS);
        // 请求本身不合法（400）：这批不会再好，丢掉
        if (response.status === 400) for (const hit of chunk) pending.delete(keyOf(hit));
        return;
      }
      if (typeof body.next_upload_ms === 'number' && Number.isFinite(body.next_upload_ms)) {
        intervalMs = clamp(body.next_upload_ms, INTERVAL_MIN_MS, INTERVAL_MAX_MS);
      }
      for (const hit of chunk) {
        const key = keyOf(hit);
        pending.delete(key);
        sent.add(key);
      }
      if (sent.size > MAX_SENT) sent = new Set([...sent].slice(-MAX_SENT));
    }
    failures = 0;
    nextUploadAt = at + intervalMs;
  }

  /** 到点就发一轮；返回是否发了（状态变了要存）。 */
  async function maybeUpload(): Promise<boolean> {
    if (uploading || pending.size === 0 || now() < (nextUploadAt ?? 0)) return false;
    nextUploadAt = now() + intervalMs;
    uploading = upload()
      .catch(() => {
        failures += 1;
        nextUploadAt = now() + Math.min(intervalMs * 2 ** failures, BACKOFF_MAX_MS);
      })
      .finally(() => {
        uploading = null;
      });
    await uploading;
    return true;
  }

  async function observe(hits: unknown): Promise<void> {
    await loadState();
    if (!(await deps.isAllowed())) {
      if (pending.size > 0) {
        pending.clear();
        await saveState();
      }
      return;
    }
    const dayChanged = rollDay(now());
    const recorded = record(hits);
    const uploaded = await maybeUpload();
    // 每条浏览观测都会顺手调一次 observe([])：没变化就不写 storage.session
    if (dayChanged || recorded || uploaded) await saveState();
  }

  return { observe, pendingCount: () => pending.size };
}

export type RuleHitUplink = ReturnType<typeof createRuleHitUplink>;
