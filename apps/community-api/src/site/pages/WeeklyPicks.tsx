import { getRouteApi } from '@tanstack/react-router';
import { ArrowRight, BadgeCheck, ChevronUp, MessageCircle, Newspaper } from 'lucide-react';

const homeRoute = getRouteApi('/_shell/');

const KIND_CLS: Record<string, string> = {
  curate: 'bg-gold-surface text-gold',
  self: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-300',
  original: 'bg-wash-strong text-mist',
};

/**
 * 首页「本周 X 精选」：小筛子周刊社区的热帖。周刊是同域另一个 Worker（/weekly），
 * 链接用普通 a 整页跳转。没有数据时整块不渲染。
 */
export function WeeklyPicks() {
  const picks = homeRoute.useLoaderData();
  if (!picks || picks.length === 0) return null;

  return (
    <section className="mt-20">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-gold">
            <Newspaper className="size-4" />
            <span>小筛子周刊 · 福滤娃出品</span>
          </div>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-ink sm:text-3xl">本周 X 精选</h2>
          <p className="mt-2 max-w-xl text-sm text-mist">
            滤掉噪音之后留下的好内容：大家在小筛子周刊里推荐、讨论，每周五精选成刊。
          </p>
        </div>
        <a
          href="/weekly/"
          className="inline-flex h-10 items-center gap-1.5 rounded-full bg-primary px-5 text-sm font-bold text-primary-foreground transition hover:opacity-90"
        >
          逛逛小筛子周刊 <ArrowRight className="size-4" />
        </a>
      </div>

      <div className="mt-8 grid gap-3.5 md:grid-cols-2 lg:grid-cols-3">
        {picks.map((p) => (
          <a key={p.id} href={`/weekly/p/${p.id}`} className="panel-card flex flex-col p-5 transition-all hover:scale-[1.01]">
            <div className="flex items-center gap-2 text-[11px] font-bold">
              <span className={`rounded-md px-1.5 py-px leading-5 ${KIND_CLS[p.kind] ?? KIND_CLS.original}`}>{p.kindLabel}</span>
              {p.board && <span className="text-fog">{p.board}</span>}
              {p.issueNumber && <span className="rounded-md bg-primary px-1.5 py-px leading-5 text-primary-foreground">第 {p.issueNumber} 期</span>}
            </div>
            <h3 className="mt-2.5 line-clamp-2 text-[15px] font-bold leading-snug text-ink">{p.title}</h3>
            {p.source ? (
              <div className="mt-3 rounded-xl bg-soft-surface px-3 py-2.5 text-xs leading-relaxed text-mist ring-1 ring-line/70">
                <div className="flex items-center gap-1 font-bold text-ink">
                  <span className="truncate">{p.source.authorName ?? p.source.authorHandle}</span>
                  {p.source.whitelisted && <BadgeCheck className="size-3.5 shrink-0 text-gold" aria-label="福滤娃白名单" />}
                  {p.source.authorHandle && <span className="truncate font-normal text-fog">@{p.source.authorHandle}</span>}
                </div>
                {p.source.text && <p className="mt-1 line-clamp-2">{p.source.text}</p>}
              </div>
            ) : (
              p.excerpt && <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-mist">{p.excerpt}</p>
            )}
            <div className="mt-auto flex items-center gap-3 pt-4 text-xs font-semibold text-fog">
              <span className="truncate">{p.author?.displayName ?? '访客投稿'}</span>
              <span className="ml-auto inline-flex items-center gap-0.5 text-gold">
                <ChevronUp className="size-3.5" strokeWidth={3} />
                {p.voteCount}
              </span>
              <span className="inline-flex items-center gap-1">
                <MessageCircle className="size-3.5" />
                {p.commentCount}
              </span>
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}
