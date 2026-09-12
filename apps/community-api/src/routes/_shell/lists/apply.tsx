import { createFileRoute } from '@tanstack/react-router';
import { pageHead } from '@/site/seo';
import ApplyPage from '@/site/pages/lists/ApplyPage';

export const Route = createFileRoute('/_shell/lists/apply')({
  head: () =>
    pageHead({
      title: '提交申请',
      description: 'FeedSieve 名单公示申请：推荐白名单自荐（博主宣言入册）与误伤申诉，邮箱验证后进维护者复核队列。',
      path: '/lists/apply',
      ogImage: 'https://feedsieve.win/og/lists/apply.png?v=1',
    }),
  component: ApplyPage,
});
