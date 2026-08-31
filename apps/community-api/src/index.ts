import { cors } from 'hono/cors';
import { Hono } from 'hono';
import { checkBearerToken } from './lib/auth';
import { hashInstallationId } from './lib/hash';
import { POLICY, processReportBatch, publicPolicy } from './reports';
import { processRescueBatch } from './rescues';
import {
  generateSnapshot,
  getLatestSnapshot,
  getSnapshotFile,
} from './snapshot';

export function createApp() {
  const app = new Hono<{ Bindings: Cloudflare.Env }>();

  // 扩展 content script 会跨域 POST，必须放行预检
  app.use('*', cors());

  app.get('/healthz', (c) =>
    c.json({
      ok: true,
      service: 'feedsieve-community-api',
      time: new Date().toISOString(),
    }),
  );

  app.post('/v1/reports', async (c) => {
    const body = await c.req.json().catch(() => undefined);
    const result = await processReportBatch(c.env, body);
    if (!result.ok) {
      return c.json({ error: result.error }, result.httpStatus);
    }
    return c.json({
      policy: {
        candidate_threshold: POLICY.candidateThreshold,
        daily_report_limit: POLICY.dailyReportLimit,
      },
      results: result.results,
    });
  });

  // 快照消费端点：manifest 短缓存，版本化文件按不可变缓存
  app.get('/v1/snapshots/latest', async (c) => {
    const latest = await getLatestSnapshot(c.env);
    if (!latest) return c.json({ error: 'no_snapshot' }, 404);
    c.header('Cache-Control', 'public, max-age=300');
    return c.body(latest.manifest, 200, { 'content-type': 'application/json' });
  });

  app.get('/v1/snapshots/:version/:path', async (c) => {
    const body = await getSnapshotFile(
      c.env,
      c.req.param('version'),
      c.req.param('path'),
    );
    if (!body) return c.json({ error: 'not_found' }, 404);
    c.header('Cache-Control', 'public, max-age=31536000, immutable');
    return c.body(body, 200, { 'content-type': 'application/json' });
  });

  app.post('/v1/rescues', async (c) => {
    const body = await c.req.json().catch(() => undefined);
    const result = await processRescueBatch(c.env, body);
    if (!result.ok) {
      return c.json({ error: result.error }, result.httpStatus);
    }
    return c.json({ results: result.results });
  });

  // 公开政策：阈值不藏在后端黑箱里
  app.get('/v1/policy', (c) => c.json(publicPolicy()));

  // 我的贡献统计（v0.6）：按安装哈希查累计上报 / 被采纳 / 抢救数。
  // 隐私：POST body 接收安装 ID（不进 URL，不落边缘访问日志），服务端只存
  // 加盐哈希；返回纯数字，无账号信息。
  app.post('/v1/contributions/stats', async (c) => {
    const body: unknown = await c.req.json().catch(() => undefined);
    const installationId =
      typeof body === 'object' && body !== null
        ? (body as Record<string, unknown>)['installation_id']
        : undefined;
    if (
      typeof installationId !== 'string' ||
      installationId.length < 8 ||
      installationId.length > 128
    ) {
      return c.json({ error: 'invalid_installation_id' }, 400);
    }
    const installHash = await hashInstallationId(
      c.env.INSTALLATION_SALT,
      installationId,
    );
    const [reports, rescues, adopted] = await Promise.all([
      c.env.DB.prepare(
        'SELECT COUNT(*) AS n FROM reports WHERE installation_id = ?1',
      )
        .bind(installHash)
        .first<{ n: number }>(),
      c.env.DB.prepare(
        'SELECT COUNT(*) AS n FROM rescues WHERE installation_id = ?1',
      )
        .bind(installHash)
        .first<{ n: number }>(),
      // 被采纳：该安装上报过的账号，最终进了快照（candidate/recommended/strong）
      c.env.DB.prepare(
        `SELECT COUNT(DISTINCT r.handle) AS n
         FROM reports r
         JOIN accounts a ON a.handle = r.handle
         WHERE r.installation_id = ?1
           AND a.status IN ('candidate', 'recommended', 'strong')`,
      )
        .bind(installHash)
        .first<{ n: number }>(),
    ]);
    return c.json({
      reports: reports?.n ?? 0,
      rescues: rescues?.n ?? 0,
      adopted: adopted?.n ?? 0,
    });
  });

  // admin：ADMIN_TOKEN 保护；自动化只能到 candidate，提升/发布由人触发
  app.use('/admin/*', async (c, next) => {
    if (!(await checkBearerToken(c.req.header('authorization'), c.env.ADMIN_TOKEN))) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    await next();
  });
  app.post('/admin/publish', async (c) => {
    const published = await generateSnapshot(c.env);
    return c.json({
      snapshot_version: published.version,
      files: published.manifest.files,
    });
  });

  // 待审队列：new + candidate，按票数降序；给人工提升/驳回当工作面板
  app.get('/admin/candidates', async (c) => {
    const res = await c.env.DB.prepare(
      `SELECT handle, x_user_id, category, status, report_count, rescue_count,
              first_report_at, updated_at
       FROM accounts
       WHERE status IN ('new', 'candidate')
       ORDER BY report_count DESC, handle ASC`,
    ).all();
    return c.json({ candidates: res.results });
  });

  // 人工提升/驳回已移除（v0.5 零人工：状态全部由 auto-rate 派生）。
  // 保留待审队列视图（纯只读，透明度用）。

  app.notFound((c) => c.json({ error: 'not_found' }, 404));

  app.onError((error, c) => {
    console.error('[community-api]', error);
    return c.json({ error: 'internal_error' }, 500);
  });

  return app;
}

// v0.5 零人工：每小时 cron 自动 publish。publish 只产生新版本当内容有变化
// （auto-rate 收敛 + 投票变化），无变化时保持最新版本不动。
async function scheduledAutoPublish(env: Cloudflare.Env): Promise<void> {
  try {
    const before = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM snapshots',
    ).first<{ n: number }>();
    const published = await generateSnapshot(env);
    const after = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM snapshots',
    ).first<{ n: number }>();
    const createdNew = (after?.n ?? 0) > (before?.n ?? 0);
    console.info(
      `[community-api] cron publish: version=${published.version} new=${createdNew}`,
    );
  } catch (error) {
    console.error('[community-api] cron publish failed:', error);
  }
}

export default {
  fetch(request, env) {
    return createApp().fetch(request, env);
  },
  async scheduled(_controller, env) {
    await scheduledAutoPublish(env);
  },
} satisfies ExportedHandler<Cloudflare.Env>;
