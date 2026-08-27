import { cors } from 'hono/cors';
import { Hono } from 'hono';
import { POLICY, processReportBatch } from './reports';

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
