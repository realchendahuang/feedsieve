import { useQuery } from '@tanstack/react-query';
import { Loading, PageHeader } from '../components/layout';
import { getDashboard } from '../lib/api';

export function DashboardPage() {
  const dashboard = useQuery({ queryKey: ['dashboard'], queryFn: getDashboard });
  if (!dashboard.data) return <section className="page"><PageHeader title="概览" /><Loading error={dashboard.error} /></section>;
  return (
    <section className="page">
      <PageHeader title="概览" />
      <div className="metrics">
        <div><strong>{dashboard.data.maintainer_entries}</strong><span>账号草稿</span></div>
        <div><strong>{dashboard.data.community_accounts}</strong><span>社区账号</span></div>
        <div><strong>{dashboard.data.false_positive_feedback}</strong><span>误标反馈</span></div>
        <div><strong>{dashboard.data.snapshot_version ?? '—'}</strong><span>名单版本</span></div>
      </div>
    </section>
  );
}
