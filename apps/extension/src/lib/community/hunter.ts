/**
 * 打野排位赛客户端：榜单状态查询与榜单页跳转。
 *
 * 身份 = 本机安装 ID（服务端只见加盐哈希，见 contribute.ts）。查询走
 * POST body，ID 不进 URL；跳转榜单页只带不可逆的哈希前缀（me），榜单页
 * 加载后立即从地址栏抹除，分享出去的是干净 URL。
 */

import { API_BASE } from '../platform/api-base';
import { getInstallationId, peekInstallationId } from './contribute';

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

/** 榜单速览（name/Top10 + 我 + 总人数）。失败返回 null，由调用方降级空态。 */
export async function fetchHunterBoard(): Promise<HunterBoard | null> {
  const installationId = await peekInstallationId();
  try {
    const res = await fetch(`${API_BASE}/v1/leaderboard`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(installationId ? { installation_id: installationId } : {}),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as LeaderboardResponse;
    return { rows: data.rows.slice(0, 10), total: data.total ?? 0, me: data.me };
  } catch {
    return null;
  }
}

export function leaderboardUrl(mePrefix?: string | null): string {
  return mePrefix ? `${API_BASE}/leaderboard?me=${mePrefix}` : `${API_BASE}/leaderboard`;
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

export async function openLeaderboard(mePrefix?: string | null): Promise<void> {
  await browser.tabs.create({ url: leaderboardUrl(mePrefix) });
}

export interface HunterProfileState {
  display_name: string | null;
  bio: string | null;
  x_handle: string | null;
  title: string | null;
  email_verified: boolean;
}

/** 当前猎手档案（设置区展示）。未绑定过 / 无网时 null，由调用方降级。 */
export async function fetchHunterProfile(): Promise<HunterProfileState | null> {
  const installationId = await peekInstallationId();
  if (!installationId) return null;
  try {
    const res = await fetch(`${API_BASE}/v1/player/me`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ installation_id: installationId }),
    });
    if (!res.ok) return null;
    return (await res.json()) as HunterProfileState;
  } catch {
    return null;
  }
}

/** 发验证码（安装 ID 在此刻惰性生成——想露脸才建档）。 */
export async function bindHunterEmail(
  email: string,
): Promise<{ ok: boolean; sent: boolean; dev_code?: string }> {
  const installationId = await getInstallationId();
  try {
    const res = await fetch(`${API_BASE}/v1/player/bind-email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ installation_id: installationId, email }),
    });
    if (!res.ok) return { ok: false, sent: false };
    const value = (await res.json()) as { sent: boolean; dev_code?: string };
    return { ok: true, sent: value.sent, dev_code: value.dev_code };
  } catch {
    return { ok: false, sent: false };
  }
}

export async function verifyHunterEmail(email: string, code: string): Promise<boolean> {
  const installationId = await getInstallationId();
  try {
    const res = await fetch(`${API_BASE}/v1/player/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ installation_id: installationId, email, code }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function saveHunterProfile(
  displayName: string,
  bio: string,
  xHandle: string = '',
): Promise<{ ok: boolean; invalid?: boolean }> {
  const installationId = await peekInstallationId();
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
    return { ok: res.ok };
  } catch {
    return { ok: false };
  }
}
