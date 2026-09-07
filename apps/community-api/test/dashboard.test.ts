import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';
import { getDashboardMetrics } from '../src/dashboard';
import {
  generateSnapshot,
  getLatestSnapshotMeta,
  readSnapshotDirty,
} from '../src/snapshot';

const ORIGIN = 'https://api.example.com';

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
    await env.DB.prepare(
      `INSERT INTO admin_account_drafts
         (handle, category, note, active, created_at, updated_at)
       VALUES (?1, 'scam_phishing', '人工复核', 1, ?2, ?2)`,
    )
      .bind('curated_user', now)
      .run();
    await env.DB.prepare(
      `INSERT INTO maintainer_blocklist
         (handle, category, reason, active, created_at, updated_at)
       VALUES (?1, 'scam_phishing', '人工复核', 1, ?2, ?2)`,
    )
      .bind('curated_user', now)
      .run();

    // 生成公开快照后：公开条目 = 社区达标 + 维护者并集
    const published = await generateSnapshot(env);
    const metrics = await getDashboardMetrics(env);

    expect(metrics.community_listed).toBe(1);
    expect(metrics.community_candidates).toBe(1);
    expect(metrics.maintainer_entries).toBe(1);
    expect(metrics.public_entries).toBe(2);
    expect(metrics.snapshot_version).toBe(published.version);
    expect(metrics.snapshot_lag_seconds).toBeGreaterThanOrEqual(0);
    expect(metrics.reports_last_24h).toBe(4);
    expect(metrics.active_installations_last_24h).toBe(4);
    expect(metrics.false_positive_feedback).toBe(0);
  });
});

describe('快照异步化（脏标记）', () => {
  it('上报只落库置脏并返回当前版本；cron 消费后清除', async () => {
    const metaBefore = await getLatestSnapshotMeta(env);
    const before = await env.DB.prepare('SELECT COUNT(*) AS n FROM snapshots').first<{
      n: number;
    }>();

    // 写路径：不生成快照，只置脏；响应携带当前有效版本
    const body = await report('eeeeeeee-3005-4005-8005-eeeeeeeeeeee', 'async_user');
    expect(await readSnapshotDirty(env)).not.toBeNull();
    expect(body.snapshot_version).toBe(metaBefore?.version ?? null);
    const afterReport = await env.DB.prepare('SELECT COUNT(*) AS n FROM snapshots').first<{
      n: number;
    }>();
    expect(afterReport?.n).toBe(before?.n ?? 0);

    // cron 消费：async_user 只有 1 票，内容未变 → 复用版本、清标记、不落新行
    await worker.scheduled!(undefined as never, env);
    expect(await readSnapshotDirty(env)).toBeNull();
    const afterCron = await env.DB.prepare('SELECT COUNT(*) AS n FROM snapshots').first<{
      n: number;
    }>();
    expect(afterCron?.n).toBe(before?.n ?? 0);
  });

  it('当日已有版本时 cron 顺延；达标内容经即时通道发布，cron 随后复用并清脏', async () => {
    // 同一账号再补两票 → 内容变化（async_user 达 3 票进榜）
    await report('ffffffff-3006-4006-8006-ffffffffffff', 'async_user');
    await report('99999999-3007-4007-8007-999999999999', 'async_user');
    expect(await readSnapshotDirty(env)).not.toBeNull();

    const before = await env.DB.prepare('SELECT COUNT(*) AS n FROM snapshots').first<{
      n: number;
    }>();
    // day-once：今日已有版本（本文件首用例已发布），cron 只顺延、不清脏
    await worker.scheduled!(undefined as never, env);
    expect(await readSnapshotDirty(env)).not.toBeNull();

    // 维护者显式发布走即时通道（bypassDailyOnce）：内容立即可见、行数 +1
    const published = await generateSnapshot(env, 0, { bypassDailyOnce: true });
    expect(published.deferred).not.toBe(true);
    const after = await env.DB.prepare('SELECT COUNT(*) AS n FROM snapshots').first<{
      n: number;
    }>();
    expect(after?.n).toBe((before?.n ?? 0) + 1);

    // 再跑 cron：内容与最新一致 → 复用版本并清脏标记，不落新行
    await worker.scheduled!(undefined as never, env);
    expect(await readSnapshotDirty(env)).toBeNull();
    const afterCron = await env.DB.prepare('SELECT COUNT(*) AS n FROM snapshots').first<{
      n: number;
    }>();
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
    const [listed, maintained] = await Promise.all([
      env.DB.prepare(
        'SELECT COUNT(*) AS n FROM accounts WHERE report_count - rescue_count >= 3',
      ).first<{ n: number }>(),
      env.DB.prepare(
        'SELECT COUNT(*) AS n FROM maintainer_blocklist WHERE active = 1',
      ).first<{ n: number }>(),
    ]);
    expect(meta?.entries).toBe((listed?.n ?? 0) + (maintained?.n ?? 0));
    expect(meta?.generated_at).toBeGreaterThan(0);
    expect(meta?.lag_seconds).toBeGreaterThanOrEqual(0);
  });
});