import { Copy, ExternalLink } from 'lucide-react';
import type { AiPublicData } from '@/ai-accounts/public-page';
import type { AiSquareEntry } from '@/ai-accounts/square';
import { HelpIcon } from '../components/SiteHeader';
import { toast } from '../components/ui/toast';
import { xProfileUrl } from '../site';
import { InstallButtons, StoreLinks } from '../components/InstallButtons';
import { initialOf } from '../lib/utils';

const TONE = { ai: '#ff4d6d', mixed: '#e09a00', human: '#16b981' } as const;

/** 广场口径的档位标签：AI 号红 / 疑似 AI 琥珀，始终带文字，不只靠颜色区分 */
const KIND_TONE = {
  ai: { label: 'AI 号', color: '#ff4d6d' },
  suspect: { label: '疑似 AI', color: '#e09a00' },
} as const;

function formatSpan(seconds: number): string {
  const hours = seconds / 3600;
  if (hours < 48) return `${Math.max(1, Math.round(hours))} 小时`;
  return `${Math.round(hours / 24)} 天`;
}

/**
 * AI 味公开结果页：分享出去的链接落在这里。只展示可公开的结论；其余状态引导安装扩展来确认。
 * `detail` 是广场口径的判定详情（互动指标 / 主页画像 / 回复样本），只有结论已公开时才渲染。
 */
