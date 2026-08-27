import { cors } from 'hono/cors';
import { Hono } from 'hono';
import { checkBearerToken } from './lib/auth';
import { POLICY, processReportBatch } from './reports';
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

  app.notFound((c) => c.json({ error: 'not_found' }, 404));

  app.onError((error, c) => {
    console.error('[community-api]', error);
    return c.json({ error: 'internal_error' }, 500);
  });

  return app;
}

export default {
  fetch(request, env) {
    return createApp().fetch(request, env);
  },
} satisfies ExportedHandler<Cloudflare.Env>;
