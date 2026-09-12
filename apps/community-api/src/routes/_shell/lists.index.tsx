import { createFileRoute, redirect } from '@tanstack/react-router';
import { pageHead } from '@/site/seo';

/**
 * /lists 是公示家族的短入口：跳到黑名单页。
 * 公示家族的真路由：/lists/blacklist /lists/whitelist /lists/keywords /lists/ranked /lists/apply。
 */
export const Route = createFileRoute('/_shell/lists/')({
  head: () =>
    pageHead({
      title: '名单公示',
      description: 'FeedSieve 社区名单公开镜像：黑名单与白名单公示、打野周榜、博主宣言入册、误伤申诉。',
      path: '/lists',
    }),
  beforeLoad: () => {
    throw redirect({ to: '/lists/blacklist', replace: true });
  },
  component: () => null,
});
