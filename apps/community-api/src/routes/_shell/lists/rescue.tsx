import { createFileRoute } from '@tanstack/react-router';
import { getRosterData } from '@/site/data.functions';
import { pageHead } from '@/site/seo';
import { ListsTabs, ListPageHeader, HelpIcon } from '@/site/pages/lists/lists-common';
import { RescuePanel } from '@/site/pages/lists/RescuePanel';

export const Route = createFileRoute('/_shell/lists/rescue')({
  head: () =>
    pageHead({
      title: '社区抢救名单公示',
      description: 'FeedSieve 社区抢救公开镜像：被验证为「误标正常」的账号，与扩展执行的豁免口径同源。',
      path: '/lists/rescue',
      ogImage: 'https://feedsieve.win/og/lists/rescue.png?v=1',
    }),
  loader: () => getRosterData(),
  component: RescueRoute,
});

function RescueRoute() {
  const roster = Route.useLoaderData();

  return (
    <main className="mx-auto max-w-5xl px-[clamp(18px,2.2vw,34px)] pb-16 pt-8">
      <ListPageHeader
        title="抢救"
        meta={roster ? `快照 ${roster.snapshot_version}` : undefined}
        aside={
          <div className="flex items-center gap-3">
            <ListsTabs />
            <HelpIcon ariaLabel="抢救名单说明">
              社区抢救记录被验证为「误标正常」的账号：误标票翻案后入册，扩展不会再把该账号标出或拉黑。
            </HelpIcon>
          </div>
        }
      />
      {!roster ? (
        <p className="mt-10 text-center text-mist">名单加载失败（快照暂不可用）</p>
      ) : (
        <div className="mt-6">
          <RescuePanel verified={roster.whitelist.verified} />
        </div>
      )}
    </main>
  );
}
