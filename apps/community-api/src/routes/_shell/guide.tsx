import { createFileRoute } from '@tanstack/react-router';
import GuidePage from '@/site/pages/GuidePage';
import { pageHead } from '@/site/seo';

export const Route = createFileRoute('/_shell/guide')({
  head: () =>
    pageHead({
      title: '使用教程',
      description: 'FeedSieve 使用教程：安装、上手四步、设置项、批量拉黑安全边界与常见问题。',
      path: '/guide',
    }),
  component: GuidePage,
});
