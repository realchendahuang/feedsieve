import { createFileRoute } from '@tanstack/react-router';
import { getRosterData } from '@/site/data.functions';
import { pageHead } from '@/site/seo';
import { ListsTabs, ListPageHeader, HelpIcon } from '@/site/pages/lists/lists-common';
import { WhitelistPanel } from '@/site/pages/lists/WhitelistPanel';

export const Route = createFileRoute('/_shell/lists/whitelist')({
  head: () =>
    pageHead({
      title: '推荐白名单公示',
      description: 'FeedSieve 推荐白名单与社区抢救公开镜像：博主宣言入册与误标回归，与扩展执行的豁免口径同源。',
      path: '/lists/whitelist',
      ogImage: 'https://feedsieve.win/og/lists/whitelist.png?v=1',
    }),
  loader: () => getRosterData(),
  component: WhitelistRoute,
});

function WhitelistRoute() {
  const roster = Route.useLoaderData();

  return (
    <main className="mx-auto max-w-5xl px-[clamp(18px,2.2vw,34px)] pb-16 pt-8">
      <ListPageHeader
        title="白名单"
        meta={roster ? `快照 ${roster.snapshot_version}` : undefined}
        aside={
          <div className="flex items-center gap-3">
            <ListsTabs />
            <HelpIcon ariaLabel="白名单说明">
              白名单 = 推荐白名单（维护者入册）+ 社区抢救（被验证为「误标正常」的账号）。任一杯列入册后，
              扩展在任何识别强度下都不会把该账号标出或拉黑。
            </HelpIcon>
          </div>
        }
      />
      {!roster ? (
        <p className="mt-10 text-center text-mist">名单加载失败（快照暂不可用）</p>
      ) : (
        <div className="mt-6">
          <WhitelistPanel maintained={roster.whitelist.maintained} verified={roster.whitelist.verified} />
        </div>
      )}
    </main>
  );
}
