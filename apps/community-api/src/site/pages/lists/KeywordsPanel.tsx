import { useMemo, useState } from 'react';
import type { KeywordPublicData } from '../../data.functions';
import { toast } from '../../components/ui/toast';

/**
 * 词库公示面板：搜索 + 词组胶囊 + 匿名贡献表单（自带 SSR 初始数据）。
 * 提交仍走同源 POST /v1/keyword-contributions（IP 哈希 5 条/日限流在服务端不变）。
 */
export function KeywordsPanel({ data }: { data: KeywordPublicData }) {
  const [query, setQuery] = useState('');
  const [contribute, setContribute] = useState('');
  const [busy, setBusy] = useState(false);

  const packs = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...data.packs].sort((a, b) => b.rules.length - a.rules.length);
    if (!q) return sorted;
    return sorted
      .map((pack) => ({
        ...pack,
        rules: pack.rules.filter((r) => r.phrase.toLowerCase().includes(q)),
      }))
      .filter((pack) => pack.rules.length > 0);
  }, [data.packs, query]);

  const matchedTotal = packs.reduce((n, p) => n + p.rules.length, 0);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const phrases = contribute
      .split(/[,，\n]/)
      .map((word) => word.trim())
      .filter(Boolean);
    if (phrases.length === 0) return;
    if (phrases.length > 10) {
      toast.info('一次最多提交 10 条');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/v1/keyword-contributions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phrases }),
      });
      const body = (await res.json().catch(() => ({}))) as { results?: Array<{ status: string }> };
      if (!res.ok) throw new Error((body as { error?: string }).error ?? 'network');
      const recorded = (body.results ?? []).filter((r) => r.status === 'recorded' || r.status === 'duplicate').length;
      if (recorded > 0) {
        toast.success(`已提交 ${recorded} 条，审阅通过后进入词库`);
        setContribute('');
      } else {
        toast.info('没有可提交的内容');
      }
    } catch (error) {
      toast.info(errorText(error instanceof Error ? error.message : 'network'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-mist">
          词库 {data.pack_version} · {data.total_rules} 条{data.signed ? ' · 已签名' : ''}
          {query && matchedTotal > 0 ? ` · 匹配 ${matchedTotal} 条` : ''}
        </p>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜词"
          aria-label="搜索词库规则"
          className="h-9 w-56 rounded-full border border-line bg-surface px-4 text-sm outline-none focus:border-gold focus:ring-[3px] focus:ring-ring/30"
        />
      </div>
      <form onSubmit={submit} className="mb-6 flex flex-wrap gap-2">
        <input
          type="text"
          value={contribute}
          onChange={(e) => setContribute(e.target.value)}
          placeholder="想加入词库的词，逗号分隔"
          maxLength={200}
          autoComplete="off"
          className="h-10 min-w-0 flex-1 rounded-full border border-line bg-surface px-4 text-sm outline-none focus:border-gold focus:ring-[3px] focus:ring-ring/30"
        />
        <button
          type="submit"
          disabled={busy}
          className="h-10 rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          提交
        </button>
      </form>
      <div className="grid gap-4">
        {packs.map((pack) => (
          <div key={pack.id} className="panel-card p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="font-bold">{pack.name?.zh ?? pack.id}</h2>
              <span className="text-xs text-mist">{pack.rules.length} 条</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {pack.rules.map((rule) => (
                <span key={rule.phrase} className="rounded-full bg-soft-surface px-2.5 py-1 text-xs text-mist">
                  {rule.phrase}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function errorText(code: string): string {
  return ERROR_TEXT[code as keyof typeof ERROR_TEXT] ?? `提交失败（${code}）`;
}

export const ERROR_TEXT = {
  invalid_handle: '账号名不合法',
  invalid_email: '邮箱不合法',
  invalid_statement: '陈述需 8–500 字',
  too_many_submissions: '今日提交次数已达上限',
  too_many_code_requests: '验证码发送太频繁，1 小时后再试',
  too_many_attempts: '错码次数过多，请重新提交',
  invalid_or_expired_code: '验证码错误或已过期',
  application_pending: '该账号已有申请在处理中',
  application_not_found: '没有待验证的申请',
  mail_unconfigured: '邮件通道未配置，暂无法提交',
  batch_too_large: '一次最多提交 10 条',
  rate_limited: '今日提交已达上限，明天再来',
  network: '网络错误，稍后再试',
} as const;
