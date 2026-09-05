import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { LoadError, Loading, PageHeader } from '../components/layout';
import { getReleases, rollbackRelease, type Release } from '../lib/api';
import { errorText } from '../lib/errors';

export function ReleasesPage() {
  const queryClient = useQueryClient();
  const releases = useQuery({ queryKey: ['releases'], queryFn: getReleases });
  const [pending, setPending] = React.useState<Release | null>(null);

  const rollbackMutation = useMutation({
    mutationFn: (release: Release) => rollbackRelease(release.id),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['releases'] }),
        queryClient.invalidateQueries({ queryKey: ['accounts'] }),
        queryClient.invalidateQueries({ queryKey: ['keywords'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      ]);
      toast.success(`已回退 ${result.snapshot_version ?? result.version ?? ''}`);
      setPending(null);
    },
    onError: (error) => toast.error(errorText(error)),
  });

  return (
    <section>
      <PageHeader title="发布记录" />
      {releases.isPending ? (
        <Loading />
      ) : releases.isError ? (
        <LoadError error={releases.error} onRetry={() => void releases.refetch()} />
      ) : releases.data.length === 0 ? (
        <div className="mt-6 grid h-44 place-items-center rounded-lg border border-dashed text-sm text-muted-foreground">
          暂无记录
        </div>
      ) : (
        <div className="mt-5 overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>类型</TableHead>
                <TableHead>版本</TableHead>
                <TableHead>维护者</TableHead>
                <TableHead>时间</TableHead>
                <TableHead className="w-20 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {releases.data.map((release) => (
                <TableRow key={release.id}>
                  <TableCell className="font-medium">{release.kind === 'accounts' ? '名单' : '词库'}</TableCell>
                  <TableCell className="text-muted-foreground">{release.version}</TableCell>
                  <TableCell className="text-muted-foreground">{release.actor_email}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(release.created_at * 1000).toLocaleString('zh-CN')}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => setPending(release)}>
                      回退
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <AlertDialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>回退到 {pending?.version ?? ''}？</AlertDialogTitle>
            <AlertDialogDescription>恢复到该版本，并生成一条新记录。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: 'destructive' })}
              disabled={rollbackMutation.isPending}
              onClick={() => pending && rollbackMutation.mutate(pending)}
            >
              回退
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
