/**
 * Worker 分发层（剥离自 index.ts 的 catch-all）：
 * API 家族（/v1/* /api/* /healthz）与 /leaderboard 走 Hono；
 * OG 分享图、robots.txt、sitemap.xml 在这里直出；
 * 其余路径返回 null —— 交给 TanStack Start SSR（server.ts）。
 */
import { createApp } from './index';
import { renderOgPng, feedSieveLogo } from './site/og-render';
import { siteOgSvg, listCardOgSvg, type ListOgStat } from './site/og';
import { SITE_URL } from './site/site';
import { getPublicRoster } from './roster';
import { getLeaderboard } from './leaderboard';

// 路由表与中间件链只构建一次；每请求重建纯属浪费 CPU（env 每次调用传入）。
const apiApp = createApp();

/** Hono 白名单之外的机器可读路由（OG / SEO 文件）直出。 */
export async function handleWorkerRoutes(
  request: Request,
  env: Cloudflare.Env,
): Promise<Response | null> {
  const { pathname, origin } = new URL(request.url);

  // API 家族与打野榜页（所有 host 通用，沿用 index.ts 的行为）
  if (
    pathname.startsWith('/v1/') ||
    pathname.startsWith('/api/') ||
    pathname === '/healthz' ||
    pathname === '/leaderboard'
  ) {
    return apiApp.fetch(request, env);
  }

  // 站点文件级路由（SEO / 分享图），只对页面 host 有意义但也无副作用
  if (pathname === '/robots.txt') return robotsTxt();
  if (pathname === '/sitemap.xml') return sitemapXml();
  if (pathname.startsWith('/og/')) {
    return handleOg(request, env, pathname, origin);
  }
  return null;
}

const SITE_PAGES = [
  { path: '/', title: '福滤娃 FeedSieve｜首页' },
  { path: '/guide', title: '使用教程' },
  { path: '/lists/blacklist', title: '黑名单公示' },
  { path: '/lists/whitelist', title: '推荐白名单公示' },
  { path: '/lists/keywords', title: '关键词词库公示' },
  { path: '/lists/ranked', title: '打野排位赛周榜' },
  { path: '/lists/apply', title: '入册申请与误伤申诉' },
  { path: '/leaderboard', title: '打野周榜（观看页）' },
] as const;

function robotsTxt(): Response {
  // /leaderboard 保持 noindex（纯观看页，扩展内未匿名榜不面向搜索）
  return new Response(
    `# FeedSieve 官网公示站
User-agent: *
Allow: /
Disallow: /v1/
Disallow: /api/
Disallow: /leaderboard
`,
    { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } },
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
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
}

async function handleOg(
  request: Request,
  env: Cloudflare.Env,
  pathname: string,
  origin: string,
): Promise<Response | null> {
  const logo = await feedSieveLogo(env, origin);
  const pngHeaders = {
    'Content-Type': 'image/png',
    'Cache-Control': 'public, max-age=1800, s-maxage=7200',
  };
  try {
    if (pathname === '/og/site.png') {
      const roster = await getPublicRoster(env);
      const svg = siteOgSvg(
        {
          blacklistCount: roster?.blacklist.count ?? 0,
          whitelistCount: roster?.whitelist.maintained.length ?? 0,
        },
        logo,
      );
      return new Response(await renderOgPng(env, svg, origin), { headers: pngHeaders });
    }
    const listCard = pathname.match(/^\/og\/lists\/([a-z-]+)\.png$/);
    if (listCard) {
      const key = listCard[1];
      if (!key) return null;
      const stat = await listOgStat(env, key);
      if (!stat) return null;
      const svg = listCardOgSvg(stat, logo);
      return new Response(await renderOgPng(env, svg, origin), { headers: pngHeaders });
    }
    return null;
  } catch {
    // OG 只是分享预览，组件初始化失败等不阻断页面加载
    return null;
  }
}

/** 四张公示卡共用的卡面数据：首页/名单页的取数口径与其 SSR loader 严格同源。 */
async function listOgStat(
  env: Cloudflare.Env,
  page: string,
): Promise<(ListOgStat & { page: string }) | null> {
  const roster = await getPublicRoster(env);
  const base: ListOgStat & { page: string } = {
    page,
    title: '黑名单公示',
    line: '拉黑票 − 误标票 ≥ 3',
    big: `${roster?.blacklist.count ?? 0}`,
    bigLabel: '条黑名单账号',
    sub: roster ? `快照 ${roster.snapshot_version}` : '快照加载中',
  };
  if (page === 'whitelist') {
    base.title = '推荐白名单公示';
    base.big = `${roster?.whitelist.maintained.length ?? 0}`;
    base.bigLabel = '个入册账号';
    base.line = '一票豁免任何标注';
    base.sub = roster ? '社区抢救误标条目同时展示' : '快照加载中';
  } else if (page === 'ranked') {
    const board = await getLeaderboard(env, 'all');
    base.title = '打野排位赛';
    base.big = `${board.rows.length}`;
    base.bigLabel = '累计上榜猎手';
    base.line = '确认击杀 +1 · 首杀 +1 · 误伤 −2';
    base.sub = board.rows.length > 0
      ? board.rows
          .slice(0, 3)
          .map((row, idx) => `${idx + 1}. ${row.name} · ${row.kills} 只野`)
          .join('　')
      : '按共识击杀计分 · 周一开榜';
  } else if (page === 'keywords') {
    base.title = '关键词词库公示';
    base.big = '全量';
    base.bigLabel = '公开规则公示';
    base.line = '与扩展执行的规则同源同版本';
    base.sub = roster ? '官方词库包 · 审阅后入库' : '';
  } else if (page === 'apply') {
    base.title = '入册申请与误伤申诉';
    base.big = '邮箱';
    base.bigLabel = '验证后复核';
    base.line = '每 IP / 每日 20 条额度';
    base.sub = '博主宣言入册或误伤申诉';
  } else if (page !== 'blacklist') {
    return null;
  }
  return base;
}
