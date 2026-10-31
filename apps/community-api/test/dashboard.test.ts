import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { count, eq, sql } from 'drizzle-orm';
import worker from '../src/index';
import { getDb } from '../src/db/client';
import {
  accounts,
  adminAccountDrafts,
  maintainerBlocklist,
  reports,
  snapshots,
} from '../src/db/schema';
import { getDashboardMetrics } from '../src/dashboard';
import { generateSnapshot, getLatestSnapshotMeta, readSnapshotDirty } from '../src/snapshot';
import { spreadLatestReport } from './vote-days';

const ORIGIN = 'https://api.example.com';

async function snapshotCount(): Promise<{ n: number }> {
  const [row] = await getDb(env).select({ n: count() }).from(snapshots);
  return row!;
}

async function report(installationId: string, handle: string, extra: Record<string, unknown> = {}) {
  const res = await worker.fetch(
    new Request(`${ORIGIN}/v1/reports`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        installation_id: installationId,
        reports: [{ handle, reason: 'bot_spam', ...extra }],
      }),
    }),
    env,
  );
  expect(res.status).toBe(200);
  await spreadLatestReport();
  return (await res.json()) as { results: { status: string }[]; snapshot_version: string | null };
}

describe('概览分层指标', () => {
  it('名单 / 候选 / 维护 / 公开条目口径互不混淆', async () => {
    // 社区：alpha 三票达标，bravo 一票仍是候选
    await report('aaaaaaaa-3001-4001-8000-aaaaaaaaaaaa', 'alpha_user');
    await report('bbbbbbbb-3002-4002-8002-bbbbbbbbbbbb', 'alpha_user');
    await report('cccccccc-3003-4003-8003-cccccccccccc', 'alpha_user');
    await report('dddddddd-3004-4004-8004-dddddddddddd', 'bravo_user');

    // 维护者草稿（独立来源，与社区票数无关）+ 已发布的维护者条目
    const now = Math.floor(Date.now() / 1000);
    await getDb(env).insert(adminAccountDrafts).values({
      handle: 'curated_user',
      category: 'scam_phishing',
      note: '人工复核',
      active: 1,
      createdAt: now,
      updatedAt: now,
    });
    await getDb(env).insert(maintainerBlocklist).values({
      handle: 'curated_user',
      category: 'scam_phishing',
      reason: '人工复核',
      active: 1,
      createdAt: now,
      updatedAt: now,
    });

    // 生成公开快照后：公开条目 = 社区达标 + 维护者并集
    const published = await generateSnapshot(env);
    const metrics = await getDashboardMetrics(env);

    expect(metrics.community_listed).toBe(1);
    expect(metrics.community_candidates).toBe(1);
    expect(metrics.maintainer_entries).toBe(1);
    expect(metrics.public_entries).toBe(2);
    expect(metrics.snapshot_version).toBe(published.version);
    expect(metrics.snapshot_lag_seconds).toBeGreaterThanOrEqual(0);
    // spreadLatestReport 按 id 奇偶把部分票挪到了前一天：和库里 24 小时内的举报数一致
    const [recent] = await getDb(env)
      .select({ n: count() })
      .from(reports)
      .where(sql`${reports.createdAt} >= ${Math.floor(Date.now() / 1000) - 86400}`);
    expect(metrics.reports_last_24h).toBe(recent?.n);
    expect(metrics.active_installations_last_24h).toBe(4);
    expect(metrics.false_positive_feedback).toBe(0);
  });
});

describe('快照异步化（脏标记）', () => {
  // cron 编排现已共用 runScheduledCron（含死账号探活）；探活会请求 X guest token，
  // 单测环境一律假失败让 prober 走「token 缺失即离场」的快速路径，不碰网络。
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unavailable', { status: 503 })),
    );
  });

  it('上报只落库置脏并返回当前版本；cron 消费后清除', async () => {
    const metaBefore = await getLatestSnapshotMeta(env);
    const before = await snapshotCount();

    // 写路径：不生成快照，只置脏；响应携带当前有效版本
    const body = await report('eeeeeeee-3005-4005-8005-eeeeeeeeeeee', 'async_user');
    expect(await readSnapshotDirty(env)).not.toBeNull();
    expect(body.snapshot_version).toBe(metaBefore?.version ?? null);
    const afterReport = await snapshotCount();
    expect(afterReport?.n).toBe(before?.n ?? 0);

    // cron 消费：async_user 只有 1 票，内容未变 → 复用版本、清标记、不落新行
    await worker.scheduled!(undefined as never, env);
    expect(await readSnapshotDirty(env)).toBeNull();
    const afterCron = await snapshotCount();
    expect(afterCron?.n).toBe(before?.n ?? 0);
  });

  it('当日已有版本时 cron 顺延；达标内容经即时通道发布，cron 随后复用并清脏', async () => {
    // 同一账号再补两票 → 内容变化（async_user 达 3 票进榜）
    await report('ffffffff-3006-4006-8006-ffffffffffff', 'async_user');
    await report('99999999-3007-4007-8007-999999999999', 'async_user');
    expect(await readSnapshotDirty(env)).not.toBeNull();

    const before = await snapshotCount();
    // day-once：今日已有版本（本文件首用例已发布），cron 只顺延、不清脏
    await worker.scheduled!(undefined as never, env);
    expect(await readSnapshotDirty(env)).not.toBeNull();

    // 维护者显式发布走即时通道（bypassDailyOnce）：内容立即可见、行数 +1
    const published = await generateSnapshot(env, 0, { bypassDailyOnce: true });
    expect(published.deferred).not.toBe(true);
    const after = await snapshotCount();
    expect(after?.n).toBe((before?.n ?? 0) + 1);

    // 再跑 cron：内容与最新一致 → 复用版本并清脏标记，不落新行
    await worker.scheduled!(undefined as never, env);
    expect(await readSnapshotDirty(env)).toBeNull();
    const afterCron = await snapshotCount();
    expect(afterCron?.n).toBe(after?.n ?? 0);

    const meta = await getLatestSnapshotMeta(env);
    // 本文件累计数据：alpha_user + async_user（社区各 3 票）+ curated_user（维护者条目）
    expect(meta?.entries).toBe(3);
  });

  it('getLatestSnapshotMeta 与公开条目数一致', async () => {
    await report('88888888-3008-4008-8008-888888888888', 'meta_user2');
    await worker.scheduled!(undefined as never, env);

    const meta = await getLatestSnapshotMeta(env);
    expect(meta?.version).toBeTruthy();
    // 本文件数据：async_user 3 票 + 维护者 curated_user 并集（与 accounts 达标数 + 维护条目数一致）
    const db = getDb(env);
    const [[listed], [maintained]] = await Promise.all([
      db
        .select({ n: count() })
        .from(accounts)
        .where(sql`${accounts.reportCount} - ${accounts.rescueCount} >= 3`),
      db.select({ n: count() }).from(maintainerBlocklist).where(eq(maintainerBlocklist.active, 1)),
    ]);
    expect(meta?.entries).toBe((listed?.n ?? 0) + (maintained?.n ?? 0));
    expect(meta?.generated_at).toBeGreaterThan(0);
    expect(meta?.lag_seconds).toBeGreaterThanOrEqual(0);
  });
});
