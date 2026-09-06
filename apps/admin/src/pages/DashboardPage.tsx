import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Hint, LoadError, Loading, PageHeader } from '../components/layout';
import { getDashboard } from '../lib/api';

interface Metric {
  label: string;
  value: string | number | null;
  hint?: string;
}

function MetricCard({ metric }: { metric: Metric }) {
  return (
    <Card>
      <CardContent className="space-y-1">
        <div className="flex items-center gap-1.5">
          <div className="truncate text-2xl font-bold tracking-tight">{metric.value ?? '—'}</div>
          {metric.hint ? <Hint text={metric.hint} /> : null}
        </div>
        <div className="text-xs font-medium text-muted-foreground">{metric.label}</div>
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
    },
    {
      label: '社区候选',
      value: dashboard.data?.community_candidates ?? null,
      hint: '未达 3 票门槛的候选账号',
    },
    { label: '维护名单', value: dashboard.data?.maintainer_entries ?? null },
    {
      label: '公开条目',
      value: dashboard.data?.public_entries ?? null,
      hint: '客户端实际下载的最终名单大小',
    },
    {
      label: '24h 举报',
      value: dashboard.data?.reports_last_24h ?? null,
      hint: '按安装 × 账号去重后的活跃记录，不是请求次数',
    },
    { label: '24h 活跃', value: dashboard.data?.active_installations_last_24h ?? null },
    {
      label: '快照延迟',
      value:
        dashboard.data?.snapshot_lag_seconds != null
          ? `${dashboard.data.snapshot_lag_seconds}s`
          : null,
      hint: '名单生成与当前时间的差距',
    },
    {
      label: '误标反馈',
      value: dashboard.data?.false_positive_feedback ?? null,
      hint: '去重后的当前抢救关系数',
    },
  ];
  return (
    <section>
      <PageHeader title="概览" />
      {dashboard.isPending ? (
        <Loading rows={1} />
      ) : dashboard.isError ? (
        <LoadError error={dashboard.error} onRetry={() => void dashboard.refetch()} />
      ) : (
        <>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {metrics.map((metric) => (
              <MetricCard key={metric.label} metric={metric} />
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            名单版本 {dashboard.data?.snapshot_version ?? '—'}
          </p>
        </>
      )}
    </section>
  );
}
