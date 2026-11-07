import { createFileRoute } from '@tanstack/react-router';
import { getAiSquareData } from '@/site/data.functions';
import { pageHead } from '@/site/seo';
import { AiSquarePage } from '@/site/pages/AiSquarePage';

/**
 * AI 号广场：可公示的 AI / 疑似 AI 账号聚合（数据与排序见 ai-accounts/square.ts 的 listAiSquare）。
 * 页面本身只做客户端筛选 / 搜索 / 排序。
 */
export const Route = createFileRoute('/_shell/ai/')({
  loader: () => getAiSquareData(),
  head: (ctx) => {
    const data = ctx.loaderData as Awaited<ReturnType<typeof getAiSquareData>> | undefined;
    return pageHead({
      title: 'AI 回复机器人广场',
      description:
        'FeedSieve 社区公示的 AI 回复机器人与疑似 AI 账号：互动节奏、最近公开回复与判定时间，可申诉。',
      path: '/ai',
      noindex: !data,
    });
  },
  component: AiSquareRoute,
});

function AiSquareRoute() {
  const data = Route.useLoaderData();
  return <AiSquarePage data={data} />;
}
