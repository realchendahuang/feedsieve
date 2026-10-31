/**
 * 共识事件：consensus_events 是「当前处于共识内」账号的镜像，
 * 账号达标 strong 时写入达标时刻、翻案回落或进白名单时删除。
 * 死账号探活（prober.ts）据此定位新进共识的账号。
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from './db/client';
import { compareText } from './lib/sql';
import { consensusEvents, maintainerWhitelist } from './db/schema';

/** 单条语句的 handle 上限：远低于 PG 的 65535 参数上限，真遇到几千个账号时才会分片 */
const CHUNK = 1000;

export interface ConsensusTransition {
  strong: boolean;
  xUserId: string | null;
}

function chunked<T>(items: T[]): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += CHUNK) {
    chunks.push(items.slice(index, index + CHUNK));
  }
  return chunks;
}

/**
 * 把一次状态收敛的结果同步进 consensus_events：
 * 进入 strong 且不在白名单 → 记/刷新达标时刻；跌出（回落或进白名单）→ 删除。
 * 幂等：事件表本就是「当前共识内」的镜像。
 */
export async function syncConsensusEvents(
  env: Cloudflare.Env,
  transitions: Map<string, ConsensusTransition>,
): Promise<void> {
  if (transitions.size === 0) return;
  const db = getDb(env);
  const handles = [...transitions.keys()];
  const existing = new Set<string>();
  const whitelisted = new Set<string>();
  const now = Math.floor(Date.now() / 1000);

  for (const chunk of chunked(handles)) {
    const [events, whitelist] = await Promise.all([
      db
        .select({ handle: consensusEvents.handle })
        .from(consensusEvents)
        .where(inArray(consensusEvents.handle, chunk)),
      db
        .select({ handle: maintainerWhitelist.handle })
        .from(maintainerWhitelist)
        .where(and(eq(maintainerWhitelist.active, 1), inArray(maintainerWhitelist.handle, chunk))),
    ]);
    for (const row of events) existing.add(row.handle);
    for (const row of whitelist) whitelisted.add(row.handle);
  }

  const upserts: (typeof consensusEvents.$inferInsert)[] = [];
  const removals: string[] = [];
  for (const [handle, transition] of transitions) {
    const shouldCount = transition.strong && !whitelisted.has(handle);
    if (shouldCount && !existing.has(handle)) {
      upserts.push({ handle, xUserId: transition.xUserId, confirmedAt: now, updatedAt: now });
    } else if (!shouldCount && existing.has(handle)) {
      removals.push(handle);
    }
  }

  // 按主键排序：并发请求以相同顺序锁行，避免死锁
  upserts.sort((a, b) => compareText(a.handle, b.handle));
  removals.sort(compareText);

  // 两类写入的 handle 互不相交，并发发出；每类按块一条语句
  await Promise.all([
    ...chunked(upserts).map((rows) =>
      db
        .insert(consensusEvents)
        .values(rows)
        .onConflictDoUpdate({
          target: consensusEvents.handle,
          set: {
            xUserId: sql`excluded.x_user_id`,
            confirmedAt: sql`excluded.confirmed_at`,
            updatedAt: sql`excluded.updated_at`,
          },
        }),
    ),
    ...chunked(removals).map((rows) =>
      db.delete(consensusEvents).where(inArray(consensusEvents.handle, rows)),
    ),
  ]);
}
