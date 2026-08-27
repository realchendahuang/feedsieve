import { Hono } from 'hono';

export function createApp() {
  const app = new Hono<{ Bindings: Cloudflare.Env }>();

  app.get('/healthz', (c) =>
    c.json({
      ok: true,
      service: 'feedsieve-community-api',
      time: new Date().toISOString(),
    }),
  );

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
