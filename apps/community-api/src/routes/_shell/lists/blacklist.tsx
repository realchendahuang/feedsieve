import { createFileRoute } from '@tanstack/react-router';
import { getRosterData } from '@/site/data.functions';
import { pageHead } from '@/site/seo';
import { ListsTabs, ListPageHeader, HelpIcon, fmtDate } from '@/site/pages/lists/lists-common';
import { BlacklistPanel } from '@/site/pages/lists/BlacklistPanel';

export const Route = createFileRoute('/_shell/lists/blacklist')({
  head: (ctx) => {
    const roster = ctx.loaderData as Awaited<ReturnType<typeof getRosterData>> | undefined;
    return pageHead({
      title: '黑名单公示',
      description: 'FeedSieve 黑名单公开镜像：拉黑票与误标票的社区聚合，判定理由与证据帖公示，与扩展执行的名单同源。',
      path: '/lists/blacklist',
      noindex: !roster,
    });
  },
  loader: () => getRosterData(),
  component: BlacklistRoute,
});

function BlacklistRoute() {
  const roster = Route.useLoaderData();

  return (
    <main className="mx-auto max-w-5xl px-[clamp(18px,2.2vw,34px)] pb-16 pt-8">
      <ListPageHeader
        title="黑名单"
        tabs={<ListsTabs />}
        aside={
          <HelpIcon ariaLabel="黑名单说明">
            黑名单是举报与抢救投票的聚合（拉黑票 − 误标票 ≥ 3），反映社区意见，
            不构成对任何账号的事实认定；拉黑始终由扩展用户本人执行。
            <br />
            <a
              href="https://github.com/realchendahuang/feedsieve/blob/main/DISCLAIMER.md"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-block text-gold"
            >
              完整免责声明 →
            </a>
          </HelpIcon>
        }
      />
      {!roster ? (
        <p className="mt-10 text-center text-mist">名单加载失败（快照暂不可用）</p>
      ) : (
        <>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <StatCard label="黑名单总量" value={String(roster.blacklist.count)} />
            <StatCard label="入榜门槛" value="净票 ≥ 3" />
            <StatCard label="快照" value={`${roster.snapshot_version} · ${fmtDate(roster.generated_at)}${roster.signed ? ' · 已签名' : ''}`} small />
          </div>
          <div className="mt-6">
            <BlacklistPanel entries={roster.blacklist.entries} />
          </div>
        </>
      )}
    </main>
  );
}

function StatCard({ label, value, small = false }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="panel-card flex flex-col gap-1 p-5">
      <span className="text-xs font-semibold text-mist">{label}</span>
      <span className={small ? 'break-all text-sm font-bold tabular-nums' : 'text-2xl font-bold tabular-nums'}>
        {value}
      </span>
    </div>
  );
}
