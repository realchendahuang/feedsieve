/**
 * 官网迁移后的路由守卫（site host）：
 * - 公示页面 → TanStack Start SSR（src/server.ts），纯 Hono 测试入口无法渲染，
 *   页面内容断言迁移到 test/site-components.test.tsx（组件级 renderToString）；
 * - Hono 侧只保留机器路由：/lists.html 301 归一、未知路径 404（绝不落入
 *   管理端 SPA 兜底）。
 * API 侧 /leaderboard HTML 观看页已彻底下线（引流统一走官网 /lists/ranked），
 * 仅保留 /v1/leaderboard 数据端点。
 */

import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';

const SITE_ORIGIN = 'https://feedsieve.test';
const API_ORIGIN = 'https://feedsieve-api.chendahuang.com';

function siteRequest(path: string): Parameters<typeof worker.fetch>[0] {
  return new Request(SITE_ORIGIN + path);
}

describe('site host 公开页（Hono 侧守卫）', () => {
  it('无限未知路径 404，不落入管理端 SPA 兜底', async () => {
    const res = await worker.fetch(siteRequest('/lists'), env);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('/leaderboard 观看页已下线，任意 host 404', async () => {
    const res = await worker.fetch(siteRequest('/leaderboard'), env);
    expect(res.status).toBe(404);
  });
});

describe('API host 不变', () => {
  it('/ 不回退静态资产', async () => {
    const res = await worker.fetch(new Request(API_ORIGIN + '/'), env);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('/leaderboard 观看页已下线', async () => {
    const res = await worker.fetch(new Request(API_ORIGIN + '/leaderboard'), env);
    expect(res.status).toBe(404);
  });

  it('/v1/leaderboard 数据端点仍在', async () => {
    const res = await worker.fetch(new Request(API_ORIGIN + '/v1/leaderboard?scope=week'), env);
    expect(res.status).toBe(200);
  });
});
