import { createFileRoute } from '@tanstack/react-router';
import { getKeywordData } from '@/site/data.functions';
import { pageHead } from '@/site/seo';
import { ListsTabs, ListPageHeader, HelpIcon } from '@/site/pages/lists/lists-common';
import { KeywordsPanel } from '@/site/pages/lists/KeywordsPanel';

export const Route = createFileRoute('/_shell/lists/keywords')({
  head: () =>
    pageHead({
      title: '关键词词库公示',
      description: 'FeedSieve 官方关键词词库全量公示：与扩展执行的黄标规则同源同版本，可匿名贡献新短语。',
      path: '/lists/keywords',
      ogImage: 'https://feedsieve.win/og/lists/keywords.png?v=1',
    }),
  loader: () => getKeywordData(),
  component: KeywordsRoute,
});

function KeywordsRoute() {
  const data = Route.useLoaderData();

  return (
    <main className="mx-auto max-w-5xl px-[clamp(18px,2.2vw,34px)] pb-16 pt-8">
      <ListPageHeader
        title="词库"
        meta={data ? undefined : '词库加载失败'}
        aside={
          <div className="flex items-center gap-3">
            <ListsTabs />
            <HelpIcon ariaLabel="词库说明">
              官方词库包与扩展执行的规则同源同版本（签名发布）；访客可匿名提交新短语，
              先挂待审、运营审阅通过后才进入词库（每 IP 每日 5 条）。
            </HelpIcon>
          </div>
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
