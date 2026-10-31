import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { LoadError, Loading, PageHeader } from '../components/layout';
import { decideAiReview, getAiReviews, type AiReviewItem } from '../lib/api';
import { formatAgo } from '../lib/format';

const VERDICT_LABELS: Record<string, string> = {
  ai: 'AI 号',
  suspect: '疑似',
  human: '真人',
  insufficient: '证据不足',
};

/** 失败统计里展示的键（ai-outcome:* 去掉前缀） */
const OUTCOME_LABELS: Array<[string, string]> = [
  ['judged', '新判定'],
  ['confirmed', '交叉确认'],
  ['cached', '命中缓存'],
  ['insufficient', '服务端证据不足'],
  ['client:insufficient', '扩展：回复不够'],
  ['client:narrow', '扩展：回复太集中'],
  ['client:no_data', '扩展：页面没数据'],
  ['client:stopped', '扩展：用户停止'],
];

/**
 * AI 号复核：「是真人」票 ≥ 3 或有已验证申诉的判定进这里，复核前已暂停公开展示。
 * 改判真人 = 推翻结论、90 天内不重判；维持 = 恢复公开展示。申诉单本身在「公示申请」里另行裁决。
 */
export function AiReviewsPage() {
  const queryClient = useQueryClient();
  const response = useQuery({ queryKey: ['ai-reviews'], queryFn: getAiReviews });
  const decide = useMutation({
    mutationFn: ({ handle, decision }: { handle: string; decision: 'human' | 'keep' }) =>
      decideAiReview(handle, decision),
    onSuccess: (_, { handle, decision }) => {
      toast.success(decision === 'human' ? `@${handle} 已改判真人` : `@${handle} 已维持原判`);
      void queryClient.invalidateQueries({ queryKey: ['ai-reviews'] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : '操作失败'),
  });
  const items = response.data?.items ?? [];
  const outcomes = response.data?.outcomes ?? {};

  return (
    <section>
      <PageHeader title="AI 号复核" />
      {response.isPending ? (
        <Loading />
      ) : response.isError ? (
        <LoadError error={response.error} onRetry={() => void response.refetch()} />
      ) : (
        <>
          <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {OUTCOME_LABELS.map(([key, label]) => (
              <div key={key} className="rounded-md border px-3 py-2">
                <dt className="text-xs text-muted-foreground">{label} · 7 天</dt>
                <dd className="text-lg font-semibold tabular-nums">{outcomes[key] ?? 0}</dd>
              </div>
            ))}
          </dl>
          {items.length === 0 ? (
            <div className="mt-10 flex flex-col items-center gap-2 text-center text-sm text-muted-foreground">
              <Bot className="size-8 opacity-40" />
              <p>没有待复核的账号</p>
            </div>
          ) : (
            <Table className="mt-5">
              <TableHeader>
                <TableRow>
                  <TableHead>账号</TableHead>
                  <TableHead>结论</TableHead>
                  <TableHead className="text-right">是 AI / 是真人</TableHead>
                  <TableHead>申诉</TableHead>
                  <TableHead className="text-right">判定</TableHead>
                  <TableHead className="text-right">处理</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <ReviewRow
                    key={item.handle}
                    item={item}
                    busy={decide.isPending}
                    onDecide={(decision) => decide.mutate({ handle: item.handle, decision })}
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </>
      )}
    </section>
  );
}

function ReviewRow({
  item,
  busy,
  onDecide,
}: {
  item: AiReviewItem;
  busy: boolean;
  onDecide: (decision: 'human' | 'keep') => void;
}) {
  return (
    <TableRow>
      <TableCell>
        <a
          className="font-medium hover:underline"
          href={`https://x.com/${encodeURIComponent(item.handle)}/with_replies`}
          target="_blank"
          rel="noreferrer"
        >
          @{item.handle}
        </a>
      </TableCell>
      <TableCell>
        {item.verdict ? (
          <span className="flex items-center gap-2">
            <Badge variant={item.verdict === 'human' ? 'secondary' : 'default'}>
              {VERDICT_LABELS[item.verdict] ?? item.verdict}
            </Badge>
            {item.score !== null ? (
              <span className="tabular-nums text-muted-foreground">
                {Math.round(item.score * 100)}%
              </span>
            ) : null}
            {item.confirmed ? null : <span className="text-xs text-muted-foreground">未确认</span>}
          </span>
        ) : (
          <span className="text-muted-foreground">只有投票</span>
        )}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {item.ai_count} / {item.human_count}
      </TableCell>
      <TableCell className="max-w-xs">
        {item.appeals.length ? (
          <ul className="space-y-1 text-sm">
            {item.appeals.map((a) => (
              <li key={a.id} className="line-clamp-2" title={a.statement}>
                {a.statement}
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="text-right text-muted-foreground">
        {item.judged_at ? formatAgo(item.judged_at) : '—'}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !item.verdict}
            onClick={() => onDecide('keep')}
          >
            维持
          </Button>
          <Button size="sm" disabled={busy} onClick={() => onDecide('human')}>
            改判真人
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