export function AiPublicPage({
  data,
  detail = null,
}: {
  data: AiPublicData | null;
  detail?: AiSquareEntry | null;
}) {
  if (!data) {
    return (
      <main className="mx-auto max-w-3xl px-[clamp(18px,2.2vw,34px)] pb-16 pt-12 text-center">
        <p className="text-mist">账号格式不对</p>
      </main>
    );
  }
  const name = data.displayName || `@${data.handle}`;
  const flavor = data.flavor;
  const color =
    flavor?.tone === 'human' || data.state === 'human'
      ? TONE.human
      : data.state === 'contested'
        ? TONE.mixed
        : flavor
          ? TONE[flavor.tone]
          : 'var(--gold)';
  const rhythm = data.lookup.rhythm;
  const votes = data.lookup.votes;
  // 未公开（public=false）以及真人 / 争议 / 待确认状态下，一律不展示分数与样本
  const evidence = data.lookup.public && data.state === 'public' ? detail : null;
  // 档位标签跟随本页自己的公开结论（lookup），避免广场详情与页头结论不一致
  const kind: 'ai' | 'suspect' = data.lookup.verdict === 'suspect' ? 'suspect' : 'ai';
  const kicker =
    data.state === 'human' ? '社区结论' : data.state === 'contested' ? '社区投票' : 'AI 味检测报告';
  return (
    <main className="mx-auto max-w-3xl px-[clamp(18px,2.2vw,34px)] pb-16 pt-10">
      <section className="rounded-[var(--radius)] bg-surface p-[clamp(20px,4vw,40px)] shadow-[var(--panel-elev)]">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-bold" style={{ color }}>
            {kicker}
          </p>
          {evidence ? <KindChip kind={kind} /> : null}
        </div>
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
              {initialOf(name)}
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
            <p
              className="text-7xl font-black leading-none tracking-tight tabular-nums"
              style={{ color }}
            >
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
              <span
                className="rounded-full px-3 py-1 text-sm font-bold text-black"
                style={{ background: color }}
              >
                {flavor.level}
              </span>
            </p>
            <p className="mt-4 text-lg font-semibold text-ink">
              「{data.lookup.comment ?? flavor.roast}」
            </p>
            <dl className="mt-6 grid grid-cols-3 gap-3 border-t border-line/60 pt-4 text-sm">
              <div>
                <dt className="text-mist">回复样本</dt>
                <dd className="mt-1 font-semibold text-ink">
                  {data.lookup.reply_count} 条{rhythm?.authors ? ` · ${rhythm.authors} 人` : ''}
                </dd>
              </div>
              <div>
                <dt className="text-mist">时间跨度</dt>
                <dd className="mt-1 font-semibold text-ink">
                  {rhythm?.span ? formatSpan(rhythm.span) : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-mist">社区投票</dt>
                <dd className="mt-1 font-semibold text-ink">
                  {votes.ai_count} 认为 AI · {votes.human_count} 认为真人
                </dd>
              </div>
            </dl>
          </>
        ) : data.state === 'human' ? (
          <div className="mt-8">
            <p className="text-5xl font-black tracking-tight" style={{ color }}>
              真人
            </p>
            <p className="mt-3 text-lg font-semibold text-ink">
              社区投票认为这是真人，不是 AI 号。
            </p>
            <p className="mt-2 text-mist">
              AI {votes.ai_count} 票 · 真人 {votes.human_count} 票
            </p>
          </div>
        ) : data.state === 'contested' ? (
          <div className="mt-8">
            <p className="text-4xl font-black tracking-tight" style={{ color }}>
              社区争议中
            </p>
            <p className="mt-3 text-lg font-semibold text-ink">
              两边票数接近，继续投票决定；不再由维护者裁决。
            </p>
            <p className="mt-2 text-mist">
              AI {votes.ai_count} 票 · 真人 {votes.human_count} 票
            </p>
          </div>
        ) : data.state === 'public' ? (
          <div className="mt-8">
            <p className="text-2xl font-bold text-ink">社区认为这是 AI</p>
            <p className="mt-2 text-mist">
              还没有可公开的判定分数。AI {votes.ai_count} 票 · 真人 {votes.human_count} 票
            </p>
          </div>
        ) : (
          <div className="mt-8">
            <p className="text-2xl font-bold text-ink">
              {data.state === 'pending' ? '已有人测过，等第二个人确认' : '还没人测过'}
            </p>
            <p className="mt-2 text-mist">
              {data.state === 'pending'
                ? '一个人测出来的结论不公开。再有一位用户测到同样的结果，这里就会显示。'
                : '装上福滤娃，打开 TA 的主页点「AI 味」，就能测 TA 的回复有多少 AI 味。'}
            </p>
          </div>
        )}

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <InstallButtons
            chromeLabel={
              data.state === 'contested'
                ? '装福滤娃，参与投票'
                : data.state === 'pending'
                  ? '装福滤娃，帮忙确认'
                  : '装福滤娃，测你关注的人'
            }
            firefoxLabel="装福滤娃（Firefox 版）"
          />
          {data.state !== 'human' ? (
            <a
              href={`/lists/apply?kind=appeal&handle=${encodeURIComponent(data.handle)}`}
              className="inline-flex h-11 items-center rounded-full px-4 text-sm font-semibold text-mist hover:text-ink"
            >
              这是我的账号，我要申诉
            </a>
          ) : null}
        </div>
      </section>

      {evidence ? (
        <>
          <EvidenceSection entry={evidence} kind={kind} />
          <SamplesSection entry={evidence} />
          <BlockGuide handle={data.handle} />
        </>
      ) : null}

      <p className="mt-4 text-center text-xs text-fog">
        {evidence
          ? '以上内容来自该账号的公开回复，仅供「是否值得屏蔽」参考，不构成事实认定；认为误判可申诉。'
          : '福滤娃读这个账号最近的公开回复，交给模型判一次是不是 AI 代写，仅供娱乐参考，不代表对任何人的评价。'}
      </p>
    </main>
  );
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 绝对日期按 UTC 固定格式：SSR 与浏览器时区不同也不会水合不一致。 */
function dayString(sec: number | null | undefined): string {
  if (sec == null) return '—';
  const d = new Date(sec * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function fmtGap(sec: number | null | undefined): string {
  if (sec == null) return '—';
  if (sec < 60) return `${Math.max(1, Math.round(sec))} 秒`;
  if (sec < 3600) return `${Math.round(sec / 60)} 分钟`;
  if (sec < 86400) return `${(sec / 3600).toFixed(sec < 36000 ? 1 : 0)} 小时`;
  return `${Math.round(sec / 86400)} 天`;
}

function fmtPct(value: number | null | undefined): string {
  return value == null ? '—' : `${Math.round(value * 100)}%`;
}

function copyHandle(handle: string) {
  const text = `@${handle}`;
  const clipboard = typeof navigator === 'undefined' ? null : navigator.clipboard;
  if (!clipboard) {
    toast.info('复制失败，请手动复制');
    return;
  }
  void clipboard.writeText(text).then(
    () => toast.success(`已复制 ${text}`),
    () => toast.info('复制失败，请手动复制'),
  );
}

function KindChip({ kind }: { kind: AiSquareEntry['kind'] }) {
  const meta = KIND_TONE[kind];
  return (
    <span
      className="rounded-full px-2.5 py-0.5 text-[11px] font-bold"
      style={{
        color: meta.color,
        background: `color-mix(in srgb, ${meta.color} 14%, transparent)`,
      }}
    >
      {meta.label}
    </span>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-mist">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold text-ink tabular-nums">{value}</dd>
    </div>
  );
}

/** 「为什么判为 AI」：只列判定用到的互动指标与投票，profile 没采到就整组隐藏（不显示 0）。 */
function EvidenceSection({ entry, kind }: { entry: AiSquareEntry; kind: 'ai' | 'suspect' }) {
  const rhythm = entry.rhythm;
  const metrics: Array<{ label: string; value: string }> = [];
  if (rhythm) {
    if (rhythm.fast != null) metrics.push({ label: '90 秒内回复', value: fmtPct(rhythm.fast) });
    if (rhythm.short != null) metrics.push({ label: '6 字以内回复', value: fmtPct(rhythm.short) });
    if (rhythm.cv != null) metrics.push({ label: '长度变异系数', value: rhythm.cv.toFixed(2) });
    if (rhythm.medianGap != null)
      metrics.push({ label: '中位回复间隔', value: fmtGap(rhythm.medianGap) });
    if (rhythm.span != null) metrics.push({ label: '回复跨度', value: formatSpan(rhythm.span) });
    if (rhythm.authors != null)
      metrics.push({ label: '回复过的博主', value: `${rhythm.authors} 人` });
  }
  metrics.push({
    label: '社区投票',
    value: `AI ${entry.votes.ai_count} · 真人 ${entry.votes.human_count}`,
  });
  metrics.push({ label: '判定时间', value: dayString(entry.judgedAt) });
  const profile = entry.profile;

  return (
    <section className="mt-4 rounded-[var(--radius)] bg-surface p-6 shadow-[var(--panel-elev)]">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-bold text-ink">
          为什么判为{kind === 'suspect' ? '疑似 AI' : ' AI'}
        </h2>
        <HelpIcon ariaLabel="判定依据说明">
          指标来自该账号最近的公开回复：90 秒内回复占比、6
          字以内回复占比、长度变异系数、中位回复间隔。
          与社区投票共同决定是否公示；这是概率判断，不构成事实认定。
        </HelpIcon>
      </div>
      {rhythm ? (
        <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {metrics.map((m) => (
            <Metric key={m.label} label={m.label} value={m.value} />
          ))}
        </dl>
      ) : (
        <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Metric
            label="社区投票"
            value={`AI ${entry.votes.ai_count} · 真人 ${entry.votes.human_count}`}
          />
          <Metric label="判定时间" value={dayString(entry.judgedAt)} />
        </dl>
      )}
      {profile ? (
        <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-line/60 pt-4 sm:grid-cols-4">
          {profile.followers != null ? (
            <Metric label="粉丝" value={profile.followers.toLocaleString('en-US')} />
          ) : null}
          {profile.following != null ? (
            <Metric label="关注" value={profile.following.toLocaleString('en-US')} />
          ) : null}
          {profile.tweets != null ? (
            <Metric label="发帖" value={profile.tweets.toLocaleString('en-US')} />
          ) : null}
          {profile.joinedAt != null ? (
            <Metric label="注册" value={dayString(Math.floor(profile.joinedAt / 1000))} />
          ) : null}
          {profile.verified != null ? (
            <Metric label="蓝V" value={profile.verified ? '有' : '无'} />
          ) : null}
        </dl>
      ) : null}
    </section>
  );
}

/** 最近回复样本：正文 ≤120 字（已由服务端截断，超出时这里补省略号）+ 原帖摘要 + 时间 + 间隔 + 去 X。 */
function SamplesSection({ entry }: { entry: AiSquareEntry }) {
  return (
    <section className="mt-4 rounded-[var(--radius)] bg-surface p-6 shadow-[var(--panel-elev)]">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-bold text-ink">最近回复</h2>
        <HelpIcon ariaLabel="回复样本说明">
          正文是被判定账号的公开回复原文（最多 120 字）；「间隔」是与上一条回复的时间差。
        </HelpIcon>
        {entry.replyCount > 0 ? (
          <span className="ml-auto text-xs text-mist">判定时读了 {entry.replyCount} 条回复</span>
        ) : null}
      </div>
      {entry.samples.length === 0 ? (
        <p className="mt-4 text-sm text-fog">暂无回复样本</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {entry.samples.map((sample) => {
            const truncated = [...sample.text].length >= 120;
            return (
              <li
                key={sample.tweetId}
                className="rounded-[var(--radius-sm)] border border-line/60 p-4"
              >
                <p className="break-words text-sm leading-relaxed text-ink">
                  {sample.text}
                  {truncated ? '…' : ''}
                </p>
                {sample.parentText ? (
                  <p className="mt-1 break-words text-xs text-mist">
                    回复原帖：{sample.parentText}
                  </p>
                ) : null}
                <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-fog">
                  <span>{dayString(sample.postedAt)}</span>
                  {sample.gapSeconds != null ? (
                    <span>距上条 {fmtGap(sample.gapSeconds)}</span>
                  ) : null}
                  <a
                    href={sample.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-semibold text-gold hover:text-gold-deep"
                  >
                    去 X 看
                    <ExternalLink className="size-3" />
                  </a>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** 屏蔽引导：只给复制 / 跳转 / 装扩展的便利，拉黑动作始终由用户本人在 X 上执行。 */
function BlockGuide({ handle }: { handle: string }) {
  return (
    <section className="mt-4 rounded-[var(--radius)] bg-surface p-6 shadow-[var(--panel-elev)]">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-bold text-ink">不想看到它？</h2>
        <HelpIcon ariaLabel="屏蔽说明">
          拉黑由你在 X 上本人操作；站点只提供复制与跳转的便利，不代你执行任何操作。
        </HelpIcon>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => copyHandle(handle)}
          className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full bg-[var(--wash-strong)] px-4 text-xs font-semibold text-ink transition-colors hover:bg-[var(--wash)]"
        >
          <Copy className="size-3.5" />
          复制 @{handle}
        </button>
        <a
          href={xProfileUrl(handle)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-xs font-bold text-primary-foreground transition-opacity hover:opacity-95"
        >
          在 X 上打开
          <ExternalLink className="size-3.5" />
        </a>
        <span className="inline-flex h-9 items-center rounded-full px-4 text-xs text-mist">
          <StoreLinks label="装福滤娃自动折叠" />
        </span>
      </div>
    </section>
  );
}
