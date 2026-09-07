/**
 * 社区白名单（verified，只读）：被社区验证为「误标正常」的账号。
 *
 * 入榜公式与黑名单严格镜像：rescue_count - report_count >= communityNetThreshold(3)，
 * 与快照里的 verified 节同配方（快照是 write-once 发布物，这里是实时复核视图）。
 * 读写边界同候选池：只读浏览，不提供改写入口。
 */
import { POLICY } from './reports';

export interface VerifiedAccount {
  handle: string;
  x_user_id: string | null;
  report_count: number;
  rescue_count: number;
  net_votes: number;
  first_report_at: number;
  updated_at: number;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

export async function listVerifiedAccounts(
  env: Cloudflare.Env,
  options: { q?: string; limit?: number } = {},
): Promise<{ entries: VerifiedAccount[] }> {
  const where: string[] = ['(a.rescue_count - a.report_count) >= ?1'];
  const binds: Array<string | number> = [POLICY.communityNetThreshold];

  const q = options.q?.trim().toLowerCase();
  if (q) {
    where.push(`a.handle LIKE ?${binds.length + 1} ESCAPE '\\'`);
    binds.push(`%${escapeLike(q)}%`);
  }

  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 500) || 500, 1), 1000);
  const rows = await env.DB.prepare(
    `SELECT a.handle, a.x_user_id, a.report_count, a.rescue_count,
            a.first_report_at, a.updated_at
     FROM accounts a
     WHERE ${where.join(' AND ')}
     ORDER BY (a.rescue_count - a.report_count) DESC, a.handle ASC
     LIMIT ${limit}`,
  )
    .bind(...binds)
    .all<Omit<VerifiedAccount, 'net_votes'>>();

  return {
    entries: rows.results.map((row) => ({
      ...row,
      net_votes: row.rescue_count - row.report_count,
    })),
  };
}