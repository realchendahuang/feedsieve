/**
 * 打野排位赛客户端：榜单状态查询与榜单页跳转。
 *
 * 身份 = 本机安装 ID（服务端只见加盐哈希，见 contribute.ts）。查询走
 * POST body，ID 不进 URL；榜单页跳转一律去官网 /lists/ranked。
 */

import { API_BASE } from '../platform/api-base';
import { openOfficialPage, SITE_URLS } from '../platform/site-links';
import { getInstallationId, peekInstallationId } from './contribute';

// 弹窗每次打开都是新页面，内存缓存无效：缓存落 storage.local，跨打开复用。
// TTL 与服务端榜单新鲜容忍（90s）同量级；网络失败回退陈旧数据而不是空态。
interface CacheEntry<T> {
  /** 归属安装 ID：换装/重置不串数据 */
  installationId: string | null;
  ts: number;
  data: T;
}

const BOARD_CACHE_KEY = 'hunterBoardCache';
const PROFILE_CACHE_KEY = 'hunterProfileCache';
const BOARD_TTL_MS = 60_000;
const PROFILE_TTL_MS = 120_000;

async function readHunterCache<T>(key: string, installationId: string | null, ttl: number): Promise<CacheEntry<T> | null> {
  try {
    const stored = await browser.storage.local.get(key);
    const entry = stored[key] as CacheEntry<T> | undefined;
    if (!entry || Date.now() - entry.ts > ttl) return null;
    if (entry.installationId && installationId && entry.installationId !== installationId) return null;
    return entry;
  } catch {
    return null;
  }
}

async function writeHunterCache<T>(key: string, installationId: string | null, data: T): Promise<void> {
  try {
    await browser.storage.local.set({ [key]: { installationId, ts: Date.now(), data } });
  } catch {
    // 存储失败只是丢缓存，不打扰
  }
}

/** 档案变化（绑定/验证/保存）后主动失效；不变化时走 TTL。 */
export async function invalidateHunterCaches(): Promise<void> {
  try {
    await browser.storage.local.remove([BOARD_CACHE_KEY, PROFILE_CACHE_KEY]);
  } catch {
    // 忽略存储失败
  }
}

export interface HunterStatus {
  /** me 高亮前缀（加盐哈希前 12 位 hex）；未上榜（还没开火）为 null */
  mePrefix: string | null;
  /** 本赛季当前排名（1 起）；未上榜为 null */
  rank: number | null;
  /** 本赛季确认击杀数 */
  kills: number | null;
  /** 本赛季累计分数 */
  score: number | null;
  /** 称号阶梯头衔（按累计击杀）；从未开火为 null */
  tier: string | null;
  /** 榜上总人数（百分位换算用） */
  total: number;
}

interface LeaderboardResponse {
  rows: HunterBoardRow[];
  total: number;
  me: HunterBoardRow | null;
}

export interface HunterBoardRow {
  id: string;
  name: string;
  bio: string | null;
  title: string | null;
  tier: string | null;
  x_handle: string | null;
  kills: number;
  score: number;
  accuracy: number;
  rank?: number;
}

export interface HunterBoard {
  rows: HunterBoardRow[];
  total: number;
  me: HunterBoardRow | null;
}

/** 榜单速览（name/Top榜 + 我 + 总人数）。新鲜走缓存；失败回退陈旧缓存兜底空态。 */
export async function fetchHunterBoard(): Promise<HunterBoard | null> {
  const installationId = await peekInstallationId();
  const fresh = await readHunterCache<HunterBoard>(BOARD_CACHE_KEY, installationId, BOARD_TTL_MS);
  if (fresh) return fresh.data;
  try {
    const res = await fetch(`${API_BASE}/v1/leaderboard`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(installationId ? { installation_id: installationId } : {}),
    });
    if (!res.ok) {
      const stale = await readHunterCache<HunterBoard>(BOARD_CACHE_KEY, installationId, Number.MAX_SAFE_INTEGER);
      return stale?.data ?? null;
    }
    const data = (await res.json()) as LeaderboardResponse;
    // 不再截 10 条：榜单区自带滚动，弹窗里能看多少滚多少；数据量由服务端控
    const board: HunterBoard = { rows: data.rows, total: data.total ?? 0, me: data.me };
    await writeHunterCache(BOARD_CACHE_KEY, installationId, board);
    return board;
  } catch {
    // 陈旧也去而没有一点数据的网络/服务端故障 → 陈旧兜底
    const stale = await readHunterCache<HunterBoard>(BOARD_CACHE_KEY, installationId, Number.MAX_SAFE_INTEGER);
    return stale?.data ?? null;
  }
}

