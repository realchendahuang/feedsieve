/**
 * 规则命中众包（黄推识别的被动信号）。
 *
 * - POST /v1/rule-hits：扩展在用户正常浏览时，本地规则（官方关键词、昵称招揽、内置启发式、
 *   社区指纹/域名）给某个账号打了黄框，就匿名报一条「哪个账号、哪条规则、正文指纹」。
 *   同一会话同一账号同一规则每天只记一次。个人自定义关键词不上报。
 * - 命中**不是票**：规则说它是，很多人刷到就会有很多条命中，这些不是独立判断，
 *   所以命中永远不会单独让一个账号上榜。它只用来：
 *   1. 佐证上榜：已经有 ≥ 2 张人工净票、没有误标票的账号，最近 7 天里某一天被 ≥ 3 个不同网段的
 *      用户的规则命中（或同模板批量号），视为独立佐证，提前上榜；
 *   2. 规则误伤闭环：按规则统计「命中账号数」和「点了误标的账号数」，误伤率高的规则
 *      自动静音（随签名快照下发 muted_rules，扩展不再用它标黄框），维护者可在后台恢复；
 *   3. 分类：命中规则所属的分类（如色情引流）参与名单条目的分类推断；
 *   4. 管理端复核队列按命中热度排序。
 *
 * 独立性：网段哈希带日期、每天换（跨天无法关联），所以「≥ 3 个网段」按**同一天**统计：
 * 一台机器连刷三天也只算 1 个网段。
 *
 * 隐私：不收安装 ID，只收每日轮换的随机会话 ID（加盐哈希）和「IP 网段 + 日期」的加盐哈希前 16 位；
 * 21 天后删除。
 */
import { eq, lt, sql } from 'drizzle-orm';
import { isCategory } from '@feedsieve/shared';
import { getDb, retryOnConflict } from './db/client';
import { installations, meta, rescues, ruleHits } from './db/schema';
import { hashInstallationId, hashIp } from './lib/hash';
import { compareText } from './lib/sql';
import { chargeUsageInOrder } from './lib/usage';
import { utcToday } from './lib/time';
import { hotSalt, ipNet } from './hot';

const DAY_S = 86_400;

export const RULE_HIT_POLICY = {
  maxPerRequest: 100,
  sessionDaily: 2_000,
  /** 按 IP 网段（IPv4 /24、IPv6 /48）计，换 IPv6 地址绕不过去 */
  ipDaily: 20_000,
  /** 全站每天最多收这么多条（防灌库；正常量级远到不了） */
  globalDaily: 500_000,
  /** 误伤统计窗口 14 天 + 余量 */
  retentionDays: 21,
  /** 规则误伤统计窗口 */
  feedbackWindowDays: 14,
  /** 账号佐证窗口 */
  signalWindowDays: 7,
  /** 佐证上榜：至少这么多张人工净票，且没有误标票 */
  corroboratedMinNet: 2,
  /** 佐证上榜：至少这么多个不同网段的命中 */
  corroboratedMinNets: 3,
  /** 同模板批量号：同一指纹至少这么多个账号、这么多个网段 */
  campaignMinAccounts: 3,
  campaignMinNets: 3,
  /** 自动静音：命中账号数下限、误标安装数下限、误伤率上限 */
  muteMinHitAccounts: 30,
  muteMinRescueInstalls: 5,
  muteFpRate: 0.5,
  /** 每轮最多新静音这么多条（防止数据异常一次清空规则） */
  muteMaxPerRun: 5,
  /** 条件要连续满足这么久才真正静音（滞后，防一阵刷票） */
  muteHoldHours: 6,
  /** 误标只算注册满这么多天的安装（新安装刷误标压不倒一条规则） */
  muteRescueMinInstallDays: 7,
  /** 建议上报间隔 */
  uploadIntervalMs: 15 * 60_000,
} as const;

/**
 * 可上报的规则：官方关键词（keyword:official:*）、昵称/提及招揽与同页同模板（keyword:profile:*）、
 * 内置启发式、社区指纹/域名。个人自定义词（keyword:custom:*）带着用户偏好，不收。
 */
