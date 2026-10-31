/**
 * 测试入口：纯 Hono（无 TanStack Start 虚拟模块依赖）。
 * vitest cloudflare 插件的 Miniflare 起这个入口跑全部 API 集——
 * 与 KOSX-Impact 的 api-entry.ts 同款模式。
 */
import { createApp } from './index';
import { runScheduledCron } from './scheduled';
import { withDb } from './db/client';

// 路由表与中间件链只构建一次；每请求重建纯属浪费 CPU（env 每次调用传入）。
const app = createApp();

export default {
  // request 入口不带回类型（ExportedHandler 泛型与 miniflare 全局 Request 不兼容，见 index.ts）：
  // 入参以 unknown 收窄，不做 any。
  fetch(request: unknown, env: Cloudflare.Env, ctx: ExecutionContext) {
    return withDb(
      async () => app.fetch(request as Request, env, ctx),
      (p) => ctx.waitUntil(p),
    );
  },
  async scheduled(_controller: ScheduledController, env: Cloudflare.Env, ctx: ExecutionContext) {
    // 与生产入口共用同一编排，新增定时任务不再漂移
    await withDb(
      () => runScheduledCron(env),
      (p) => ctx.waitUntil(p),
    );
  },
} satisfies ExportedHandler<Cloudflare.Env>;
