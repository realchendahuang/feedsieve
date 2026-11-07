/**
 * Worker 分发层（剥离自 index.ts 的 catch-all）：
 * API 家族（/v1/* /api/* /healthz）走 Hono；
 * OG 分享图、robots.txt、sitemap.xml 在这里直出；
 * 其余路径返回 null —— 交给 TanStack Start SSR（server.ts）。
 *
 * OG 卡单独放在 ./site/og-routes：它要加载 resvg 的 wasm 光栅化器，属于启动路径上
 * 最重的一块，而分享图只有爬虫与分享卡片会请求。放在这里动态 import，
 * 扩展上报（/v1/*，占流量九成以上）的冷启动就不必为它买单。
 */
import { createApp } from './index';
import { SITE_URL } from './site/site';

// 路由表与中间件链只构建一次；每请求重建纯属浪费 CPU（env 每次调用传入）。
const apiApp = createApp();

/** Hono 白名单之外的机器可读路由（OG / SEO 文件）直出。 */
export async function handleWorkerRoutes(
  request: Request,
  env: Cloudflare.Env,
  ctx?: ExecutionContext,
): Promise<Response | null> {
  const { pathname, origin } = new URL(request.url);

  // API 家族（所有 host 通用，沿用 index.ts 的行为）
  if (pathname.startsWith('/v1/') || pathname.startsWith('/api/') || pathname === '/healthz') {
    return apiApp.fetch(request, env, ctx);
  }

  // 站点文件级路由（SEO / 分享图），只对页面 host 有意义但也无副作用
  if (pathname === '/robots.txt') return robotsTxt();
  if (pathname === '/sitemap.xml') return sitemapXml();
  if (pathname.startsWith('/og/')) {
    const { handleOg } = await import('./site/og-routes');
    return handleOg(request, env, pathname, origin);
  }
  return null;
}

const SITE_PAGES = [
  { path: '/', title: '福滤娃 FeedSieve｜首页' },
  { path: '/guide', title: '使用教程' },
  { path: '/ai', title: 'AI 号广场' },
  { path: '/lists/blacklist', title: '黑名单公示' },
  { path: '/lists/whitelist', title: '推荐白名单公示' },
  { path: '/lists/rescue', title: '社区抢救名单公示' },
  { path: '/lists/keywords', title: '关键词词库公示' },
  { path: '/lists/apply', title: '入册申请与误伤申诉' },
] as const;

function robotsTxt(): Response {
  return new Response(
    `# FeedSieve 官网公示站
User-agent: *
Allow: /
Disallow: /v1/
Disallow: /api/
`,
    {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
      },
    },
  );
}

function sitemapXml(): Response {
  const today = new Date().toISOString().slice(0, 10);
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${SITE_PAGES.map(
  (page) =>
    `  <url><loc>${SITE_URL}${page.path}</loc><lastmod>${today}</lastmod><changefreq>hourly</changefreq><priority>${page.path === '/' ? '1.0' : '0.8'}</priority></url>`,
).join('\n')}
</urlset>`;
  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
