import { useQuery } from '@tanstack/react-query';
import { Mail } from 'lucide-react';
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
        <Card className="mt-6 max-w-md shadow-xs border-border/80">
          <CardContent className="flex items-center gap-3.5 p-5">
            <div className="flex size-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
              <Mail className="size-5" />
            </div>
            <div className="space-y-0.5">
              <div className="text-xs font-medium text-muted-foreground">维护者身份</div>
              <div className="break-all text-sm font-semibold text-foreground">{me.data.email}</div>
            </div>
          </CardContent>
        </Card>
      )}
    </section>
  );
}
