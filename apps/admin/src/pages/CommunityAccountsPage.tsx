import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { getCommunityCandidates } from '../lib/api';

const NET_OPTIONS = [
  { value: 'all', label: '全部' },
  { value: '0', label: '0 票' },
  { value: '1', label: '1 票' },
  { value: '2', label: '2 票' },
  { value: '3+', label: '3 票以上' },
] as const;

const SOURCE_LABELS: Record<string, string> = {
  manual: '手动',
  heuristic: '规则',
  fingerprint: '指纹',
  domain: '域名',
  'community-list': '名单',
  'builtin-list': '内置',
  ai: 'AI',
};

function formatAgo(unix: number): string {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - unix);
  if (seconds < 60) return '刚刚';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  return `${Math.floor(seconds / 86400)} 天前`;
}

export function CommunityAccountsPage() {
  const navigate = useNavigate();
  const [net, setNet] = React.useState<(typeof NET_OPTIONS)[number]['value']>('all');
  const [q, setQ] = React.useState('');
  const [needle, setNeedle] = React.useState('');
  const [category, setCategory] = React.useState('all');
  const [cursors, setCursors] = React.useState<string[]>([]);

  const cursor = cursors.length > 0 ? cursors[cursors.length - 1] : undefined;
  const response = useQuery({
    queryKey: ['community-accounts', { net, needle, category, cursor, limit: 50 }],
    queryFn: () =>
      getCommunityCandidates({
        net,
        q: needle || undefined,
        category: category === 'all' ? undefined : category,
        cursor,
        limit: 50,
      }),
  });
  const entries = response.data?.entries ?? [];

  const resetPaging = () => setCursors([]);

  const applyFilters = (event: React.FormEvent) => {
    event.preventDefault();
    setNeedle(q.trim());
    resetPaging();
  };

  return (
    <section>
      <PageHeader title="社区候选" />
      <form className="mt-5 flex flex-wrap items-center gap-2" onSubmit={applyFilters}>
        <div className="relative w-full max-w-xs">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="搜账号"
            className="pl-8"
          />
        </div>
        <Select
          value={net}
          onValueChange={(value) => {
            setNet(value as (typeof NET_OPTIONS)[number]['value']);
            resetPaging();
          }}
        >
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {NET_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={category}
          onValueChange={(value) => {
            setCategory(value);
            resetPaging();
          }}
        >
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部分类</SelectItem>
            {(response.data?.categories ?? []).map((item) => (
              <SelectItem key={item} value={item}>
                {item}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </form>
      {response.isPending ? (
        <Loading />
      ) : response.isError ? (
        <LoadError error={response.error} onRetry={() => void response.refetch()} />
      ) : entries.length === 0 ? (
        <div className="mt-6 grid h-44 place-items-center rounded-lg border border-dashed text-sm text-muted-foreground">
          {needle ? '无匹配' : '暂无社区候选'}
        </div>
      ) : (
        <>
          <div className="mt-4 overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>账号</TableHead>
                  <TableHead>分类</TableHead>
                  <TableHead className="w-16 text-right">净票</TableHead>
                  <TableHead className="w-16 text-right">拉黑</TableHead>
                  <TableHead className="w-16 text-right">抢救</TableHead>
                  <TableHead className="w-20 text-right">指纹/域名</TableHead>
                  <TableHead>来源</TableHead>
                  <TableHead className="w-28">更新</TableHead>
                  <TableHead className="w-24 text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.handle}>
                    <TableCell className="font-medium">@{entry.handle}</TableCell>
                    <TableCell className="text-muted-foreground">{entry.category}</TableCell>
                    <TableCell className="text-right">
                      <span
                        className={
                          entry.net_votes >= 3 ? 'font-bold text-emerald-600 dark:text-emerald-400' : 'font-semibold'
                        }
                      >
                        {entry.net_votes}
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {entry.blocked_installs}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {entry.allowed_installs}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {entry.fingerprints > 0 || entry.domains > 0 ? `${entry.fingerprints}/${entry.domains}` : '—'}
                    </TableCell>
                    <TableCell>
                      {entry.sources.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {entry.sources.map((source) => (
                            <Badge key={source} variant="secondary" className="text-xs">
                              {SOURCE_LABELS[source] ?? source}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatAgo(entry.updated_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          void navigate({
                            to: '/accounts',
                            search: { draft: entry.handle, category: entry.category },
                          })
                        }
                      >
                        转维护
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="mt-3 flex items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={cursors.length === 0 || response.isFetching}
              onClick={() => setCursors((prev) => prev.slice(0, -1))}
            >
              <ChevronLeft className="size-4" />
              上一页
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!response.data?.next_cursor || response.isFetching}
              onClick={() =>
                setCursors((prev) =>
                  response.data?.next_cursor ? [...prev, response.data.next_cursor] : prev,
                )
              }
            >
              下一页
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </>
      )}
    </section>
  );
}