const RULE_ID_RE =
  /^(?:keyword:official:[a-z][a-z0-9-]{2,95}|keyword:profile:[a-z][a-z0-9-]{2,40}|weak-signal-combo|fresh-account-combo|contact-number-bait|community-fingerprint|community-fingerprint-sim|community-domain)$/;
const SOURCES = new Set(['heuristic', 'fingerprint', 'domain']);
const HANDLE_RE = /^[a-z0-9_]{1,15}$/;
const DIGITS_RE = /^\d{1,20}$/;
const FINGERPRINT_RE = /^[0-9a-f]{16}$/;

interface RuleHit {
  handle: string;
  ruleId: string;
  source: string;
  category: string | null;
  fingerprint: string | null;
  xUserId: string | null;
  postId: string | null;
}

export function parseRuleHit(raw: unknown): RuleHit | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const handle = typeof r.handle === 'string' ? r.handle.trim().toLowerCase() : '';
  const ruleId = typeof r.rule_id === 'string' ? r.rule_id : '';
  const source = typeof r.source === 'string' ? r.source : '';
  if (!HANDLE_RE.test(handle) || !RULE_ID_RE.test(ruleId) || !SOURCES.has(source)) return null;
  return {
    handle,
    ruleId,
    source,
    category: typeof r.category === 'string' && isCategory(r.category) ? r.category : null,
    fingerprint:
      typeof r.fingerprint === 'string' && FINGERPRINT_RE.test(r.fingerprint)
        ? r.fingerprint
        : null,
    xUserId: typeof r.x_user_id === 'string' && DIGITS_RE.test(r.x_user_id) ? r.x_user_id : null,
    postId: typeof r.post_id === 'string' && DIGITS_RE.test(r.post_id) ? r.post_id : null,
  };
}

function msUntilUtcMidnight(now: number): number {
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  return next.getTime() - now;
}

type IngestResult =
  | { status: 200; body: { accepted: number; rejected: number; next_upload_ms: number } }
  | { status: 400; body: { error: string } }
  | { status: 429; body: { error: string; retry_after_ms: number } };

export async function ingestRuleHits(
  env: Cloudflare.Env,
  raw: unknown,
  ip: string | undefined,
  now = Date.now(),
): Promise<IngestResult> {
  const body = raw as Record<string, unknown> | null;
  if (
    !body ||
    typeof body.session_id !== 'string' ||
    !/^[0-9a-f-]{16,64}$/i.test(body.session_id) ||
    !Array.isArray(body.hits) ||
    body.hits.length < 1 ||
    body.hits.length > RULE_HIT_POLICY.maxPerRequest
  ) {
    return { status: 400, body: { error: 'invalid_rule_hits_request' } };
  }
  const nextUploadMs = RULE_HIT_POLICY.uploadIntervalMs;
  const parsed = body.hits.map(parseRuleHit).filter((hit): hit is RuleHit => hit !== null);
  const rejected = body.hits.length - parsed.length;
  if (parsed.length === 0) {
    return { status: 200, body: { accepted: 0, rejected, next_upload_ms: nextUploadMs } };
  }
  const salt = hotSalt(env);
  const day = utcToday();
  const reporter = await hashInstallationId(salt, `hit:${body.session_id}`);
  const net = ip ? (await hashIp(salt, `net:${day}:${ipNet(ip)}`)).slice(0, 16) : null;
  const limits: Array<[string, number]> = [
    [`hit-session:${reporter}`, RULE_HIT_POLICY.sessionDaily],
  ];
  if (ip) {
    limits.push([`hit-ip:${await hashIp(salt, `net:${ipNet(ip)}`)}`, RULE_HIT_POLICY.ipDaily]);
  }
  limits.push(['hit-global', RULE_HIT_POLICY.globalDaily]);
  const db = getDb(env);
  if (!(await chargeUsageInOrder(db, day, parsed.length, limits))) {
    return {
      status: 429,
      body: { error: 'rate_limited', retry_after_ms: msUntilUtcMidnight(now) },
    };
  }
  // 同一请求里重复的（账号, 规则）折叠成一行；按主键排序，并发写同一批行时锁序一致
  const unique = new Map<string, RuleHit>();
  for (const hit of parsed) unique.set(`${hit.handle}\u0000${hit.ruleId}`, hit);
  const rows = [...unique.values()]
    .sort((a, b) => compareText(a.handle, b.handle) || compareText(a.ruleId, b.ruleId))
    .map((hit) => ({
      handle: hit.handle,
      ruleId: hit.ruleId,
      day,
      reporter,
      net,
      source: hit.source,
      category: hit.category,
      fingerprint: hit.fingerprint,
      xUserId: hit.xUserId,
      postId: hit.postId,
      createdAt: Math.floor(now / 1000),
    }));
  await retryOnConflict(() => db.insert(ruleHits).values(rows).onConflictDoNothing());
  return { status: 200, body: { accepted: parsed.length, rejected, next_upload_ms: nextUploadMs } };
}

