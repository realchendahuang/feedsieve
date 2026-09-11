/**
 * 官网合并后的路由守卫（site host）：
 * - SITE_HOST 上：/ 与 /lists 返回内嵌 HTML；/lists.html 301 归一；
 *   未知路径 404（绝不落入管理端 SPA 兜底）；/leaderboard 各 host 通用。
 * - API host 上：/ 不再回退静态资产，404 保持不变。
 */

import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';

const SITE_ORIGIN = 'https://feedsieve.test';
const API_ORIGIN = 'https://feedsieve-api.chendahuang.com';

function siteRequest(path: string): Parameters<typeof worker.fetch>[0] {
  return new Request(SITE_ORIGIN + path);
}

describe('site host 公开页', () => {
  it('/ 返回首页', async () => {
    const res = await worker.fetch(siteRequest('/'), env);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('福滤娃 FeedSieve');
  });

  it('/lists 返回公示页（无扩展名路径）', async () => {
    const res = await worker.fetch(siteRequest('/lists'), env);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('名单公示');
  });

  it('公示页排位赛 tab：周榜/总榜切换与 X ID/称号阶梯渲染', async () => {
    const html = await (await worker.fetch(siteRequest('/lists'), env)).text();
    expect(html).toContain('id="ranked-tab-week"');
    expect(html).toContain('id="ranked-tab-all"');
    expect(html).toContain('rankedScope');
    expect(html).toContain('huluBadge');
    expect(html).toContain("row.x_handle");
    expect(html).toContain("row.tier");
  });

  it('/lists.html 301 归一到 /lists', async () => {
    const res = await worker.fetch(siteRequest('/lists.html'), env);
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('/lists');
  });

  it('未知路径 404，不落入管理端 SPA', async () => {
    const res = await worker.fetch(siteRequest('/some-admin-route'), env);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('/leaderboard 在 site host 上同样可用', async () => {
    const res = await worker.fetch(siteRequest('/leaderboard'), env);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('id="tab-week"');
  });
});

describe('API host 不变', () => {
  it('/ 不回退静态资产', async () => {
    const res = await worker.fetch(new Request(API_ORIGIN + '/'), env);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('/leaderboard 仍可用', async () => {
    const res = await worker.fetch(new Request(API_ORIGIN + '/leaderboard'), env);
    expect(res.status).toBe(200);
  });
});
