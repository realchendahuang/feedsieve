import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { LoadError, Loading, PageHeader } from '../components/layout';
import { getDashboard } from '../lib/api';

export function DashboardPage() {
  const dashboard = useQuery({ queryKey: ['dashboard'], queryFn: getDashboard });
  const metrics = [
    { label: '名单账号', value: dashboard.data?.maintainer_entries },
    { label: '社区账号', value: dashboard.data?.community_accounts },
    { label: '误标反馈', value: dashboard.data?.false_positive_feedback },
    { label: '名单版本', value: dashboard.data?.snapshot_version ?? '—' },
  ];
  return (
    <section>
      <PageHeader title="概览" />
      {dashboard.isPending ? (
        <Loading rows={1} />
      ) : dashboard.isError ? (
        <LoadError error={dashboard.error} onRetry={() => void dashboard.refetch()} />
      ) : (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {metrics.map((metric) => (
            <Card key={metric.label}>
              <CardContent className="space-y-1">
                <div className="truncate text-2xl font-bold tracking-tight">{metric.value}</div>
                <div className="text-xs font-medium text-muted-foreground">{metric.label}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
