import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  BookOpen,
  Clock,
  Flame,
  HeartHandshake,
  Layers,
  ShieldCheck,
  Tag,
  UserSearch,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Hint, LoadError, Loading, PageHeader } from '../components/layout';
import { getDashboard } from '../lib/api';

type MetricColor = 'amber' | 'blue' | 'purple' | 'emerald' | 'rose';

interface Metric {
  label: string;
  value: string | number | null;
  hint?: string;
  icon: React.ElementType;
  color: MetricColor;
}

const COLOR_STYLES: Record<MetricColor, { iconWrap: string; cardHover: string }> = {
  amber: {
    iconWrap: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
    cardHover: 'hover:border-amber-500/40',
  },
  blue: {
    iconWrap: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20',
    cardHover: 'hover:border-sky-500/40',
  },
  purple: {
    iconWrap: 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20',
    cardHover: 'hover:border-violet-500/40',
  },
  emerald: {
    iconWrap: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
    cardHover: 'hover:border-emerald-500/40',
  },
  rose: {
    iconWrap: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
    cardHover: 'hover:border-rose-500/40',
  },
};

function MetricCard({ metric }: { metric: Metric }) {
  const Icon = metric.icon;
  const style = COLOR_STYLES[metric.color] ?? COLOR_STYLES.amber;
  return (
    <Card className={`group relative overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${style.cardHover}`}>
      <CardContent className="space-y-2.5 p-5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold tracking-wide text-muted-foreground">{metric.label}</span>
          <div className={`flex size-8 items-center justify-center rounded-lg border ${style.iconWrap}`}>
            <Icon className="size-4" />
          </div>
        </div>
        <div className="flex items-baseline gap-2">
          <div className="truncate text-3xl font-extrabold tracking-tight tabular-nums text-foreground">
            {metric.value ?? '—'}
          </div>
          {metric.hint ? <Hint text={metric.hint} /> : null}
        </div>
      </CardContent>
    </Card>
  );
}

export function DashboardPage() {
  const dashboard = useQuery({
    queryKey: ['dashboard'],
    queryFn: getDashboard,
    refetchInterval: 30_000,
  });
  const metrics: Metric[] = [
    {
      label: '社区名单',
      value: dashboard.data?.community_listed ?? null,
      hint: '社区净票 ≥3，已进入公开名单',
      icon: ShieldCheck,
      color: 'amber',
    },
    {
      label: '社区候选',
      value: dashboard.data?.community_candidates ?? null,
      hint: '未达 3 票门槛的候选账号',
      icon: UserSearch,
      color: 'blue',
    },
    {
      label: '维护名单',
      value: dashboard.data?.maintainer_entries ?? null,
      icon: BookOpen,
      color: 'purple',
    },
    {
      label: '公开条目',
      value: dashboard.data?.public_entries ?? null,
      hint: '客户端实际下载的最终名单大小',
      icon: Layers,
      color: 'emerald',
    },
    {
      label: '24h 举报',
      value: dashboard.data?.reports_last_24h ?? null,
      hint: '按安装 × 账号去重后的活跃记录，不是请求次数',
      icon: Flame,
      color: 'amber',
    },
    {
      label: '24h 活跃',
      value: dashboard.data?.active_installations_last_24h ?? null,
      icon: Activity,
      color: 'blue',
    },
    {
      label: '快照延迟',
      value:
        dashboard.data?.snapshot_lag_seconds != null
          ? `${dashboard.data.snapshot_lag_seconds}s`
          : null,
      hint: '名单生成与当前时间的差距',
      icon: Clock,
      color: 'emerald',
    },
    {
      label: '误标反馈',
      value: dashboard.data?.false_positive_feedback ?? null,
      hint: '去重后的当前抢救关系数',
      icon: HeartHandshake,
      color: 'rose',
    },
  ];
  return (
    <section>
      <PageHeader title="概览" />
      {dashboard.isPending ? (
        <Loading rows={2} />
      ) : dashboard.isError ? (
        <LoadError error={dashboard.error} onRetry={() => void dashboard.refetch()} />
      ) : (
        <>
          <div className="mt-6 grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
            {metrics.map((metric) => (
              <MetricCard key={metric.label} metric={metric} />
            ))}
          </div>
          <div className="mt-5 flex items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-2.5 text-xs text-muted-foreground w-fit">
            <Tag className="size-3.5 text-amber-600 dark:text-amber-400" />
            <span>名单快照版本</span>
            <strong className="font-semibold text-foreground">
              {dashboard.data?.snapshot_version ?? '—'}
            </strong>
          </div>
        </>
      )}
    </section>
  );
}