/**
 * 打野榜完整页：官网 /lists/ranked（旧 API 观看页已下线）。
 */
export function leaderboardUrl(): string {
  return SITE_URLS.ranked;
}

/** 榜单状态（战报卡片订阅；失败静默为空态，不打扰）。 */
export async function fetchHunterStatus(): Promise<HunterStatus> {
  const board = await fetchHunterBoard();
  if (!board?.me) {
    return { mePrefix: null, rank: null, kills: null, score: null, tier: null, total: 0 };
  }
  return {
    mePrefix: board.me.id,
    rank: board.me.rank ?? null,
    kills: board.me.kills,
    score: board.me.score,
    tier: board.me.tier ?? null,
    total: board.total,
  };
}

export async function openLeaderboard(): Promise<void> {
  await openOfficialPage(SITE_URLS.ranked);
}

export interface HunterProfileState {
  display_name: string | null;
  bio: string | null;
  x_handle: string | null;
  title: string | null;
  email_verified: boolean;
}

/** 当前猎手档案（设置区展示）。失败回退陈旧缓存；无缓存且无安装时 null。 */
export async function fetchHunterProfile(): Promise<HunterProfileState | null> {
  const installationId = await peekInstallationId();
  if (!installationId) return null;
  const fresh = await readHunterCache<HunterProfileState>(PROFILE_CACHE_KEY, installationId, PROFILE_TTL_MS);
  if (fresh) return fresh.data;
  try {
    const res = await fetch(`${API_BASE}/v1/player/me`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ installation_id: installationId }),
    });
    if (!res.ok) {
      const stale = await readHunterCache<HunterProfileState>(PROFILE_CACHE_KEY, installationId, Number.MAX_SAFE_INTEGER);
      return stale?.data ?? null;
    }
    const value = (await res.json()) as HunterProfileState;
    await writeHunterCache(PROFILE_CACHE_KEY, installationId, value);
    return value;
  } catch {
    const stale = await readHunterCache<HunterProfileState>(PROFILE_CACHE_KEY, installationId, Number.MAX_SAFE_INTEGER);
    return stale?.data ?? null;
  }
}

/** 发验证码结果：失败时带上服务端 error code（弹窗按 code 分文案）。 */
export type HunterBindResult =
  | { ok: true; sent: boolean; dev_code?: string }
  | { ok: false; error: string };

/** 发验证码（安装 ID 在此刻惰性生成——想露脸才建档）。 */
export async function bindHunterEmail(email: string): Promise<HunterBindResult> {
  const installationId = await getInstallationId();
  try {
    const res = await fetch(`${API_BASE}/v1/player/bind-email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ installation_id: installationId, email }),
    });
    if (!res.ok) return { ok: false, error: await res.json().then((v) => v?.error ?? '').catch(() => '') };
    const value = (await res.json()) as { sent: boolean; dev_code?: string };
    await invalidateHunterCaches();
    return { ok: true, sent: value.sent, dev_code: value.dev_code };
  } catch {
    return { ok: false, error: 'network_error' };
  }
}

export async function verifyHunterEmail(
  email: string,
  code: string,
): Promise<{ ok: boolean; error?: string }> {
  const installationId = await getInstallationId();
  try {
    const res = await fetch(`${API_BASE}/v1/player/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ installation_id: installationId, email, code }),
    });
    if (res.ok) {
      await invalidateHunterCaches();
      return { ok: true };
    }
    return { ok: false, error: await res.json().then((v) => v?.error ?? '').catch(() => 'network_error') };
  } catch {
    return { ok: false, error: 'network_error' };
  }
}

export async function saveHunterProfile(
  displayName: string,
  bio: string,
  xHandle: string = '',
): Promise<{ ok: boolean; invalid?: boolean }> {
  // 与绑定邮箱同口径：此刻才惰性建档——想露脸（哪怕只是写好简介等绑定）即建档
  const installationId = await getInstallationId();
  if (!installationId) return { ok: false };
  try {
    const res = await fetch(`${API_BASE}/v1/player/profile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        installation_id: installationId,
        display_name: displayName,
        bio,
        x_handle: xHandle,
      }),
    });
    if (res.status === 400) return { ok: false, invalid: true };
    const ok = res.ok;
    if (ok) await invalidateHunterCaches();
    return { ok };
  } catch {
    return { ok: false };
  }
}
