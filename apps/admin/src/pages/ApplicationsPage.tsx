import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { LoadError, Loading, PageHeader } from '../components/layout';
import { decideApplication, getApplications } from '../lib/api';
import { formatAgo } from '../lib/format';

const STATUS_OPTIONS = [
  { value: 'all', label: '全部' },
  { value: 'verified', label: '待处理' },
  { value: 'pending', label: '待验证邮箱' },
  { value: 'approved', label: '已通过' },
  { value: 'rejected', label: '已拒绝' },
] as const;

const STATUS_LABELS: Record<string, string> = {
  pending: '待验证邮箱',
  verified: '待处理',
  approved: '已通过',
  rejected: '已拒绝',
};

const KIND_LABELS: Record<string, string> = {
  whitelist: '白名单',
  appeal: '申诉',
};

export function ApplicationsPage() {
  const queryClient = useQueryClient();
  const [status, setStatus] = React.useState<(typeof STATUS_OPTIONS)[number]['value']>('all');
  const [review, setReview] = React.useState<{ id: number; handle: string; kind: string; statement: string } | null>(
    null,
  );
  const [note, setNote] = React.useState('');

  const response = useQuery({
    queryKey: ['applications', { status }],
    queryFn: () => getApplications({ status: status === 'all' ? undefined : status }),
  });
  const entries = response.data?.entries ?? [];

  const decide = useMutation({
    mutationFn: ({ id, decision, note }: { id: number; decision: 'approved' | 'rejected'; note?: string }) =>
      decideApplication(id, decision, note),
    onSuccess: (_data, variables) => {
      toast.success(variables.decision === 'approved' ? '已通过' : '已拒绝');
      setReview(null);
      setNote('');
      void queryClient.invalidateQueries({ queryKey: ['applications'] });
    },
    onError: (error) => toast.error(error.message),
  });

  const openReview = (entry: { id: number; handle: string; kind: string; statement: string }) => {
    setReview(entry);
    setNote('');
  };

  return (
    <section>
      <PageHeader title="公示申请" />
      <div className="mt-5 flex items-center gap-2">
        <Select
          value={status}
          onValueChange={(value) => setStatus(value as (typeof STATUS_OPTIONS)[number]['value'])}
        >
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {response.isPending ? (
        <Loading />
      ) : response.isError ? (
        <LoadError error={response.error} onRetry={() => void response.refetch()} />
      ) : entries.length === 0 ? (
        <div className="mt-6 flex h-44 flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-muted/20 text-sm text-muted-foreground">
          暂无申请
        </div>
      ) : (
        <div className="mt-4 overflow-hidden rounded-xl border bg-card shadow-xs">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>账号</TableHead>
                <TableHead className="w-20">类型</TableHead>
                <TableHead>陈述</TableHead>
                <TableHead className="w-24">状态</TableHead>
                <TableHead className="w-24">提交</TableHead>
                <TableHead className="w-32 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="font-semibold text-foreground">@{entry.handle}</TableCell>
                  <TableCell className="text-muted-foreground">{KIND_LABELS[entry.kind] ?? entry.kind}</TableCell>
                  <TableCell className="max-w-xs truncate text-muted-foreground" title={entry.statement}>
                    {entry.statement}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={entry.status === 'approved' ? 'secondary' : 'outline'}
                      className="text-xs"
                    >
                      {STATUS_LABELS[entry.status] ?? entry.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatAgo(entry.created_at)}</TableCell>
                  <TableCell className="text-right">
                    {entry.status === 'pending' || entry.status === 'verified' ? (
                      <Button variant="ghost" size="sm" onClick={() => openReview(entry)}>
                        处理
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {entry.decision_note || '—'}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={review != null} onOpenChange={(open) => (open ? null : setReview(null))}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              @{review?.handle} · {review ? (KIND_LABELS[review.kind] ?? review.kind) : ''}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{review?.statement}</p>
          <div className="grid gap-2">
            <Label htmlFor="decision-note">备注（可选，展示在处理记录）</Label>
            <Input
              id="decision-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={200}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setReview(null)}>
              取消
            </Button>
            <Button
              variant="outline"
              disabled={decide.isPending}
              onClick={() => review && decide.mutate({ id: review.id, decision: 'rejected', note })}
            >
              拒绝
            </Button>
            <Button
              disabled={decide.isPending}
              onClick={() => review && decide.mutate({ id: review.id, decision: 'approved', note })}
            >
              通过
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
