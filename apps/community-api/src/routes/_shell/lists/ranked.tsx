import { createFileRoute } from '@tanstack/react-router';
import { getRankedData } from '@/site/data.functions';
import { pageHead } from '@/site/seo';
import { ListsTabs, ListPageHeader, HelpIcon } from '@/site/pages/lists/lists-common';
import { RankedPanel } from '@/site/pages/lists/RankedPanel';

export const Route = createFileRoute('/_shell/lists/ranked')({
  head: () =>
    pageHead({
      title: '打野排位赛',
      description: 'FeedSieve 打野排位赛周榜与总榜公示：按共识击杀计分（确认击杀 +1 · 首杀 +1 · 误伤 −2），Top 3 获永久称号「猎黄人」。',
      path: '/lists/ranked',
      ogImage: 'https://feedsieve.win/og/lists/ranked.png?v=1',
    }),
  loader: () => getRankedData(),
  component: RankedRoute,
});

function RankedRoute() {
  const board = Route.useLoaderData();

  return (
    <main className="mx-auto max-w-5xl px-[clamp(18px,2.2vw,34px)] pb-16 pt-8">
      <ListPageHeader
        title="排位赛"
        meta="网页纯观看 · 认领与改名在扩展弹窗「打野」"
        aside={
          <div className="flex items-center gap-3">
            <ListsTabs />
            <HelpIcon ariaLabel="排位赛说明">
              按共识击杀计分：确认击杀 +1、首杀 +1、误伤 −2，误拉黑不计分反而扣分。
              周赛季 ISO 周一开榜，上榜默认匿名（猎手#短码）；Top 3 且命中率 ≥80% 获永久称号「猎黄人」。
            </HelpIcon>
          </div>
        }
      />
      {board ? (
        <div className="mt-6">
          <RankedPanel
            initial={board}
            refetch={(scope) => getRankedData({ data: scope }).then((next) => next ?? board)}
          />
        </div>
      ) : (
        <p className="mt-10 text-center text-mist">榜单加载失败</p>
      )}
    </main>
  );
}
