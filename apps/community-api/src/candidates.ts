/**
 * 社区候选池（只读）：accounts 表里所有聚合账号按净票分层浏览。
 *
 * 读写边界：这里是纯粹的复核视图，不提供任何改写入口；要进入公开名单，
 * 由维护者在「账号」页走维护者草稿流程（独立来源，不伪造社区票数）。
 */

export interface CommunityCandidate {
  handle: string;
  x_user_id: string | null;
  category: string;
  status: string;
  report_count: number;
  rescue_count: number;
  net_votes: number;
  /** consensus v2 影子（不参与入榜，只作对比展示） */
  status_v2: string;
  consensus_v2: number | null;
  /** 独立安装实例投出的当前拉黑票数（active_labels） */
  blocked_installs: number;
  /** 独立安装实例投出的当前抢救票数（active_labels） */
  allowed_installs: number;
  /** 命中该账号的内容指纹数（去重） */
  fingerprints: number;
  /** 外链 hostname 数（去重） */
  domains: number;
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

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

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
  const range = NET_RANGES[options.net ?? 'all'] ?? null;
  const where: string[] = [];
  const binds: Array<string | number> = [];

  if (range) {
    where.push(
      `(a.report_count - a.rescue_count) BETWEEN ?${binds.length + 1} AND ?${binds.length + 2}`,
    );
    binds.push(range[0], range[1]);
  }
  // 无条件游标：handle 主键键集分页，保证跨页数据一致。
  where.push(`a.handle > ?${binds.length + 1}`);
  binds.push(options.cursor ?? '');

  const q = options.q?.trim().toLowerCase();
  if (q) {
    where.push(`a.handle LIKE ?${binds.length + 1} ESCAPE '\\'`);
    binds.push(`%${escapeLike(q)}%`);
  }
  if (options.category) {
    where.push(`a.category = ?${binds.length + 1}`);
    binds.push(options.category);
  }

  const limit = Math.min(Math.max(Math.trunc(options.limit) || 50, 1), 100);
  const rows = await env.DB.prepare(
    `SELECT a.handle, a.x_user_id, a.category, a.status,
            a.status_v2, a.consensus_v2,
            a.report_count, a.rescue_count, a.first_report_at, a.updated_at,
            (SELECT COUNT(*) FROM active_labels l
              WHERE l.handle = a.handle AND l.label = 'blocked') AS blocked_installs,
            (SELECT COUNT(*) FROM active_labels l
              WHERE l.handle = a.handle AND l.label = 'allowed') AS allowed_installs,
            (SELECT COUNT(DISTINCT content_fingerprint) FROM reports r
              WHERE r.handle = a.handle AND r.content_fingerprint IS NOT NULL) AS fingerprints,
            (SELECT COUNT(DISTINCT d.value) FROM reports r, json_each(r.link_domains) d
              WHERE r.handle = a.handle AND r.link_domains IS NOT NULL) AS domains,
            (SELECT GROUP_CONCAT(DISTINCT detection_source) FROM reports r
              WHERE r.handle = a.handle AND r.detection_source IS NOT NULL) AS sources
     FROM accounts a
     WHERE ${where.join(' AND ')}
     ORDER BY a.handle ASC
     LIMIT ${limit + 1}`,
  )
    .bind(...binds)
    .all<
      Omit<CommunityCandidate, 'net_votes' | 'sources'> & { sources: string | null }
    >();

  const hasMore = rows.results.length > limit;
  const page = rows.results.slice(0, limit);
  const categories = await env.DB.prepare(
    'SELECT DISTINCT category FROM accounts ORDER BY category',
  ).all<{ category: string }>();

  return {
    entries: page.map(asCandidate),
    next_cursor: hasMore ? page[page.length - 1]?.handle ?? null : null,
    categories: categories.results.map((row) => row.category),
  };
}