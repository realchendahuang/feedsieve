import { ArrowRight, ExternalLink } from 'lucide-react';
import type { AiPublicData } from '@/ai-accounts/public-page';
import { CHROME_STORE_URL, xProfileUrl } from '../site';

const TONE = { ai: '#ff4d6d', mixed: '#e09a00', human: '#16b981' } as const;

function formatSpan(seconds: number): string {
  const hours = seconds / 3600;
  if (hours < 48) return `${Math.max(1, Math.round(hours))} 小时`;
  return `${Math.round(hours / 24)} 天`;
}

/** AI 味公开结果页：分享出去的链接落在这里。只展示可公开的结论；其余状态引导安装扩展来复核。 */
export function AiPublicPage({ data }: { data: AiPublicData | null }) {
  if (!data) {
    return (
      <main className="mx-auto max-w-3xl px-[clamp(18px,2.2vw,34px)] pb-16 pt-12 text-center">
        <p className="text-mist">账号格式不对</p>
      </main>
    );
  }
  const name = data.displayName || `@${data.handle}`;
  const flavor = data.flavor;
  const color = flavor ? TONE[flavor.tone] : 'var(--gold)';
  const rhythm = data.lookup.rhythm;
  const votes = data.lookup.votes;
  return (
    <main className="mx-auto max-w-3xl px-[clamp(18px,2.2vw,34px)] pb-16 pt-10">
      <section className="rounded-[var(--radius)] bg-surface p-[clamp(20px,4vw,40px)] shadow-[var(--panel-elev)]">
        <p className="text-sm font-bold" style={{ color }}>
          AI 味检测报告
        </p>
        <div className="mt-5 flex items-center gap-4">
          {data.avatarUrl ? (
            <img
              src={data.avatarUrl.replace(/_(normal|bigger|mini|x96)(\.[a-z]+)$/i, '_200x200$2')}
              alt=""
              className="size-16 rounded-full object-cover"
              style={{ boxShadow: `0 0 0 3px ${color}` }}
            />
          ) : (
            <span
              className="grid size-16 place-items-center rounded-full bg-wash-strong text-2xl font-bold text-ink"
              style={{ boxShadow: `0 0 0 3px ${color}` }}
            >
              {[...name.replace(/^@/, '')][0]?.toUpperCase()}
            </span>
          )}
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-bold tracking-tight text-ink">{name}</h1>
            <a
              href={xProfileUrl(data.handle)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-mist hover:text-ink"
            >
              {data.displayName ? `@${data.handle}` : '在 X 上查看'}
              <ExternalLink className="size-3.5" />
            </a>
          </div>
        </div>

        {flavor ? (
          <>
            <p className="mt-8 text-sm font-semibold text-mist">AI 味</p>
            <p className="text-7xl font-black leading-none tracking-tight tabular-nums" style={{ color }}>
              {flavor.percent}
              <span className="ml-1 text-3xl font-extrabold">%</span>
            </p>
            <div
              className="relative mt-5 h-2 rounded-full"
              style={{ background: 'linear-gradient(90deg,#16b981,#e09a00,#ff4d6d)' }}
            >
              <span
                className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow"
                style={{ left: `${flavor.percent}%`, boxShadow: '0 0 0 2px var(--ink)' }}
              />
            </div>
            <p className="mt-6">
              <span className="rounded-full px-3 py-1 text-sm font-bold text-black" style={{ background: color }}>
                {flavor.level}
              </span>
            </p>
            <p className="mt-4 text-lg font-semibold text-ink">「{flavor.roast}」</p>
            <dl className="mt-6 grid grid-cols-3 gap-3 border-t border-line/60 pt-4 text-sm">
              <div>
                <dt className="text-mist">回复样本</dt>
                <dd className="mt-1 font-semibold text-ink">
                  {data.lookup.reply_count} 条{rhythm?.authors ? ` · ${rhythm.authors} 人` : ''}
                </dd>
              </div>
              <div>
                <dt className="text-mist">时间跨度</dt>
                <dd className="mt-1 font-semibold text-ink">{rhythm?.span ? formatSpan(rhythm.span) : '—'}</dd>
              </div>
              <div>
                <dt className="text-mist">社区投票</dt>
                <dd className="mt-1 font-semibold text-ink">
                  {votes.ai_count} 认为 AI · {votes.human_count} 认为真人
                </dd>
              </div>
            </dl>
          </>
        ) : (
          <div className="mt-8">
            <p className="text-2xl font-bold text-ink">
              {data.state === 'pending' ? '已有人测过，等第二个人复核' : data.state === 'review' ? '复核中' : '还没人测过'}
            </p>
            <p className="mt-2 text-mist">
              {data.state === 'pending'
                ? '一个人测出来的结论不公开。再有一位用户测到同样的结果，这里就会显示。'
                : data.state === 'review'
                  ? '有人认为这个账号是真人或提出了申诉，维护者复核前暂停公开。'
                  : '装上福滤娃，打开 TA 的主页点「AI 味」，就能测 TA 的回复有多少 AI 味。'}
            </p>
          </div>
        )}

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <a
            href={CHROME_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-11 items-center gap-2 rounded-full bg-primary px-6 text-sm font-bold text-primary-foreground transition-all hover:opacity-95"
          >
            {data.state === 'pending' ? '装福滤娃，帮忙复核' : '装福滤娃，测你关注的人'}
            <ArrowRight className="size-4" />
          </a>
          <a
            href={`/lists/apply?kind=appeal&handle=${encodeURIComponent(data.handle)}`}
            className="inline-flex h-11 items-center rounded-full px-4 text-sm font-semibold text-mist hover:text-ink"
          >
            这是我的账号，我要申诉
          </a>
        </div>
      </section>
      <p className="mt-4 text-center text-xs text-fog">
        福滤娃读这个账号最近的公开回复，交给模型判一次是不是 AI 代写，仅供娱乐参考，不代表对任何人的评价。
      </p>
    </main>
  );
}
