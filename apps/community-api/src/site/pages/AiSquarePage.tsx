import { useMemo, useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { Copy, ExternalLink } from 'lucide-react';
import { categoryLabel } from '@feedsieve/shared';
import type { AiSquareAudit, AiSquareData, AiSquareEntry } from '@/ai-accounts/square';
import { HelpIcon } from '@/site/components/SiteHeader';
import { toast } from '@/site/components/ui/toast';
import { ListPageHeader } from '@/site/pages/lists/lists-common';
import { GITHUB_URL, xProfileUrl } from '@/site/site';
import { StoreLinks } from '@/site/components/InstallButtons';
import { initialOf } from '@/site/lib/utils';

/** 「AI 号」与「疑似」的语义色：红 / 琥珀（同站点 AI 味报告的 ai / mixed），且始终带文字标签，不只靠颜色。 */
const KIND = {
  ai: { label: 'AI 号', color: '#ff4d6d' },
  suspect: { label: '疑似 AI', color: '#e09a00' },
} as const;

const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'ai', label: 'AI 号' },
  { key: 'suspect', label: '疑似 AI' },
  { key: 'audit', label: '维护者审计' },
  { key: 'listed', label: '已进名单' },
] as const;
type FilterKey = (typeof FILTERS)[number]['key'];

const SORTS = [
  { key: 'default', label: '名单优先' },
  { key: 'score', label: '分数高到低' },
  { key: 'recent', label: '最近判定' },
] as const;
type SortKey = (typeof SORTS)[number]['key'];

const pad = (n: number) => String(n).padStart(2, '0');

