/**
 * AI 味检测的后台端：转发判定 / 投票 / 查询到福滤娃服务器，同步社区 AI 号名单，
 * 并在本机记下查过谁、自己测出的结果和投过的票。
 *
 * 判定模型的 key 只在服务端，扩展只和自己的服务器说话；换模型供应商不需要发版。
 * 判定只在用户点了「检测」之后才发请求；「仅本地运行」时什么都不发。
 *
 * 一个人测出来的结论服务端不公开（证据可以伪造），只有本人能看：所以本机要存一份完整结果，
 * 关掉检测卡以后还能从主页 Tab、评论区标记、面板回来看、继续投票。
 */
import { COMMUNITY_API_BASE, getCommunitySettings } from '../community/community-store';
import { getInstallationId } from '../community/contribute';
import type { AiVerdict } from '@feedsieve/shared';
import type { ReplyEvidence } from './evidence';

export const AI_JUDGE_MESSAGE = 'feedsieve:ai-judge';
export const AI_VOTE_MESSAGE = 'feedsieve:ai-vote';
export const AI_LOOKUP_MESSAGE = 'feedsieve:ai-lookup';
export const AI_OUTCOME_MESSAGE = 'feedsieve:ai-outcome';
export const AI_LIST_SYNC_MESSAGE = 'feedsieve:ai-list-sync';
export const AI_RECORDS_KEY = 'aiChecksV1';
export const AI_LIST_KEY = 'aiListV1';
export const AI_SETTINGS_KEY = 'aiCheckSettingsV1';
/** 社区 AI 号名单多久同步一次（服务端边缘缓存 10 分钟，名单变化慢） */
const LIST_SYNC_MS = 30 * 60 * 1000;

export interface AiRhythm {
  fast: number;
  short: number;
  cv: number;
  median_gap?: number | null;
  span?: number | null;
  authors?: number | null;
  rounds?: number;
}

export interface AiJudgeValue {
  handle: string;
  verdict: AiVerdict;
  score: number | null;
  reply_count: number;
  judged_at: number;
  expires_at: number;
  confirmed?: boolean;
  rhythm?: AiRhythm | null;
  cached: boolean;
}

export type AiJudgeOutcome =
  | { ok: true; value: AiJudgeValue }
  | {
      ok: false;
      error: 'local_only' | 'insufficient' | 'rate_limited' | 'unavailable' | 'network';
    };

export interface AiTally {
  handle: string;
  ai_count: number;
  human_count: number;
  listed: boolean;
}

/** GET /v1/ai-accounts/:handle 的返回：可公开的结论 + 社区票数（不花 token）。 */
export interface AiLookupValue {
  handle: string;
  verdict: AiVerdict | null;
  score: number | null;
  reply_count: number;
  rhythm: AiRhythm | null;
  judged_at: number | null;
  expires_at: number | null;
  expired: boolean;
  public?: boolean;
  pending?: boolean;
  contested?: boolean;
  /** 旧字段，保留兼容 */
  under_review?: boolean;
  reviewed?: boolean;
  votes: { ai_count: number; human_count: number; listed: boolean };
}

/** 本机记录：自己测过的结果（含未公开的）和投过的票。 */
export interface AiCheckRecord {
  handle: string;
  verdict: AiVerdict;
  score: number | null;
  /** 毫秒：本机记录时间 */
  judgedAt: number;
  /** 秒：服务端结论过期时间 */
  expiresAt?: number;
  replyCount?: number;
  rhythm?: AiRhythm | null;
  /** 服务端是否已公开（被第二个人印证） */
  confirmed?: boolean;
  vote?: 'ai' | 'human';
}

export interface AiLookupOutcome {
  remote: AiLookupValue | null;
  myVote: 'ai' | 'human' | null;
  /** 自己测过、服务端还没公开时用这份 */
  mine: AiCheckRecord | null;
}

export type AiVoteOutcome = { ok: true; tally: AiTally } | { ok: false; error: string };

/** 名单条目：[handle, AI 味分数（社区投票入名单而没有判定时为 null）, 是否进了社区名单 0/1] */
export type AiListEntry = [string, number | null, 0 | 1];

export interface AiListState {
  at: number;
  etag?: string;
  entries: AiListEntry[];
}

/** 评论区里遇到 AI 号怎么处理；识别范围（蓝V 取页面上的认证标记） */
export interface AiCheckSettings {
  mode: 'off' | 'mark' | 'fold';
  scope: 'all' | 'blue' | 'skipBlue';
  /** 已关注的账号也自动打标（默认关：避免把结论贴到你关注的人身上） */
  markFollowing: boolean;
}

export const DEFAULT_AI_SETTINGS: AiCheckSettings = {
  mode: 'mark',
  scope: 'all',
  markFollowing: false,
};

export function normalizeAiSettings(raw: unknown): AiCheckSettings {
  const value = (raw ?? {}) as Partial<AiCheckSettings>;
  return {
    mode: value.mode === 'off' || value.mode === 'fold' ? value.mode : 'mark',
    scope: value.scope === 'blue' || value.scope === 'skipBlue' ? value.scope : 'all',
    markFollowing: value.markFollowing === true,
  };
}

