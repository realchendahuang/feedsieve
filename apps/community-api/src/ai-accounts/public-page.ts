/**
 * 公开结果页（feedsieve.win/ai/:handle）与它的 OG 预览图共用的取数。
 *
 * 只展示「可以向所有人展示」的结论（见 lookup.ts）：单人未确认的只显示「待复核」，
 * 复核中的显示「复核中」，都不给分数——分享出去的链接不能变成伪造证据的扩音器。
 */
import { eq } from 'drizzle-orm';
import { flavorOf, type Flavor } from '@feedsieve/shared';
import { getDb } from '../db/client';
import { aiAccountVerdicts, profileAccounts } from '../db/schema';
import { lookupAiAccount, type AiLookupValue } from './lookup';

const HANDLE = /^[a-z0-9_]{1,15}$/;

export interface AiPublicData {
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
  state: 'public' | 'pending' | 'review' | 'none';
  lookup: AiLookupValue;
  /** state 为 public 且有分数时 */
  flavor: Flavor | null;
}

export function normalizePublicHandle(raw: string): string | null {
  const handle = decodeURIComponent(raw).trim().replace(/^@/, '').toLowerCase();
  return HANDLE.test(handle) ? handle : null;
}

export async function getAiPublic(env: Cloudflare.Env, raw: string): Promise<AiPublicData | null> {
  const handle = normalizePublicHandle(raw);
  if (!handle) return null;
  const db = getDb(env);
  const [lookup, [verdictRow], [profileRow]] = await Promise.all([
    lookupAiAccount(env, handle),
    db
      .select({ displayName: aiAccountVerdicts.displayName, avatarUrl: aiAccountVerdicts.avatarUrl })
      .from(aiAccountVerdicts)
      .where(eq(aiAccountVerdicts.handle, handle)),
    db
      .select({ displayName: profileAccounts.displayName, avatarUrl: profileAccounts.avatarUrl })
      .from(profileAccounts)
      .where(eq(profileAccounts.handle, handle)),
  ]);
  if (!lookup) return null;
  const state = lookup.public
    ? 'public'
    : lookup.under_review
      ? 'review'
      : lookup.pending
        ? 'pending'
        : 'none';
  const flavor =
    state === 'public' && lookup.score !== null && lookup.verdict && lookup.verdict !== 'insufficient'
      ? flavorOf(lookup.score, lookup.verdict, lookup.rhythm, 'zh', handle)
      : null;
  return {
    handle,
    displayName: verdictRow?.displayName ?? profileRow?.displayName ?? null,
    avatarUrl: verdictRow?.avatarUrl ?? profileRow?.avatarUrl ?? null,
    state: flavor || state !== 'public' ? state : 'none',
    lookup,
    flavor,
  };
}
