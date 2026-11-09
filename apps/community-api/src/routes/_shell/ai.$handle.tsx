import { createFileRoute } from '@tanstack/react-router';
import { getAiPublicData, getAiSquareDetail } from '@/site/data.functions';
import { pageHead } from '@/site/seo';
import { SITE_URL } from '@/site/site';
import { AiPublicPage } from '@/site/pages/AiPublicPage';

type PageLoaderData = {
  data: Awaited<ReturnType<typeof getAiPublicData>>;
  detail: Awaited<ReturnType<typeof getAiSquareDetail>>;
};

/** AI 味公开结果页：分享链接落地页，带头像 OG 预览图（/og/ai/:handle.png） */
export const Route = createFileRoute('/_shell/ai/$handle')({
  loader: async ({ params }): Promise<PageLoaderData> => {
    // 公开结论与广场详情并行取：详情只对可公示账号有值，用来补「为什么判为 AI」与回复样本
    const [data, detail] = await Promise.all([
      getAiPublicData({ data: { handle: params.handle } }),
      getAiSquareDetail({ data: { handle: params.handle } }),
    ]);
    return { data, detail };
  },
  head: (ctx) => {
    const loaded = ctx.loaderData as PageLoaderData | undefined;
    const data = loaded?.data;
    const audit = loaded?.detail?.audit ?? null;
    const handle = data?.handle ?? ctx.params.handle.replace(/^@/, '').toLowerCase();
    const name = loaded?.detail?.displayName || data?.displayName || `@${handle}`;
    // 只有维护者审计收录、没有可公示结论：标题和描述按审计口径，别让分享链接读成「AI 味检测」
    if (
      audit &&
      data &&
      data.state !== 'public' &&
      data.state !== 'human' &&
      data.state !== 'contested'
    ) {
      return pageHead({
        title: `${name} · 维护者审计收录`,
        description: `维护者审计收录的 AI 回复机器人：${audit.note.slice(0, 80)}`,
        path: `/ai/${handle}`,
        noindex: true,
      });
    }
    const description = data?.flavor
      ? `${name} 的回复 AI 味 ${data.flavor.percent}%：${data.flavor.level}。${
          data.lookup.comment ? `「${data.lookup.comment}」` : ''
        }`
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
  const { data, detail } = Route.useLoaderData();
  return <AiPublicPage data={data} detail={detail} />;
}