export async function getAiSettings(): Promise<AiCheckSettings> {
  return normalizeAiSettings((await browser.storage.local.get(AI_SETTINGS_KEY))[AI_SETTINGS_KEY]);
}

export async function setAiSettings(patch: Partial<AiCheckSettings>): Promise<AiCheckSettings> {
  const next = normalizeAiSettings({ ...(await getAiSettings()), ...patch });
  await browser.storage.local.set({ [AI_SETTINGS_KEY]: next });
  return next;
}

type Fetch = typeof fetch;

async function readRecords(): Promise<Record<string, AiCheckRecord>> {
  const raw = (await browser.storage.local.get(AI_RECORDS_KEY))[AI_RECORDS_KEY];
  return raw && typeof raw === 'object' ? (raw as Record<string, AiCheckRecord>) : {};
}

async function writeRecord(handle: string, patch: Partial<AiCheckRecord>): Promise<void> {
  const key = handle.toLowerCase();
  const records = await readRecords();
  const prev = records[key];
  records[key] = {
    ...(prev ?? { handle: key, verdict: 'insufficient', score: null, judgedAt: 0 }),
    ...patch,
    handle: key,
  };
  await browser.storage.local.set({ [AI_RECORDS_KEY]: records });
}

export async function listAiChecks(): Promise<AiCheckRecord[]> {
  return Object.values(await readRecords()).sort((a, b) => b.judgedAt - a.judgedAt);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface AiJudgeRequest {
  handle: string;
  replies: ReplyEvidence[];
  gaps: number[];
  authorCount?: number | null;
  displayName?: string | null;
  avatarUrl?: string | null;
}

export async function judgeAiAccount(
  request: AiJudgeRequest,
  fetchImpl: Fetch = fetch,
): Promise<AiJudgeOutcome> {
  if (!(await getCommunitySettings()).autoContribute) return { ok: false, error: 'local_only' };
  const installationId = await getInstallationId();
  const body = JSON.stringify({
    installation_id: installationId,
    handle: request.handle,
    replies: request.replies,
    gaps: request.gaps,
    ...(request.authorCount != null ? { author_count: request.authorCount } : {}),
    ...(request.displayName ? { display_name: request.displayName } : {}),
    ...(request.avatarUrl ? { avatar_url: request.avatarUrl } : {}),
  });
  // 202 = 别人正在判同一个账号：等一下再问，结果会落进共享缓存
  for (let attempt = 0; attempt < 6; attempt++) {
    let response: Response;
    try {
      response = await fetchImpl(`${COMMUNITY_API_BASE}/v1/ai-accounts/judge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        credentials: 'omit',
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      return { ok: false, error: 'network' };
    }
    const json = (await response.json().catch(() => null)) as
      (AiJudgeValue & { error?: string; verdict?: string }) | null;
    if (response.status === 202) {
      await sleep(3_000);
      continue;
    }
    if (response.ok && json && typeof json.verdict === 'string') {
      await writeRecord(json.handle, {
        verdict: json.verdict,
        score: json.score,
        judgedAt: Date.now(),
        expiresAt: json.expires_at,
        replyCount: json.reply_count,
        rhythm: json.rhythm ?? null,
        confirmed: json.confirmed === true,
      });
      return { ok: true, value: json };
    }
    if (json?.error === 'insufficient_replies') return { ok: false, error: 'insufficient' };
    if (response.status === 429) return { ok: false, error: 'rate_limited' };
    return { ok: false, error: 'unavailable' };
  }
  return { ok: false, error: 'unavailable' };
}

export async function voteAiAccount(
  handle: string,
  vote: 'ai' | 'human',
  fetchImpl: Fetch = fetch,
): Promise<AiVoteOutcome> {
  if (!(await getCommunitySettings()).autoContribute) return { ok: false, error: 'local_only' };
  const installationId = await getInstallationId();
  try {
    const response = await fetchImpl(`${COMMUNITY_API_BASE}/v1/ai-accounts/vote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ installation_id: installationId, handle, vote }),
      credentials: 'omit',
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await response.json().catch(() => null)) as (AiTally & { error?: string }) | null;
    if (!response.ok || !json || typeof json.ai_count !== 'number') {
      return { ok: false, error: json?.error ?? 'unavailable' };
    }
    const records = await readRecords();
    await writeRecord(handle, {
      vote,
      // 只投了票、没测过：也记一行，面板「我测过的」里能看到、能改票
      ...(records[handle.toLowerCase()] ? {} : { judgedAt: Date.now() }),
    });
    return { ok: true, tally: json };
  } catch {
    return { ok: false, error: 'network' };
  }
}

