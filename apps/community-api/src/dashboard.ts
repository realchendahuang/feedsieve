import { POLICY } from './reports';
import { getLatestSnapshotMeta } from './snapshot';

/**
 * 概览页分层指标。口径分层，避免「数据库记录了多少」与「已经公开发布了多少」混淆：
 * - community_listed：社区净票达标（进入公开名单的来源之一）
 * - community_candidates：未达标的社区候选账号
 * - maintainer_entries：维护者草稿（独立来源）
 * - public_entries：客户端实际下载的最终名单条目数（快照 manifest，含维护者并集）
 */
export interface DashboardMetrics {
  community_listed: number;
  community_candidates: number;
  maintainer_entries: number;
  public_entries: number;
  false_positive_feedback: number;
  /** 按安装×账号去重后的近期活跃举报关系数，不是请求数。 */
  reports_last_24h: number;
  active_installations_last_24h: number;
  snapshot_version: string | null;
  snapshot_generated_at: number | null;
  snapshot_lag_seconds: number | null;
}

export async function getDashboardMetrics(env: Cloudflare.Env): Promise<DashboardMetrics> {
  const dayAgo = Math.floor(Date.now() / 1000) - 24 * 3600;
  const [draftCount, listed, candidates, feedback, reports24h, installs, snapshot] =
    await Promise.all([
      env.DB.prepare('SELECT COUNT(*) AS n FROM admin_account_drafts WHERE active = 1').first<{
        n: number;
      }>(),
      env.DB.prepare(
        'SELECT COUNT(*) AS n FROM accounts WHERE report_count - rescue_count >= ?1',
      )
        .bind(POLICY.communityNetThreshold)
        .first<{ n: number }>(),
      env.DB.prepare(
        'SELECT COUNT(*) AS n FROM accounts WHERE report_count - rescue_count < ?1',
      )
        .bind(POLICY.communityNetThreshold)
        .first<{ n: number }>(),
      env.DB.prepare('SELECT COUNT(*) AS n FROM rescues').first<{ n: number }>(),
      env.DB.prepare('SELECT COUNT(*) AS n FROM reports WHERE created_at >= ?1')
        .bind(dayAgo)
        .first<{ n: number }>(),
      env.DB.prepare('SELECT COUNT(*) AS n FROM installations WHERE last_seen_at >= ?1')
        .bind(dayAgo)
        .first<{ n: number }>(),
      getLatestSnapshotMeta(env),
    ]);

  return {
    community_listed: listed?.n ?? 0,
    community_candidates: candidates?.n ?? 0,
    maintainer_entries: draftCount?.n ?? 0,
    public_entries: snapshot?.entries ?? 0,
    false_positive_feedback: feedback?.n ?? 0,
    reports_last_24h: reports24h?.n ?? 0,
    active_installations_last_24h: installs?.n ?? 0,
    snapshot_version: snapshot?.version ?? null,
    snapshot_generated_at: snapshot?.generated_at ?? null,
    snapshot_lag_seconds: snapshot?.lag_seconds ?? null,
  };
}