/**
 * OG 分享图路由：/og/site.png、/og/ai/{handle}.png、/og/lists/{page}.png。
 *
 * 单独成模块只为一件事：光栅化要拉 @resvg/resvg-wasm 与它的 wasm 模块，那是启动路径上
 * 最重的一块，而分享图只有爬虫和分享卡片会请求。api.ts 用动态 import 接进来，
 * 让扩展上报的 /v1/* 冷启动不必为它买单。
 */
import { renderOgPng, feedSieveLogo } from './og-render';
import { aiCardOgSvg, siteOgSvg, listCardOgSvg, type ListOgStat } from './og';
import { getAiPublic } from '../ai-accounts/public-page';
import { getPublicRoster } from '../roster';

export async function handleOg(
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
    const aiCard = pathname.match(/^\/og\/ai\/([A-Za-z0-9_]{1,15})\.png$/);
    if (aiCard) {
      const data = await getAiPublic(env, aiCard[1]!);
      if (!data) return null;
      const svg = aiCardOgSvg({
        handle: data.handle,
        displayName: data.displayName,
        avatar: await avatarDataUri(data.avatarUrl),
        state: data.state,
        aiVotes: data.lookup.votes.ai_count,
        humanVotes: data.lookup.votes.human_count,
        ...(data.flavor
          ? {
              percent: data.flavor.percent,
              tone: data.flavor.tone,
              level: data.flavor.level,
              roast: data.flavor.roast,
              replyCount: data.lookup.reply_count,
            }
          : {}),
      });
      // 结论会变（确认 / 争议 / 重测）：边缘只缓存 10 分钟
      return new Response(await renderOgPng(env, svg, origin), {
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=600, s-maxage=600',
        },
      });
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

/** 头像（只认 pbs.twimg.com）→ data URI，换成 400×400 大图；读不到返回 null 画首字母 */
async function avatarDataUri(url: string | null): Promise<string | null> {
  if (!url || !/^https:\/\/pbs\.twimg\.com\//.test(url)) return null;
  const large = url.replace(/_(normal|bigger|mini|x96|200x200)(\.[a-z]+)$/i, '_400x400$2');
  try {
    const res = await fetch(large, { signal: AbortSignal.timeout(3_000) });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? 'image/jpeg';
    if (!/^image\/(jpeg|png|webp)/.test(type)) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000)
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return `data:${type.split(';')[0]};base64,${btoa(bin)}`;
  } catch {
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
    base.sub = roster ? '与扩展执行豁免口径同源' : '快照加载中';
  } else if (page === 'rescue') {
    base.title = '社区抢救名单公示';
    base.big = `${roster?.whitelist.verified.length ?? 0}`;
    base.bigLabel = '条抢救记录';
    base.line = '误标被推翻的账号';
    base.sub = roster ? '与扩展执行豁免口径同源' : '快照加载中';
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
    base.line = '邮箱验证后进维护者复核队列';
    base.sub = '博主宣言入册或误伤申诉';
  } else if (page !== 'blacklist') {
    return null;
  }
  return base;
}
