/**
 * 社区候选池（只读）：accounts 表里所有聚合账号按净票分层浏览。
 *
 * 读写边界：这里是纯粹的复核视图，不提供任何改写入口；要进入公开名单，
 * 由维护者在「账号」页走维护者草稿流程（独立来源，不伪造社区票数）。
 */

import { and, asc, between, eq, ilike, sql, type SQL } from 'drizzle-orm';
import { getDb } from './db/client';
import { accounts, activeLabels, reports, ruleHits } from './db/schema';
import { collateC, escapeLike } from './lib/sql';

export interface CommunityCandidate {
  handle: string;
  x_user_id: string | null;
  category: string;
  status: string;
  report_count: number;
  rescue_count: number;
  net_votes: number;
  /** consensus v2 加权共识（入榜的独立性条件之一，见 lib/listing.ts） */
  status_v2: string;
  /** 在当前公开名单里（快照发布写入，政策 v4 口径） */
  listed: boolean;
  consensus_v2: number | null;
  /** 独立安装实例投出的当前拉黑票数（active_labels） */
  blocked_installs: number;
  /** 独立安装实例投出的当前抢救票数（active_labels） */
  allowed_installs: number;
  /** 命中该账号的内容指纹数（去重） */
  fingerprints: number;
  /** 外链 hostname 数（去重） */
  domains: number;
  /** 最近 7 天里单日最多的规则命中网段数（规则命中众包，见 rule-hits.ts；≥ 3 且净票 ≥ 2、无误标可佐证上榜） */
  hit_networks_7d: number;
  /** 举报里出现过的检测来源（manual / heuristic / …），去重排序 */
  sources: string[];
  first_report_at: number;
  updated_at: number;
}

export interface ListCandidatesOptions {
  /** 净票区间：all | 0 | 1 | 2 | 3+ */
  net?: string;
  /** 账号子串（LIKE，小写） */
  q?: string;
  category?: string;
  /** 上一页最后一个 handle（exclusive，键集分页） */
  cursor?: string;
  /** 1-100 */
  limit: number;
}

export interface ListCandidatesResult {
  entries: CommunityCandidate[];
  next_cursor: string | null;
  categories: string[];
}

const NET_RANGES: Record<string, [number, number]> = {
  '0': [0, 0],
  '1': [1, 1],
  '2': [2, 2],
  '3+': [3, 1_000_000],
};

function asCandidate(
  row: Omit<CommunityCandidate, 'net_votes' | 'sources'> & { sources: string | null },
): CommunityCandidate {
  return {
    ...row,
    net_votes: row.report_count - row.rescue_count,
    sources: row.sources ? row.sources.split(',').filter(Boolean).sort() : [],
  };
}

export async function listCommunityCandidates(
  env: Cloudflare.Env,
  options: ListCandidatesOptions,
): Promise<ListCandidatesResult> {
  const db = getDb(env);
  const range = NET_RANGES[options.net ?? 'all'] ?? null;
  // 相关子查询里的外层列必须带表名：单表 select 中 Drizzle 会省略列的表前缀，裸 handle 会被内层表抢走
  const accountHandle = sql`${accounts}.handle`;
  const netVotes = sql`(${accounts.reportCount} - ${accounts.rescueCount})`;
  const where: SQL[] = [];

  if (range) {
    where.push(between(netVotes, range[0], range[1]));
  }
  // 无条件游标：handle 主键键集分页，保证跨页数据一致。
  // 排序与游标比较都显式用 C collation（字节序），两处必须一致，否则翻页会漏行/重复
  const handleC = collateC(accounts.handle);
  where.push(sql`${handleC} > ${options.cursor ?? ''}::text`);

  const q = options.q?.trim().toLowerCase();
  if (q) {
    where.push(ilike(accounts.handle, `%${escapeLike(q)}%`));
  }
  if (options.category) {
    where.push(eq(accounts.category, options.category));
  }

  const limit = Math.min(Math.max(Math.trunc(options.limit) || 50, 1), 100);
  const [rows, categories] = await Promise.all([
    db
      .select({
        handle: accounts.handle,
        x_user_id: accounts.xUserId,
        category: accounts.category,
        status: accounts.status,
        status_v2: accounts.statusV2,
        listed: sql<boolean>`${accounts.listed} = 1`,
        consensus_v2: accounts.consensusV2,
        report_count: accounts.reportCount,
        rescue_count: accounts.rescueCount,
        first_report_at: accounts.firstReportAt,
        updated_at: accounts.updatedAt,
        blocked_installs: sql<number>`(SELECT count(*) FROM ${activeLabels} AS l
          WHERE l.handle = ${accountHandle} AND l.label = 'blocked')`.mapWith(Number),
        allowed_installs: sql<number>`(SELECT count(*) FROM ${activeLabels} AS l
          WHERE l.handle = ${accountHandle} AND l.label = 'allowed')`.mapWith(Number),
        fingerprints: sql<number>`(SELECT count(DISTINCT r.content_fingerprint) FROM ${reports} AS r
          WHERE r.handle = ${accountHandle} AND r.content_fingerprint IS NOT NULL)`.mapWith(Number),
        domains: sql<number>`(SELECT count(DISTINCT d.value)
          FROM ${reports} AS r CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(r.link_domains::jsonb) = 'array' THEN r.link_domains::jsonb ELSE '[]'::jsonb END) AS d(value)
          WHERE r.handle = ${accountHandle} AND r.link_domains IS NOT NULL)`.mapWith(Number),
        // 网段哈希每天换：按同一天数网段，取 7 天里最多的那一天（和佐证上榜同一口径）
        hit_networks_7d: sql<number>`(SELECT coalesce(max(n), 0) FROM (
            SELECT count(DISTINCT coalesce(h.net, 'r:' || h.reporter)) AS n
            FROM ${ruleHits} AS h
            WHERE h.handle = ${accountHandle}
              AND h.day >= to_char((now() at time zone 'utc') - interval '7 days', 'YYYY-MM-DD')
            GROUP BY h.day) AS d)`.mapWith(Number),
        sources: sql<
          string | null
        >`(SELECT string_agg(DISTINCT r.detection_source, ',') FROM ${reports} AS r
          WHERE r.handle = ${accountHandle} AND r.detection_source IS NOT NULL)`,
      })
      .from(accounts)
      .where(and(...where))
      .orderBy(asc(handleC))
      .limit(limit + 1),
    db
      .selectDistinct({ category: accounts.category })
      .from(accounts)
      .orderBy(asc(accounts.category)),
  ]);

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);

  return {
    entries: page.map(asCandidate),
    next_cursor: hasMore ? (page[page.length - 1]?.handle ?? null) : null,
    categories: categories.map((row) => row.category),
  };
}
