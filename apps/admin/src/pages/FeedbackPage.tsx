import { useQuery } from '@tanstack/react-query';
import { Loading, PageHeader } from '../components/layout';
import { getFeedback } from '../lib/api';

export function FeedbackPage() {
  const feedback = useQuery({ queryKey: ['feedback'], queryFn: getFeedback });
  return <section className="page"><PageHeader title="用户反馈" />{!feedback.data ? <Loading error={feedback.error} /> : <>
    <div className="table-wrap"><table><thead><tr><th>来源</th><th>规则</th><th>数量</th></tr></thead><tbody>{feedback.data.summary.map((item) => <tr key={`${item.detection_source}-${item.rule_id}`}><td>{item.detection_source}</td><td>{item.rule_id}</td><td>{item.count}</td></tr>)}</tbody></table></div>
    <div className="table-wrap spaced"><table><thead><tr><th>账号</th><th>规则</th><th>分类</th><th>时间</th></tr></thead><tbody>{feedback.data.feedback.map((item, index) => <tr key={`${item.handle}-${item.created_at}-${index}`}><td>@{item.handle}</td><td>{item.rule_id ?? '—'}</td><td>{item.category ?? '—'}</td><td>{new Date(item.created_at * 1000).toLocaleString('zh-CN')}</td></tr>)}</tbody></table></div>
  </>}</section>;
}
