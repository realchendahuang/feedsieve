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
}

interface LeaderboardResponse {
  rows: Array<{ id: string }>;
  me: { id: string; rank: number; kills: number } | null;
}

export function leaderboardUrl(mePrefix?: string | null): string {
  return mePrefix ? `${API_BASE}/leaderboard?me=${mePrefix}` : `${API_BASE}/leaderboard`;
}

/** 榜单状态（打开 popup 时拉一次即可；失败静默为空态，不打扰战报线） */
export async function fetchHunterStatus(): Promise<HunterStatus> {
  const installationId = await peekInstallationId();
  if (!installationId) {
    return { mePrefix: null, rank: null, kills: null };
  }
  try {
    const res = await fetch(`${API_BASE}/v1/leaderboard`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ installation_id: installationId }),
    });
    if (!res.ok) {
      return { mePrefix: null, rank: null, kills: null };
    }
    const data = (await res.json()) as LeaderboardResponse;
    if (!data.me) {
      return { mePrefix: null, rank: null, kills: null };
    }
    return {
      mePrefix: data.me.id,
      rank: data.me.rank,
      kills: data.me.kills,
    };
  } catch {
    return { mePrefix: null, rank: null, kills: null };
  }
}

export async function openLeaderboard(mePrefix?: string | null): Promise<void> {
  await browser.tabs.create({ url: leaderboardUrl(mePrefix) });
}

export interface HunterProfileState {
  display_name: string | null;
  bio: string | null;
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
): Promise<boolean> {
  const installationId = await peekInstallationId();
  if (!installationId) return false;
  try {
    const res = await fetch(`${API_BASE}/v1/player/profile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ installation_id: installationId, display_name: displayName, bio }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
