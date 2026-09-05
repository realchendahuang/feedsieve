import { useQuery } from '@tanstack/react-query';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { LoadError, Loading, PageHeader } from '../components/layout';
import { getFeedback } from '../lib/api';

export function FeedbackPage() {
  const feedback = useQuery({ queryKey: ['feedback'], queryFn: getFeedback });
  return (
    <section>
      <PageHeader title="用户反馈" />
      {feedback.isPending ? (
        <Loading />
      ) : feedback.isError ? (
        <LoadError error={feedback.error} onRetry={() => void feedback.refetch()} />
      ) : (
        <>
          <h2 className="mt-6 text-sm font-semibold text-muted-foreground">汇总</h2>
          <div className="mt-2 overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>来源</TableHead>
                  <TableHead>规则</TableHead>
                  <TableHead className="w-24 text-right">数量</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {feedback.data.summary.map((item) => (
                  <TableRow key={`${item.detection_source}-${item.rule_id}`}>
                    <TableCell className="font-medium">{item.detection_source}</TableCell>
                    <TableCell className="text-muted-foreground">{item.rule_id}</TableCell>
                    <TableCell className="text-right">{item.count}</TableCell>
                  </TableRow>
                ))}
                {feedback.data.summary.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="h-24 text-center text-muted-foreground">
                      暂无反馈
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
          <h2 className="mt-6 text-sm font-semibold text-muted-foreground">明细</h2>
          <div className="mt-2 overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>账号</TableHead>
                  <TableHead>规则</TableHead>
                  <TableHead>分类</TableHead>
                  <TableHead>时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {feedback.data.feedback.map((item, index) => (
                  <TableRow key={`${item.handle}-${item.created_at}-${index}`}>
                    <TableCell className="font-medium">@{item.handle}</TableCell>
                    <TableCell className="text-muted-foreground">{item.rule_id ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{item.category ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(item.created_at * 1000).toLocaleString('zh-CN')}
                    </TableCell>
                  </TableRow>
                ))}
                {feedback.data.feedback.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                      暂无反馈
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </section>
  );
}