/** 判定时间等展示用：按 UTC 固定格式，避免 SSR 与浏览器时区不同造成水合不一致。 */
function dayString(sec: number | null | undefined): string {
  if (sec == null) return '—';
  const d = new Date(sec * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** 相对时间只相对数据生成时刻算（服务器给定），同样保证 SSR/客户端一致。 */
function agoString(sec: number | null | undefined, nowSec: number): string {
  if (sec == null) return '—';
  const diff = Math.max(0, nowSec - sec);
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.round(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.round(diff / 3600)} 小时前`;
  if (diff < 86400 * 30) return `${Math.round(diff / 86400)} 天前`;
  return dayString(sec);
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

/** 复制内容的唯一来源：每行一个 @handle（导出给单测断言口径） */
export function handlesToClipboard(handles: readonly string[]): string {
  return handles.map((handle) => `@${handle}`).join('\n');
}

/** 复制当前筛选结果的全部 handle，方便去 X 的屏蔽列表批量粘贴 */
function copyHandles(handles: readonly string[]) {
  const text = handlesToClipboard(handles);
  const clipboard = typeof navigator === 'undefined' ? null : navigator.clipboard;
  if (!clipboard) {
    toast.info('复制失败，请手动复制');
    return;
  }
  void clipboard.writeText(text).then(
    () => toast.success(`已复制 ${handles.length} 个 handle`),
    () => toast.info('复制失败，请手动复制'),
  );
}

function avatarUrlOf(entry: AiSquareEntry): string | null {
  return entry.avatarUrl?.replace(/_(normal|bigger|mini|x96)(\.[a-z]+)$/i, '_200x200$2') ?? null;
}

/**
 * AI 号广场（/ai）：可公示的 AI / 疑似 AI 账号聚合。
 * 数据与排序由 SSR loader 给出（listAiSquare 已按 listed → score → handle 排好），
 * 本页只做客户端筛选 / 搜索 / 显式排序。文案克制：说明收进 ! 悬浮。
 */
export function AiSquarePage({ data }: { data: AiSquareData | null }) {
  const [filter, setFilter] = useState<FilterKey>('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('default');

  const rows = useMemo(() => {
    if (!data) return [];
    let list = data.entries;
    if (filter === 'ai') list = list.filter((e) => e.kind === 'ai' && e.origin !== 'maintainer');
    else if (filter === 'suspect') list = list.filter((e) => e.kind === 'suspect');
    else if (filter === 'audit') list = list.filter((e) => e.audit != null);
    else if (filter === 'listed') list = list.filter((e) => e.listed);
    const q = query.trim().toLowerCase().replace(/^@/, '');
    if (q) {
      list = list.filter(
        (e) => e.handle.includes(q) || (e.displayName ?? '').toLowerCase().includes(q),
      );
    }
    if (sort === 'score') list = [...list].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    else if (sort === 'recent')
      list = [...list].sort((a, b) => (b.judgedAt ?? 0) - (a.judgedAt ?? 0));
    return list;
  }, [data, filter, query, sort]);

  const counts = data?.counts;
  const now = data?.generatedAt ?? 0;

  return (
    <main className="mx-auto max-w-5xl px-[clamp(18px,2.2vw,34px)] pb-16 pt-8">
      <ListPageHeader
        title="AI 号广场"
        aside={
          <HelpIcon ariaLabel="AI 号广场说明">
            收录社区投票、模型判定与维护者审计收录的 AI / 疑似 AI 账号，按公共名单与分数排序。
            <br />
            内容来自这些账号的公开回复与维护者审计说明，仅供「是否值得屏蔽」参考，不构成事实认定；误判可申诉。
            <br />
            <a
              href={`${GITHUB_URL}/blob/main/DISCLAIMER.md`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-block text-gold"
            >
              完整免责声明 →
            </a>
          </HelpIcon>
        }
      />

      {!data ? (
        <p className="mt-10 text-center text-mist">广场数据加载失败，请稍后刷新</p>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <StatCard label="总数" value={counts?.all ?? 0} />
            <StatCard label="AI 号" value={counts?.ai ?? 0} tone={KIND.ai.color} />
            <StatCard label="疑似" value={counts?.suspect ?? 0} tone={KIND.suspect.color} />
            <StatCard label="维护者审计" value={counts?.audit ?? 0} tone="var(--gold)" />
            <StatCard label="已进公共名单" value={counts?.listed ?? 0} />
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap items-center gap-1" role="group" aria-label="筛选账号">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  aria-pressed={filter === f.key}
                  onClick={() => setFilter(f.key)}
                  className={`h-8 cursor-pointer rounded-full px-3.5 text-xs font-semibold transition-colors ${
                    filter === f.key
                      ? 'bg-surface text-ink shadow-[var(--panel-elev)]'
                      : 'text-mist hover:text-ink'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div className="ml-auto flex items-center gap-2">
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                aria-label="排序"
                className="h-9 cursor-pointer rounded-full border border-line bg-surface px-3 text-xs font-semibold text-mist outline-none focus:border-gold focus:ring-[3px] focus:ring-ring/30"
              >
                {SORTS.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜账号"
                aria-label="搜索账号"
                className="h-9 w-44 rounded-full border border-line bg-surface px-4 text-sm outline-none focus:border-gold focus:ring-[3px] focus:ring-ring/30"
              />
              <button
                type="button"
                disabled={rows.length === 0}
                onClick={() => copyHandles(rows.map((entry) => entry.handle))}
                className="h-9 cursor-pointer rounded-full border border-line bg-surface px-3.5 text-xs font-semibold text-mist transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
              >
                复制全部（{rows.length}）
              </button>
            </div>
          </div>

          {data.entries.length === 0 ? (
            <EmptyState
              title="广场暂时没有可公示的账号"
              hint="装上福滤娃，测一个你怀疑的账号，社区确认后会出现在这里。"
            />
          ) : rows.length === 0 ? (
            <EmptyState
              title="没有匹配的账号"
              hint={
                <button
                  type="button"
                  onClick={() => {
                    setQuery('');
                    setFilter('all');
                  }}
                  className="mt-2 cursor-pointer rounded-full border border-line px-3.5 py-1.5 text-xs font-semibold text-mist hover:text-ink"
                >
                  清除筛选
                </button>
              }
            />
          ) : (
            <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {rows.map((entry) => (
                <SquareCard key={entry.handle} entry={entry} now={now} />
              ))}
            </div>
          )}

          <footer className="mt-10 flex flex-col gap-2 border-t border-line/60 pt-5 text-xs text-fog sm:flex-row sm:items-center sm:justify-between">
            <p>
              内容来自被判定账号的公开回复或维护者的公开审计，仅供「是否值得屏蔽」参考，不构成事实认定。
            </p>
            <p className="flex shrink-0 items-center gap-3">
              <Link to="/lists/apply" className="font-semibold text-gold hover:text-gold-deep">
                误判申诉 →
              </Link>
              <StoreLinks label="装扩展自动折叠" />
            </p>
          </footer>
        </>
      )}
    </main>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="panel-card flex flex-col gap-1 p-4">
      <span className="text-xs font-semibold text-mist">{label}</span>
      <span className="text-2xl font-bold tabular-nums" style={tone ? { color: tone } : undefined}>
        {value}
      </span>
    </div>
  );
}

function EmptyState({ title, hint }: { title: string; hint: ReactNode }) {
  return (
    <div className="panel-card mt-4 flex flex-col items-center gap-1 px-6 py-14 text-center">
      <p className="text-sm font-semibold text-ink">{title}</p>
      <div className="text-xs text-fog">{hint}</div>
    </div>
  );
}

/** 维护者审计说明：分类 + 公开理由 + 证据帖。合并到模型条目上时用 compact 形态。 */
function AuditInfo({ audit, compact = false }: { audit: AiSquareAudit; compact?: boolean }) {
  const evidence = audit.evidencePostIds[0];
  return (
    <div
      className={compact ? 'mt-3 rounded-[var(--radius-sm)] bg-[var(--wash)] px-3 py-2' : 'mt-4'}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-gold-surface px-2.5 py-0.5 text-[11px] font-bold text-gold">
          维护者审计
        </span>
        <span className="rounded-full bg-[var(--wash-strong)] px-2 py-0.5 text-[11px] font-semibold text-mist">
          {categoryLabel(audit.category)}
        </span>
      </div>
      <p
        className={
          compact
            ? 'mt-2 line-clamp-2 text-xs leading-relaxed text-mist'
            : 'mt-2 line-clamp-3 text-xs leading-relaxed text-mist'
        }
      >
        {audit.note}
      </p>
      {evidence ? (
        <a
          href={`https://x.com/i/status/${evidence}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-gold hover:text-gold-deep"
        >
          查看证据帖
          <ExternalLink className="size-3" />
        </a>
      ) : null}
    </div>
  );
}

function SquareCard({ entry, now }: { entry: AiSquareEntry; now: number }) {
  const kind = KIND[entry.kind];
  // 维护者审计收录的条目没有模型结论，用金色区别于 AI 号红 / 疑似琥珀
  const tone = entry.origin === 'maintainer' ? 'var(--gold)' : kind.color;
  const badge = entry.origin === 'maintainer' ? '维护者审计' : kind.label;
  const name = entry.displayName || `@${entry.handle}`;
  const avatar = avatarUrlOf(entry);
  // 与 flavorOf 同口径：百分比按 5 取整，避免同一账号各页数字不一致
  const percent = entry.score == null ? null : Math.round((entry.score * 100) / 5) * 5;
  const rhythm = entry.rhythm;
  const latest = entry.samples[0];
  const latestLong = latest ? [...latest.text].length >= 120 : false;

  return (
    <article className="panel-card flex flex-col p-5">
      <div className="flex items-start gap-3">
        {avatar ? (
          <img
            src={avatar}
            alt=""
            loading="lazy"
            className="size-11 shrink-0 rounded-full object-cover"
            style={{ boxShadow: `0 0 0 2px ${tone}` }}
          />
        ) : (
          <span
            className="grid size-11 shrink-0 place-items-center rounded-full bg-[var(--wash-strong)] text-lg font-bold text-ink"
            style={{ boxShadow: `0 0 0 2px ${tone}` }}
          >
            {initialOf(name)}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Link
              to="/ai/$handle"
              params={{ handle: entry.handle }}
              className="truncate text-sm font-bold text-ink hover:text-gold"
            >
              {name}
            </Link>
            {entry.blueVerified ? (
              <span className="shrink-0 text-[10px] font-semibold text-fog">蓝V</span>
            ) : null}
          </div>
          <a
            href={xProfileUrl(entry.handle)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 truncate text-xs text-mist hover:text-ink"
          >
            @{entry.handle}
            <ExternalLink className="size-3 shrink-0" />
          </a>
        </div>
        <span
          className="shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold"
          style={{
            color: tone,
            background: `color-mix(in srgb, ${tone} 14%, transparent)`,
          }}
        >
          {badge}
        </span>
      </div>

      {percent != null ? (
        <div className="mt-4 flex items-baseline gap-1">
          <span
            className="text-3xl font-black leading-none tabular-nums"
            style={{ color: kind.color }}
          >
            {percent}
          </span>
          <span className="text-sm font-bold" style={{ color: kind.color }}>
            %
          </span>
          <span className="ml-1 text-xs text-mist">AI 味</span>
          {entry.listed ? <ListedChip /> : null}
        </div>
      ) : entry.origin === 'maintainer' && entry.audit ? (
        // 维护者审计收录：没有模型分数，直接给分类 + 公开理由 + 证据帖
        <AuditInfo audit={entry.audit} />
      ) : (
        // 没有模型分数的账号不参与分数视觉：明确写出「社区投票入名单」，避免读成 0 分
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {entry.listed ? (
            <>
              <span className="rounded-full bg-gold-surface px-2.5 py-0.5 text-xs font-bold text-gold">
                社区投票入名单
              </span>
              <span className="text-xs text-mist">无模型分数</span>
            </>
          ) : (
            <span className="text-sm font-semibold text-mist">暂无判定分数</span>
          )}
        </div>
      )}

      {entry.audit && percent != null ? <AuditInfo audit={entry.audit} compact /> : null}

      {rhythm ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Chip>中位间隔 {fmtGap(rhythm.medianGap)}</Chip>
          <Chip>快回复 {fmtPct(rhythm.fast)}</Chip>
          <Chip>长度变异 {rhythm.cv.toFixed(2)}</Chip>
        </div>
      ) : entry.origin === 'maintainer' ? null : (
        <p className="mt-3 text-xs text-fog">暂无互动指标</p>
      )}

      {latest ? (
        <div className="mt-3 rounded-[var(--radius-sm)] bg-[var(--wash)] px-3 py-2">
          <p className="line-clamp-2 text-xs leading-relaxed text-mist">
            {latest.text}
            {latestLong ? '…' : ''}
          </p>
          <p className="mt-1 text-[11px] text-fog">
            {agoString(latest.postedAt, now)}
            {latest.gapSeconds != null ? ` · 间隔 ${fmtGap(latest.gapSeconds)}` : ''}
          </p>
        </div>
      ) : entry.origin === 'maintainer' ? null : (
        <p className="mt-3 text-xs text-fog">暂无回复样本</p>
      )}

      <div className="mt-4 flex items-center gap-2 border-t border-line/60 pt-3">
        <Link
          to="/ai/$handle"
          params={{ handle: entry.handle }}
          className="inline-flex h-8 items-center rounded-full bg-primary px-3.5 text-xs font-bold text-primary-foreground transition-opacity hover:opacity-95"
        >
          详情
        </Link>
        <a
          href={xProfileUrl(entry.handle)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-8 items-center gap-1 rounded-full px-2 text-xs font-semibold text-mist hover:text-ink"
        >
          在 X 上查看
          <ExternalLink className="size-3" />
        </a>
        <button
          type="button"
          onClick={() => copyHandle(entry.handle)}
          aria-label={`复制 @${entry.handle}`}
          title="复制 handle"
          className="ml-auto inline-flex size-8 cursor-pointer items-center justify-center rounded-full text-fog transition-colors hover:bg-[var(--wash-strong)] hover:text-ink"
        >
          <Copy className="size-3.5" />
        </button>
      </div>
    </article>
  );
}

function ListedChip() {
  return (
    <span className="ml-auto rounded-full bg-gold-surface px-2 py-0.5 text-[11px] font-semibold text-gold">
      已进名单
    </span>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full bg-[var(--wash)] px-2 py-0.5 text-[11px] font-medium text-mist">
      {children}
    </span>
  );
}