export async function lookupAiAccount(
  handle: string,
  fetchImpl: Fetch = fetch,
): Promise<AiLookupOutcome> {
  const key = handle.toLowerCase();
  const record = (await readRecords())[key] ?? null;
  const myVote = record?.vote ?? null;
  const mine = record && record.score !== null && record.verdict !== 'insufficient' ? record : null;
  if (!(await getCommunitySettings()).autoContribute) return { remote: null, myVote, mine };
  try {
    const response = await fetchImpl(
      `${COMMUNITY_API_BASE}/v1/ai-accounts/${encodeURIComponent(key)}`,
      { credentials: 'omit', signal: AbortSignal.timeout(10_000) },
    );
    const json = (await response.json().catch(() => null)) as AiLookupValue | null;
    return { remote: response.ok && json && 'verdict' in json ? json : null, myVote, mine };
  } catch {
    return { remote: null, myVote, mine };
  }
}

/** 扩展端检测失败的次数（只有类型，没有账号）：发现 X 改版导致取样失效用。 */
export async function reportOutcome(outcome: string, fetchImpl: Fetch = fetch): Promise<void> {
  if (!(await getCommunitySettings()).autoContribute) return;
  await fetchImpl(`${COMMUNITY_API_BASE}/v1/ai-accounts/outcome`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ outcome }),
    credentials: 'omit',
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);
}

/** 社区 AI 号名单：30 分钟内同步过就跳过；用 ETag，没变化时不重新下载。 */
export async function syncAiList(
  force = false,
  fetchImpl: Fetch = fetch,
): Promise<AiListState | null> {
  const stored = (await browser.storage.local.get(AI_LIST_KEY))[AI_LIST_KEY] as
    AiListState | undefined;
  if (!force && stored && Date.now() - stored.at < LIST_SYNC_MS) return stored;
  if (!(await getCommunitySettings()).autoContribute) return stored ?? null;
  try {
    const response = await fetchImpl(`${COMMUNITY_API_BASE}/v1/ai-accounts/list`, {
      credentials: 'omit',
      headers: stored?.etag ? { 'if-none-match': stored.etag } : {},
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 304 && stored) {
      const next = { ...stored, at: Date.now() };
      await browser.storage.local.set({ [AI_LIST_KEY]: next });
      return next;
    }
    const json = (await response.json().catch(() => null)) as { entries?: unknown } | null;
    if (!response.ok || !json || !Array.isArray(json.entries)) return stored ?? null;
    const entries = (json.entries as unknown[]).filter(
      (e): e is AiListEntry =>
        Array.isArray(e) &&
        typeof e[0] === 'string' &&
        /^[a-z0-9_]{1,15}$/.test(e[0]) &&
        (e[1] === null || (typeof e[1] === 'number' && e[1] >= 0 && e[1] <= 1)) &&
        (e[2] === 0 || e[2] === 1),
    );
    const next: AiListState = {
      at: Date.now(),
      ...(response.headers.get('etag') ? { etag: response.headers.get('etag')! } : {}),
      entries,
    };
    await browser.storage.local.set({ [AI_LIST_KEY]: next });
    return next;
  } catch {
    return stored ?? null;
  }
}

/** 后台消息入口：返回 undefined 表示不是 AI 味检测的消息。 */
export function handleAiCheckMessage(message: unknown): Promise<unknown> | undefined {
  const msg = message as {
    type?: string;
    handle?: unknown;
    replies?: unknown;
    gaps?: unknown;
    authorCount?: unknown;
    displayName?: unknown;
    avatarUrl?: unknown;
    vote?: unknown;
    outcome?: unknown;
    force?: unknown;
  } | null;
  if (msg?.type === AI_JUDGE_MESSAGE) {
    if (typeof msg.handle !== 'string' || !Array.isArray(msg.replies)) return Promise.resolve(null);
    return judgeAiAccount({
      handle: msg.handle,
      replies: msg.replies as ReplyEvidence[],
      gaps: Array.isArray(msg.gaps) ? (msg.gaps as number[]) : [],
      authorCount: typeof msg.authorCount === 'number' ? msg.authorCount : null,
      displayName: typeof msg.displayName === 'string' ? msg.displayName : null,
      avatarUrl: typeof msg.avatarUrl === 'string' ? msg.avatarUrl : null,
    });
  }
  if (msg?.type === AI_VOTE_MESSAGE) {
    if (typeof msg.handle !== 'string' || (msg.vote !== 'ai' && msg.vote !== 'human')) {
      return Promise.resolve(null);
    }
    return voteAiAccount(msg.handle, msg.vote);
  }
  if (msg?.type === AI_LOOKUP_MESSAGE) {
    if (typeof msg.handle !== 'string') return Promise.resolve(null);
    return lookupAiAccount(msg.handle);
  }
  if (msg?.type === AI_OUTCOME_MESSAGE) {
    if (typeof msg.outcome !== 'string') return Promise.resolve(null);
    return reportOutcome(msg.outcome).then(() => ({ ok: true }));
  }
  if (msg?.type === AI_LIST_SYNC_MESSAGE) {
    return syncAiList(msg.force === true).then((state) => ({ count: state?.entries.length ?? 0 }));
  }
  if (msg?.type === 'feedsieve:ai-checks') return listAiChecks();
  return undefined;
}
