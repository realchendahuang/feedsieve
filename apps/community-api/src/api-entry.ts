/**
 * 测试入口：纯 Hono（无 TanStack Start 虚拟模块依赖）。
 * vitest cloudflare 插件的 Miniflare 起这个入口跑全部 API 集——
 * 与 KOSX-Impact 的 api-entry.ts 同款模式。
 */
import { createApp } from './index';
import { scheduledAutoPublish, settleSeasonsScheduled } from './scheduled';
import { probeAccountHealthScheduled } from './prober';

// 路由表与中间件链只构建一次；每请求重建纯属浪费 CPU（env 每次调用传入）。
const app = createApp();

export default {
  // request 入口不带回类型（ExportedHandler 泛型与 miniflare 全局 Request 不兼容，见 index.ts）：
  // 入参以 unknown 收窄，不做 any。
  fetch(request: unknown, env: Cloudflare.Env) {
    return app.fetch(request as Request, env);
  },
  async scheduled(_controller: ScheduledController, env: Cloudflare.Env) {
    await scheduledAutoPublish(env);
    await settleSeasonsScheduled(env);
    await probeAccountHealthScheduled(env);
  },
} satisfies ExportedHandler<Cloudflare.Env>;
