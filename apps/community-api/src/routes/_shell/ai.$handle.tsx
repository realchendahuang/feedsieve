import { createFileRoute } from '@tanstack/react-router';
import { getAiPublicData } from '@/site/data.functions';
import { pageHead } from '@/site/seo';
import { SITE_URL } from '@/site/site';
import { AiPublicPage } from '@/site/pages/AiPublicPage';

/** AI 味公开结果页：分享链接落地页，带头像 OG 预览图（/og/ai/:handle.png） */
export const Route = createFileRoute('/_shell/ai/$handle')({
  loader: ({ params }) => getAiPublicData({ data: { handle: params.handle } }),
  head: (ctx) => {
    const data = ctx.loaderData as Awaited<ReturnType<typeof getAiPublicData>> | undefined;
    const handle = data?.handle ?? ctx.params.handle.replace(/^@/, '').toLowerCase();
    const name = data?.displayName || `@${handle}`;
    const description = data?.flavor
      ? `${name} 的回复 AI 味 ${data.flavor.percent}%：${data.flavor.level}。「${data.flavor.roast}」`
      : `测测 ${name} 的回复有多少 AI 味：福滤娃读最近的公开回复，交给模型判一次。`;
    return pageHead({
      title: data?.flavor ? `${name} 的 AI 味 ${data.flavor.percent}%` : `${name} 的 AI 味检测`,
      description,
      path: `/ai/${handle}`,
      // 结论会变：每次带上判定时间做缓存破坏
      ogImage: `${SITE_URL}/og/ai/${handle}.png?t=${data?.lookup.judged_at ?? 0}-${data?.state ?? 'none'}`,
      noindex: !data || data.state !== 'public',
    });
  },
  component: AiRoute,
});

function AiRoute() {
  const data = Route.useLoaderData();
  return <AiPublicPage data={data} />;
}
