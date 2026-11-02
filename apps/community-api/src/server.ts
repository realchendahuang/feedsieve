/**
 * Worker 入口（wrangler main）：
 * - fetch：API 家族 / OG 分享图 / robots.txt / sitemap.xml 走 Hono 分发层
 *   （handleWorkerRoutes），其余路径交给 TanStack Start 的 Nitro handler 做 SSR。
 *   所有 Worker 响应统一注入安全响应头；页面 HTML 再加一层短边缘缓存
 *   （名单数据端点自身带 5 分钟缓存，HTML 60s 窗口内的延迟可接受）。
 * - scheduled：整点 cron 全量编排（清理、规则静音、快照、死账号探活），半点只发快照。
 */
import { handleWorkerRoutes } from './api';
import { isAdminHost, isSiteHost } from './lib/hosts';
import { withDb } from './db/client';

// Nitro 入口的 fetch 在 Cloudflare 上接收 (request, env, ctx)，
// 其自带类型按通用平台声明为 (request, opts)，这里做一次桥接
type SsrFetch = (request: Request, env: Cloudflare.Env, ctx: ExecutionContext) => Promise<Response>;

/**
 * TanStack Start 的 Nitro handler 是整台 Worker 最重的一块，却只有页面 HTML 用得到。
 * 顶层 import 会让 `/v1/*`（扩展上报，占全部流量的九成以上）的每次冷启动都先求值
 * 整个 SSR 运行时，而冷启动正是这台 Worker 的主要 CPU 开销。
 */
let ssrFetchPromise: Promise<SsrFetch> | null = null;

function loadSsrFetch(): Promise<SsrFetch> {
  // 失败不缓存 rejected promise：否则一次瞬时错误会把整台 isolate 永久钉死。
  ssrFetchPromise ??= import('@tanstack/react-start/server-entry').then(
    (mod) => mod.default.fetch as unknown as SsrFetch,
    (error) => {
      ssrFetchPromise = null;
      throw error;
    },
  );
  return ssrFetchPromise;
}

/** 基线安全响应头：站点有表单 POST 与大量外链，全响应统一注入 */
const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'X-Frame-Options': 'SAMEORIGIN',
  // CSP 基线：站点有用户提交内容渲染（宣言/贡献短语）。TanStack Start 的
  // 水合数据走内联 <script>，主题启动脚本也是内联的——script-src 必须留
  // 'unsafe-inline'（nonce 需要改 Nitro 渲染管线，收益不成比例）；其余
  // 面向（object/frame/base/form）全部收死。页面 fetch 全部同源相对路径。
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'; " +
    "frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'",
};

/** 包一层新 Response 注入安全头（不动缓存里已存的副本） */
function withSecurityHeaders(res: Response): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
  return out;
}

const htmlCache = (caches as unknown as { default: Cache }).default;

/**
 * SSR 页面短边缘缓存：GET + 200 + text/html 才进缓存；max-age=0 让浏览器每次回边缘。
 * 键显式带 host：Cache API 在同一 zone 的多个自定义域名之间共享键空间
 * （feedsieve.win 与 api.feedsieve.win），直接 cache.match(请求) 会把 SSR 页面
 * 串到 API 域名的 URL 上，必须用合成键隔离。
 */
function htmlCacheKey(request: Request): Request | URL | string {
  const url = new URL(request.url);
  return `https://site-cache.feedsieve.internal${url.pathname}${url.search}`;
}

async function cachedHtml(
  request: Request,
  ctx: { waitUntil: (p: Promise<unknown>) => void },
  build: () => Promise<Response>,
): Promise<Response> {
  if (request.method !== 'GET') return build();
  const key = htmlCacheKey(request);
  const hit = await htmlCache.match(key);
  if (hit) return hit;
  const res = await build();
  if (res.status === 200 && (res.headers.get('Content-Type') ?? '').includes('text/html')) {
    // 出站响应标记 private/s-maxage=0：CF 自动 Worker 缓存（cache.enabled）在同一
    // zone 的多个自定义域名间按「去 host」URL 键共享空间，绝不能让它缓存 SSR HTML，
    // 否则页面会串到 API 域名的同路径 URL 上。边缘缓存由我们手动做：
    // 存入缓存的副本才带 fresh TTL，键用 .internal 合成前缀，与真实 URL 键空间隔离。
    // body 只能读一次（bodyBuf），served 与 cached 各持独立副本。
    // TTL 300s、stale-while-revalidate 4h：公示数据随快照日更，60s 重渲染纯浪费。
    const bodyBuf = await res.arrayBuffer();
    const cached = new Response(bodyBuf.slice(0), res);
    cached.headers.set(
      'Cache-Control',
      'public, s-maxage=300, stale-while-revalidate=14400, max-age=0',
    );
    // 写缓存走 waitUntil，不阻塞响应回边缘
    ctx.waitUntil(htmlCache.put(key, new Response(bodyBuf.slice(0), cached)));
    const served = new Response(bodyBuf.slice(0), res);
    served.headers.set('Cache-Control', 'private, max-age=0, must-revalidate');
    return served;
  }
  return res;
}

function jsonNotFound(): Response {
  return new Response(JSON.stringify({ error: 'not_found' }), {
    status: 404,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // 显式 no-store：自动 zone 缓存绝不触碰任何 4xx/门控响应
      'Cache-Control': 'no-store',
    },
  });
}

export default {
  fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext): Promise<Response> {
    // 整个请求（API、SSR 与其中的 server function）共用一个数据库作用域，响应后关闭连接
    return withDb(
      () => handleFetch(request, env, ctx),
      (p) => ctx.waitUntil(p),
    );
  },
  async scheduled(event: ScheduledController, env: Cloudflare.Env, ctx: ExecutionContext) {
    await withDb(
      async () => {
        // 一天只跑 48 次，没必要让它进 `/v1/*` 的启动路径。
        const { runScheduledCron } = await import('./scheduled');
        await runScheduledCron(env, event.cron);
      },
      (p) => ctx.waitUntil(p),
    );
  },
} satisfies ExportedHandler<Cloudflare.Env>;

async function handleFetch(
  request: Request,
  env: Cloudflare.Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const workerRes = await handleWorkerRoutes(request, env, ctx);
  if (workerRes) return withSecurityHeaders(workerRes);

  // host 门控与原来 index.ts catch-all 完全一致：
  // - 官网 host：先接住静态资产（assets run_worker_first 会把 /assets /fonts 也送进
  //   Worker，直接转 ASSETS；漏了这一步 SSR 会把 CSS/字体吞成 404），再 SSR 其余路径
  //   （TanStack SSR 路由树）
  // - 管理 host：ASSETS 绑定（admin SPA 单页兜底）
  // - 未配置 host / API host：JSON 404，不暴露管理 SPA
  if (isSiteHost(request, env)) {
    const { pathname } = new URL(request.url);
    if ((pathname.startsWith('/assets/') || pathname.startsWith('/fonts/')) && env.ASSETS) {
      return withSecurityHeaders(await env.ASSETS.fetch(request));
    }
    return cachedHtml(request, ctx, async () =>
      withSecurityHeaders(await (await loadSsrFetch())(request, env, ctx)),
    );
  }
  if (isAdminHost(request, env) && env.ASSETS) {
    return withSecurityHeaders(await env.ASSETS.fetch(request));
  }
  return withSecurityHeaders(jsonNotFound());
}
