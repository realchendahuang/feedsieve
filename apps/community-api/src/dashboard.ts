import { count, eq, gte } from 'drizzle-orm';
import { getDb } from './db/client';
import { accounts, adminAccountDrafts, installations, reports, rescues } from './db/schema';
import { getLatestSnapshotMeta } from './snapshot';

/**
 * 概览页分层指标。口径分层，避免「数据库记录了多少」与「已经公开发布了多少」混淆：
 * - community_listed：在当前公开名单里的社区账号（accounts.listed，快照发布写入，政策 v4 口径）
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
  const db = getDb(env);
  const dayAgo = Math.floor(Date.now() / 1000) - 24 * 3600;
  const [[draftCount], [listed], [candidates], [feedback], [reports24h], [installs], snapshot] =
    await Promise.all([
      db.select({ n: count() }).from(adminAccountDrafts).where(eq(adminAccountDrafts.active, 1)),
      // 已上榜 / 候选：和公开名单同一口径（快照发布写入 accounts.listed）
      db.select({ n: count() }).from(accounts).where(eq(accounts.listed, 1)),
      db.select({ n: count() }).from(accounts).where(eq(accounts.listed, 0)),
      db.select({ n: count() }).from(rescues),
      db.select({ n: count() }).from(reports).where(gte(reports.createdAt, dayAgo)),
      db.select({ n: count() }).from(installations).where(gte(installations.lastSeenAt, dayAgo)),
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
