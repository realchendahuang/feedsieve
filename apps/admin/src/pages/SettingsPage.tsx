import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { LoadError, Loading, PageHeader } from '../components/layout';
import { getMe } from '../lib/api';

export function SettingsPage() {
  const me = useQuery({ queryKey: ['me'], queryFn: getMe });
  return (
    <section>
      <PageHeader title="后台设置" />
      {me.isPending ? (
        <Loading rows={1} />
      ) : me.isError ? (
        <LoadError error={me.error} onRetry={() => void me.refetch()} />
      ) : (
        <Card className="mt-6 max-w-md">
          <CardContent className="space-y-1">
            <div className="text-xs font-medium text-muted-foreground">维护者邮箱</div>
            <div className="break-all text-base font-semibold">{me.data.email}</div>
          </CardContent>
        </Card>
      )}
    </section>
  );
}
