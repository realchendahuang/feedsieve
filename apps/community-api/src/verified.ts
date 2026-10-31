/**
 * 社区白名单（verified，只读）：被社区验证为「误标正常」的账号。
 *
 * 入榜公式与黑名单严格镜像：rescue_count - report_count >= communityNetThreshold(3)，
 * 与快照里的 verified 节同配方（快照是 write-once 发布物，这里是实时复核视图）。
 * 读写边界同候选池：只读浏览，不提供改写入口。
 */
import { POLICY } from './reports';
import { and, asc, desc, gte, ilike, sql, type SQL } from 'drizzle-orm';
import { getDb } from './db/client';
import { accounts } from './db/schema';
import { collateC, escapeLike } from './lib/sql';

export interface VerifiedAccount {
  handle: string;
  x_user_id: string | null;
  report_count: number;
  rescue_count: number;
  net_votes: number;
  first_report_at: number;
  updated_at: number;
}

export async function listVerifiedAccounts(
  env: Cloudflare.Env,
  options: { q?: string; limit?: number } = {},
): Promise<{ entries: VerifiedAccount[] }> {
  const netVotes = sql`(${accounts.rescueCount} - ${accounts.reportCount})`;
  const where: SQL[] = [gte(netVotes, POLICY.communityNetThreshold)];

  const q = options.q?.trim().toLowerCase();
  if (q) {
    where.push(ilike(accounts.handle, `%${escapeLike(q)}%`));
  }

  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 500) || 500, 1), 1000);
  const rows = await getDb(env)
    .select({
      handle: accounts.handle,
      x_user_id: accounts.xUserId,
      report_count: accounts.reportCount,
      rescue_count: accounts.rescueCount,
      first_report_at: accounts.firstReportAt,
      updated_at: accounts.updatedAt,
    })
    .from(accounts)
    .where(and(...where))
    .orderBy(desc(netVotes), asc(collateC(accounts.handle)))
    .limit(limit);

  return {
    entries: rows.map((row) => ({
      ...row,
      net_votes: row.rescue_count - row.report_count,
    })),
  };
}
