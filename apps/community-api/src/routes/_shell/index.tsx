import { createFileRoute } from '@tanstack/react-router';
import { pageHead } from '@/site/seo';
import HomePage from '@/site/pages/HomePage';

export const Route = createFileRoute('/_shell/')({
  head: () =>
    pageHead({
      title: '福滤娃 FeedSieve',
      description: '开源的 X（Twitter）垃圾账号清理扩展：高置信垃圾账号黄框标注，一键原生拉黑，全端同步消失。',
      path: '/',
    }),
  component: HomePage,
});
