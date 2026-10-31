import { createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';
import { DefaultError as SiteDefaultError } from '@/site/components/DefaultError';

export function getRouter() {
  const router = createRouter({
    routeTree,
    scrollRestoration: true,
    // loader / 渲染抛错时用中文错误页兜底，而非 TanStack 默认英文原始错误页
    defaultErrorComponent: SiteDefaultError,
    // 智能预加载：鼠标悬停链接 50ms 自动预拉取路由数据，公示篇幅小、秒开易达成
    defaultPreload: 'intent',
    defaultPreloadDelay: 50,
  });
  return router;
}