function dayStamp(nowMs: number, daysAgo: number): string {
  return new Date(nowMs - daysAgo * DAY_S * 1000).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// 规则误伤闭环
// ---------------------------------------------------------------------------

export interface RuleFeedback {
  rule_id: string;
  /** 窗口内被这条规则打黄框的不同账号数 */
  hit_accounts: number;
  /** 窗口内上报命中的不同网段数 */
  hit_nets: number;
  /** 窗口内因这条规则被点「误标」的不同账号数 */
  rescue_accounts: number;
  /** 点「误标」的不同安装数 */
  rescue_installs: number;
  /** 误伤率 = 误标账号 ÷ 命中账号（命中为 0 时为 null） */
  fp_rate: number | null;
  /** muted = 已静音，exempt = 维护者恢复过、不再自动静音 */
  state: 'active' | 'muted' | 'exempt';
  muted_at?: number;
}

export interface RuleMuteRecord {
  state: 'muted' | 'exempt';
  /** Unix 秒 */
  at: number;
  /** auto = 误伤率触发；admin = 维护者手动 */
  by: 'auto' | 'admin';
  hit_accounts?: number;
  rescue_accounts?: number;
}

export const RULE_MUTES_KEY = 'rule_mutes';

export async function readRuleMutes(env: Cloudflare.Env): Promise<Record<string, RuleMuteRecord>> {
  const [row] = await getDb(env)
    .select({ value: meta.value })
    .from(meta)
    .where(eq(meta.key, RULE_MUTES_KEY));
  if (!row) return {};
  try {
    const parsed = JSON.parse(row.value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, RuleMuteRecord>)
      : {};
  } catch {
    return {};
  }
}

async function writeRuleMutes(
  env: Cloudflare.Env,
  mutes: Record<string, RuleMuteRecord>,
): Promise<void> {
  const value = JSON.stringify(mutes);
  await getDb(env)
    .insert(meta)
    .values({ key: RULE_MUTES_KEY, value })
    .onConflictDoUpdate({ target: meta.key, set: { value } });
}

/** 当前静音的规则 ID（快照 muted_rules 段），按字节序排好。 */
export function mutedRuleIds(mutes: Record<string, RuleMuteRecord>): string[] {
  return Object.entries(mutes)
    .filter(([, record]) => record.state === 'muted')
    .map(([ruleId]) => ruleId)
    .sort(compareText);
}

export async function loadRuleFeedback(
  env: Cloudflare.Env,
  now = Date.now(),
): Promise<RuleFeedback[]> {
  const db = getDb(env);
  const sinceDay = dayStamp(now, RULE_HIT_POLICY.feedbackWindowDays);
  const nowSec = Math.floor(now / 1000);
  const sinceSec = nowSec - RULE_HIT_POLICY.feedbackWindowDays * DAY_S;
  const matureBefore = nowSec - RULE_HIT_POLICY.muteRescueMinInstallDays * DAY_S;
  const [hitRows, rescueRows, mutes] = await Promise.all([
    // 网段哈希每天换：「几个网段」取窗口内最多的那一天
    db.execute<{ rule_id: string; accounts: number; nets: number }>(sql`
      WITH per_day AS (
        SELECT rule_id, day, count(DISTINCT coalesce(net, 'r:' || reporter)) AS n
        FROM ${ruleHits}
        WHERE day >= ${sinceDay}
        GROUP BY rule_id, day
      ), accounts AS (
        SELECT rule_id, count(DISTINCT handle) AS a
        FROM ${ruleHits}
        WHERE day >= ${sinceDay}
        GROUP BY rule_id
      )
      SELECT p.rule_id, max(a.a)::int AS accounts, max(p.n)::int AS nets
      FROM per_day p JOIN accounts a ON a.rule_id = p.rule_id
      GROUP BY p.rule_id`),
    // 误标只算：同一规则在窗口内确实上报过命中的账号（不能自报一个没命中过的规则来刷），
    // 并且来自注册满 7 天的安装
    db.execute<{ rule_id: string; accounts: number; installs: number }>(sql`
      SELECT r.rule_id, count(DISTINCT r.handle)::int AS accounts,
             count(DISTINCT r.installation_id)::int AS installs
      FROM ${rescues} r
      JOIN ${installations} i ON i.id = r.installation_id
      WHERE r.created_at >= ${sinceSec}
        AND r.rule_id IS NOT NULL
        AND i.first_seen_at <= ${matureBefore}
        AND EXISTS (
          SELECT 1 FROM ${ruleHits} h
          WHERE h.handle = r.handle AND h.rule_id = r.rule_id AND h.day >= ${sinceDay}
        )
      GROUP BY r.rule_id`),
    readRuleMutes(env),
  ]);
  const byRule = new Map<string, RuleFeedback>();
  const row = (ruleId: string): RuleFeedback => {
    let item = byRule.get(ruleId);
    if (!item) {
      const mute = mutes[ruleId];
      item = {
        rule_id: ruleId,
        hit_accounts: 0,
        hit_nets: 0,
        rescue_accounts: 0,
        rescue_installs: 0,
        fp_rate: null,
        state: mute?.state ?? 'active',
        ...(mute ? { muted_at: mute.at } : {}),
      };
      byRule.set(ruleId, item);
    }
    return item;
  };
  for (const hit of hitRows) {
    const item = row(hit.rule_id);
    item.hit_accounts = Number(hit.accounts);
    item.hit_nets = Number(hit.nets);
  }
  for (const rescue of rescueRows) {
    if (!RULE_ID_RE.test(rescue.rule_id)) continue;
    const item = row(rescue.rule_id);
    item.rescue_accounts = Number(rescue.accounts);
    item.rescue_installs = Number(rescue.installs);
  }
  for (const [ruleId] of Object.entries(mutes)) row(ruleId);
  for (const item of byRule.values()) {
    item.fp_rate =
      item.hit_accounts > 0
        ? Math.round(Math.min(1, item.rescue_accounts / item.hit_accounts) * 1000) / 1000
        : null;
  }
  return [...byRule.values()].sort(
    (a, b) =>
      (b.fp_rate ?? -1) - (a.fp_rate ?? -1) ||
      b.hit_accounts - a.hit_accounts ||
      compareText(a.rule_id, b.rule_id),
  );
}

/** 这条规则该不该自动静音（纯函数）。 */
export function shouldAutoMute(item: RuleFeedback): boolean {
  return (
    item.state === 'active' &&
    item.hit_accounts >= RULE_HIT_POLICY.muteMinHitAccounts &&
    item.rescue_installs >= RULE_HIT_POLICY.muteMinRescueInstalls &&
    item.fp_rate !== null &&
    item.fp_rate >= RULE_HIT_POLICY.muteFpRate
  );
}

const RULE_MUTE_PENDING_KEY = 'rule_mute_pending';

/**
 * cron：误伤率超线的规则自动静音。条件要连续满足 muteHoldHours 小时才真正静音（第一次满足先记下），
 * 每轮最多 muteMaxPerRun 条；维护者恢复过的（exempt）不再自动静音。静音随下一版快照下发。
 * 返回本轮新静音的规则。
 */
export async function autoMuteNoisyRules(env: Cloudflare.Env, now = Date.now()): Promise<string[]> {
  const db = getDb(env);
  const feedback = await loadRuleFeedback(env, now);
  const qualifying = feedback.filter(shouldAutoMute);
  const [row] = await db
    .select({ value: meta.value })
    .from(meta)
    .where(eq(meta.key, RULE_MUTE_PENDING_KEY));
  const pending = ((): Record<string, number> => {
    try {
      return row ? (JSON.parse(row.value) as Record<string, number>) : {};
    } catch {
      return {};
    }
  })();
  const at = Math.floor(now / 1000);
  const nextPending: Record<string, number> = {};
  const ready: RuleFeedback[] = [];
  for (const item of qualifying) {
    const since = typeof pending[item.rule_id] === 'number' ? pending[item.rule_id]! : at;
    nextPending[item.rule_id] = since;
    if (at - since >= RULE_HIT_POLICY.muteHoldHours * 3600) ready.push(item);
  }
  const targets = ready.slice(0, RULE_HIT_POLICY.muteMaxPerRun);
  for (const item of targets) delete nextPending[item.rule_id];
  const pendingValue = JSON.stringify(nextPending);
  await db
    .insert(meta)
    .values({ key: RULE_MUTE_PENDING_KEY, value: pendingValue })
    .onConflictDoUpdate({ target: meta.key, set: { value: pendingValue } });
  if (targets.length === 0) return [];
  const mutes = await readRuleMutes(env);
  for (const item of targets) {
    mutes[item.rule_id] = {
      state: 'muted',
      at,
      by: 'auto',
      hit_accounts: item.hit_accounts,
      rescue_accounts: item.rescue_accounts,
    };
  }
  await writeRuleMutes(env, mutes);
  return targets.map((item) => item.rule_id);
}

/** 管理端：手动静音 / 恢复一条规则。恢复后标记 exempt，自动静音不再碰它。 */
export async function setRuleMute(
  env: Cloudflare.Env,
  ruleId: string,
  muted: boolean,
  now = Date.now(),
): Promise<boolean> {
  if (!RULE_ID_RE.test(ruleId)) return false;
  const mutes = await readRuleMutes(env);
  mutes[ruleId] = { state: muted ? 'muted' : 'exempt', at: Math.floor(now / 1000), by: 'admin' };
  await writeRuleMutes(env, mutes);
  return true;
}

// ---------------------------------------------------------------------------
// 账号级信号（佐证上榜 / 分类 / 复核队列）
// ---------------------------------------------------------------------------

export interface HitSignal {
  /** 最近 7 天上报命中的不同网段数（已静音的规则不算） */
  nets: number;
  /** 命中的不同规则数 */
  rules: number;
  /** 分类 → 命中网段数 */
  categories: Map<string, number>;
  /** 同模板批量号：和 ≥ 2 个别的账号共用同一正文指纹，且来自 ≥ 3 个网段 */
  campaign: boolean;
}

export async function loadHitSignals(
  env: Cloudflare.Env,
  now = Date.now(),
  muted: ReadonlySet<string> = new Set(),
): Promise<Map<string, HitSignal>> {
  const db = getDb(env);
  const sinceDay = dayStamp(now, RULE_HIT_POLICY.signalWindowDays);
  const mutedList = [...muted];
  const notMuted =
    mutedList.length > 0
      ? sql`rule_id NOT IN (${sql.join(
          mutedList.map((id) => sql`${id}`),
          sql`, `,
        )})`
      : sql`true`;
  // 网段哈希每天换：「几个网段」按同一天数，取窗口内最多的那一天
  const [accountRows, categoryRows, campaignRows] = await Promise.all([
    db.execute<{ handle: string; nets: number; rules: number }>(sql`
      WITH per_day AS (
        SELECT handle, day, count(DISTINCT coalesce(net, 'r:' || reporter)) AS n
        FROM ${ruleHits}
        WHERE day >= ${sinceDay} AND ${notMuted}
        GROUP BY handle, day
      ), rules AS (
        SELECT handle, count(DISTINCT rule_id) AS r
        FROM ${ruleHits}
        WHERE day >= ${sinceDay} AND ${notMuted}
        GROUP BY handle
      )
      SELECT p.handle, max(p.n)::int AS nets, max(r.r)::int AS rules
      FROM per_day p JOIN rules r ON r.handle = p.handle
      GROUP BY p.handle
      HAVING max(p.n) >= 2`),
    db.execute<{ handle: string; category: string; nets: number }>(sql`
      SELECT handle, category, max(n)::int AS nets
      FROM (
        SELECT handle, category, day, count(DISTINCT coalesce(net, 'r:' || reporter)) AS n
        FROM ${ruleHits}
        WHERE day >= ${sinceDay} AND category IS NOT NULL AND ${notMuted}
        GROUP BY handle, category, day
      ) t
      GROUP BY handle, category`),
    // 同模板批量号：同一天里同一正文指纹 ≥ 3 个账号、来自 ≥ 3 个网段
    db.execute<{ handle: string }>(sql`
      SELECT DISTINCT h.handle
      FROM ${ruleHits} h
      JOIN (
        SELECT fingerprint, day
        FROM ${ruleHits}
        WHERE day >= ${sinceDay} AND fingerprint IS NOT NULL AND ${notMuted}
        GROUP BY fingerprint, day
        HAVING count(DISTINCT handle) >= ${RULE_HIT_POLICY.campaignMinAccounts}
           AND count(DISTINCT coalesce(net, 'r:' || reporter)) >= ${RULE_HIT_POLICY.campaignMinNets}
      ) f ON f.fingerprint = h.fingerprint AND f.day = h.day
      WHERE h.day >= ${sinceDay}`),
  ]);
  const signals = new Map<string, HitSignal>();
  const signal = (handle: string): HitSignal => {
    let item = signals.get(handle);
    if (!item) {
      item = { nets: 0, rules: 0, categories: new Map(), campaign: false };
      signals.set(handle, item);
    }
    return item;
  };
  for (const row of accountRows) {
    const item = signal(row.handle);
    item.nets = Number(row.nets);
    item.rules = Number(row.rules);
  }
  for (const row of categoryRows) {
    if (Number(row.nets) < 2) continue;
    signal(row.handle).categories.set(row.category, Number(row.nets));
  }
  for (const row of campaignRows) signal(row.handle).campaign = true;
  return signals;
}

/** 佐证上榜（纯函数）：人工净票 ≥ 2、没有误标票，且被 ≥ 3 个网段的规则命中或属于同模板批量号。 */
export function isCorroborated(
  account: { report_count: number; rescue_count: number },
  signal: HitSignal | undefined,
): boolean {
  if (!signal) return false;
  if (account.rescue_count > 0) return false;
  if (account.report_count - account.rescue_count < RULE_HIT_POLICY.corroboratedMinNet)
    return false;
  return signal.nets >= RULE_HIT_POLICY.corroboratedMinNets || signal.campaign;
}

/** 命中最多的分类（≥ 2 个网段才算），并列按分类名字节序。 */
export function topHitCategory(signal: HitSignal | undefined): string | null {
  if (!signal) return null;
  const top = [...signal.categories.entries()].sort(
    (a, b) => b[1] - a[1] || compareText(a[0], b[0]),
  )[0];
  return top ? top[0] : null;
}

/** cron：删掉 21 天前的命中。 */
export async function cleanupRuleHits(env: Cloudflare.Env, now = Date.now()): Promise<void> {
  await getDb(env)
    .delete(ruleHits)
    .where(lt(ruleHits.day, dayStamp(now, RULE_HIT_POLICY.retentionDays)));
}
