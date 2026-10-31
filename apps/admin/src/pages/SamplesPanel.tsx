import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { SEMANTIC_TAGS, type SampleVerdict } from '@feedsieve/shared';
import { getSamples, reviewSample, type SampleEntry } from '../lib/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { LoadError, Loading } from '../components/layout';

const actions = {
  'manual-spam': '用户标记垃圾',
  'accepted-detection': '采纳检测后拉黑',
  'batch-block': '批量采纳检测',
  'false-positive': '用户纠正误标',
};
const tags: Record<string, string> = {
  solicitation: '招揽',
  'contact-routing': '联系方式导流',
  quotation: '引用',
  negation: '否定',
  'insufficient-context': '上下文不足',
};
export function SamplesPanel() {
  const [after, setAfter] = useState(0);
  const query = useQuery({ queryKey: ['samples', after], queryFn: () => getSamples(after) });
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  async function exportSamples() {
    setExporting(true);
    setError(null);
    try {
      const entries: SampleEntry[] = [];
      let cursor = 0;
      let until: number | undefined;
      let reviewUntil: number | undefined;
      // Full cursor traversal; pending/uncertain rows remain explicit in the raw export.
      for (;;) {
        const page = await getSamples(cursor, until, reviewUntil);
        until = page.until;
        reviewUntil = page.review_until;
        entries.push(...page.entries);
        if (!page.next_cursor) break;
        cursor = page.next_cursor;
      }
      const blob = new Blob(
        [
          JSON.stringify(
            {
              schema_version: 1,
              until,
              review_until: reviewUntil,
              exported_at: new Date().toISOString(),
              entries,
            },
            null,
            2,
          ),
        ],
        { type: 'application/json' },
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `feedsieve-samples-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e instanceof Error ? e : new Error('export_failed'));
    } finally {
      setExporting(false);
    }
  }
  return (
    <section className="mt-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">证据样本</h2>
        <Button disabled={exporting} onClick={() => void exportSamples()}>
          {exporting ? '导出中…' : '导出样本'}
        </Button>
      </div>
      {error && <LoadError error={error} onRetry={() => void exportSamples()} />}
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <LoadError error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <>
          {query.data.entries.map((entry) => (
            <SampleCard key={`${entry.id}-${entry.review_id}`} entry={entry} />
          ))}
          {!query.data.entries.length && <div className="p-6 text-muted-foreground">暂无样本</div>}
          <div className="flex gap-2">
            <Button disabled={!after} onClick={() => setAfter(0)}>
              第一页
            </Button>
            <Button
              disabled={!query.data.entries.length}
              onClick={() => setAfter(query.data.next_cursor ?? 0)}
            >
              下一页
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
function SampleCard({ entry }: { entry: SampleEntry }) {
  const cache = useQueryClient();
  const [verdict, setVerdict] = useState<SampleVerdict>(
    (entry.verdict ?? 'uncertain') as SampleVerdict,
  );
  const [family, setFamily] = useState(entry.family ?? '');
  const [note, setNote] = useState(entry.note ?? '');
  const [selectedTags, setTags] = useState(entry.tags);
  const mutation = useMutation({
    mutationFn: () => reviewSample(entry.id, { verdict, family, note, tags: selectedTags }),
    onSuccess: () => cache.invalidateQueries({ queryKey: ['samples'] }),
  });
  const s = entry.sample;
  return (
    <article className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap gap-3">
        <strong>
          {s.displayName || s.handle} @{s.handle}
        </strong>
        <span>{actions[s.action]}</span>
        <span>
          {entry.verdict === 'spam'
            ? '已审：垃圾'
            : entry.verdict === 'normal'
              ? '已审：正常'
              : entry.verdict === 'uncertain'
                ? '已审：不确定'
                : '待复核'}
        </span>
      </div>
      <div className="whitespace-pre-wrap break-words">{s.text ?? '正文未采集'}</div>
      {s.bio && <div className="whitespace-pre-wrap break-words">简介：{s.bio}</div>}
      <div className="text-sm text-muted-foreground">
        {new Date(s.observedAt).toLocaleString('zh-CN')} · 扩展 {s.clientVersion} · 词库{' '}
        {s.catalogVersion ?? '未知'} · {s.detection.ruleId ?? s.detection.source ?? '未命中'}
      </div>
      {s.truncated.length > 0 && <div role="status">证据已截断：{s.truncated.join('、')}</div>}
      {s.postId && (
        <a
          className="underline"
          href={`https://x.com/${s.handle}/status/${s.postId}`}
          target="_blank"
          rel="noreferrer"
        >
          原帖
        </a>
      )}
      <div className="flex flex-wrap gap-4">
        {(['spam', 'normal', 'uncertain'] as const).map((v, i) => (
          <label key={v}>
            <input
              type="radio"
              name={`verdict-${entry.id}`}
              checked={verdict === v}
              onChange={() => setVerdict(v)}
            />{' '}
            {['垃圾内容', '正常内容', '不确定'][i]}
          </label>
        ))}
      </div>
      <label className="block">
        模板家族 ID
        <Input
          value={family}
          onChange={(e) => setFamily(e.target.value)}
          placeholder="例如 profile-contact-001"
          maxLength={80}
        />
      </label>
      <div className="flex flex-wrap gap-4">
        {SEMANTIC_TAGS.map((tag) => (
          <label key={tag}>
            <input
              type="checkbox"
              checked={selectedTags.includes(tag)}
              onChange={(e) =>
                setTags(
                  e.target.checked ? [...selectedTags, tag] : selectedTags.filter((x) => x !== tag),
                )
              }
            />{' '}
            {tags[tag]}
          </label>
        ))}
      </div>
      <label className="block">
        复核依据
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
      </label>
      <Button
        disabled={mutation.isPending || !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(family) || !note.trim()}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending ? '保存中…' : '保存复核'}
      </Button>
      {mutation.isError && <LoadError error={mutation.error} onRetry={() => mutation.mutate()} />}
    </article>
  );
}
