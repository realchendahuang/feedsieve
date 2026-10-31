import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { LoadError, Loading } from '../components/layout';
import { getRuleFeedback, setRuleMuted } from '../lib/api';

const STATE_LABEL = { active: '启用', muted: '已静音', exempt: '已恢复（不再自动静音）' } as const;

/**
 * 规则误伤：扩展匿名上报的规则命中（不是票）对比「误标」反馈。
 * 误伤率 = 14 天内点了误标的账号 ÷ 被这条规则打黄框的账号；超线自动静音，随快照下发。
 */
export function RuleFeedbackPanel() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['rule-feedback'], queryFn: getRuleFeedback });
  const toggle = useMutation({
    mutationFn: ({ ruleId, muted }: { ruleId: string; muted: boolean }) =>
      setRuleMuted(ruleId, muted),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['rule-feedback'] }),
  });
  if (query.isPending) return <Loading />;
  if (query.isError) return <LoadError error={query.error} onRetry={() => void query.refetch()} />;
  return (
    <>
      <h2 className="mt-6 text-sm font-semibold text-muted-foreground">规则误伤（14 天）</h2>
      <div className="mt-2 overflow-hidden rounded-xl border bg-card shadow-xs">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>规则</TableHead>
              <TableHead className="w-24 text-right">命中账号</TableHead>
              <TableHead className="w-20 text-right">网段</TableHead>
              <TableHead className="w-24 text-right">误标账号</TableHead>
              <TableHead className="w-20 text-right">误伤率</TableHead>
              <TableHead className="w-40">状态</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.data.rules.map((rule) => (
              <TableRow key={rule.rule_id}>
                <TableCell className="font-mono text-xs text-foreground">{rule.rule_id}</TableCell>
                <TableCell className="text-right tabular-nums">{rule.hit_accounts}</TableCell>
                <TableCell className="text-right tabular-nums">{rule.hit_nets}</TableCell>
                <TableCell className="text-right tabular-nums">{rule.rescue_accounts}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {rule.fp_rate === null ? '—' : `${Math.round(rule.fp_rate * 100)}%`}
                </TableCell>
                <TableCell className="text-muted-foreground">{STATE_LABEL[rule.state]}</TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={toggle.isPending}
                    onClick={() =>
                      toggle.mutate({ ruleId: rule.rule_id, muted: rule.state !== 'muted' })
                    }
                  >
                    {rule.state === 'muted' ? '恢复' : '静音'}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {query.data.rules.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                  暂无规则命中数据
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
