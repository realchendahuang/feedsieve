import { createFileRoute } from '@tanstack/react-router';
import { getKeywordData } from '@/site/data.functions';
import { pageHead } from '@/site/seo';
import { ListPageHeader, HelpIcon } from '@/site/pages/lists/lists-common';
import { KeywordsPanel } from '@/site/pages/lists/KeywordsPanel';

export const Route = createFileRoute('/_shell/lists/keywords')({
  head: (ctx) => {
    const data = ctx.loaderData as Awaited<ReturnType<typeof getKeywordData>> | undefined;
    return pageHead({
      title: '关键词词库公示',
      description: 'FeedSieve 官方关键词词库全量公示：与扩展执行的黄标规则同源同版本，可匿名贡献新短语。',
      path: '/lists/keywords',
      ogImage: '/og/lists/keywords.png',
      noindex: !data,
    });
  },
  loader: () => getKeywordData(),
  component: KeywordsRoute,
});

function KeywordsRoute() {
  const data = Route.useLoaderData();

  return (
    <main className="mx-auto max-w-5xl px-[clamp(18px,2.2vw,34px)] pb-16 pt-8">
      <ListPageHeader
        title="开源关键词库"
        meta={data ? `共 ${data.total_rules} 条公开规则 · 版本 ${data.pack_version}` : '词库加载失败'}
        aside={
          <HelpIcon ariaLabel="词库说明">
            官方词库包与扩展执行的规则同源同版本（签名发布）；访客可匿名提交新短语，
            先挂待审、运营审阅通过后才进入词库。
          </HelpIcon>
        }
      />
      {data ? (
        <div className="mt-6">
          <KeywordsPanel data={data} />
        </div>
      ) : (
        <p className="mt-10 text-center text-mist">词库加载失败</p>
      )}
    </main>
  );
}
