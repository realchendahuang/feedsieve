import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, ShieldCheck } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { LoadError, Loading, PageHeader } from '../components/layout';
import { getVerified } from '../lib/api';

function formatAgo(unix: number): string {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - unix);
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  return `${Math.floor(seconds / 86400)} 天前`;
}

/** 社区白名单（verified）：被验证为「误标正常」的账号，随签名快照下发。只读。 */
export function VerifiedPage() {
  const [q, setQ] = React.useState('');
  const [needle, setNeedle] = React.useState('');
  const response = useQuery({
    queryKey: ['verified', { needle }],
    queryFn: () => getVerified({ q: needle || undefined }),
  });
  const entries = response.data?.entries ?? [];

  return (
    <section>
      <PageHeader title="验证正常" />
      <form
        className="mt-5 flex max-w-xs items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setNeedle(q.trim());
        }}
      >
        <div className="relative w-full">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="搜索 handle"
            className="pl-9"
            aria-label="搜索 handle"
          />
        </div>
      </form>

      {response.isLoading ? (
        <Loading />
      ) : response.isError ? (
        <LoadError error={response.error} onRetry={() => void response.refetch()} />
      ) : entries.length === 0 ? (
        <div className="mt-10 flex flex-col items-center gap-2 text-center text-sm text-muted-foreground">
          <ShieldCheck className="size-8 opacity-40" />
          <p>{needle ? '没有匹配的账号' : '还没有验证为正常的账号'}</p>
        </div>
      ) : (
        <Table className="mt-5">
          <TableHeader>
            <TableRow>
              <TableHead>账号</TableHead>
              <TableHead className="text-right">抢救净票</TableHead>
              <TableHead className="text-right">抢救</TableHead>
              <TableHead className="text-right">拉黑</TableHead>
              <TableHead className="text-right">更新</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => (
              <TableRow key={entry.handle}>
                <TableCell>
                  <span className="font-medium">@{entry.handle}</span>
                  {entry.x_user_id ? (
                    <span className="ml-2 text-xs text-muted-foreground">id {entry.x_user_id}</span>
                  ) : null}
                </TableCell>
                <TableCell className="text-right font-semibold text-emerald-600 dark:text-emerald-400">
                  {entry.net_votes}
                </TableCell>
                <TableCell className="text-right">{entry.rescue_count}</TableCell>
                <TableCell className="text-right">{entry.report_count}</TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {formatAgo(entry.updated_at)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}