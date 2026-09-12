import { useState } from 'react';
import { ERROR_TEXT, errorText } from './KeywordsPanel';

/**
 * 入册申请与误伤申诉（入册申请与误伤申诉页）：
 * 两步流程 = 提交（@handle + 邮箱 + 宣言）→ 6 位验证码验证。
 * POST /v1/applications 与 /verify 同源不变；限流（20 条/IP/日）在服务端。
 */
export default function ApplyPage() {
  const [phase, setPhase] = useState<'form' | 'verify'>('form');
  const [kind, setKind] = useState<'whitelist' | 'appeal'>('whitelist');
  const [handle, setHandle] = useState('');
  const [email, setEmail] = useState('');
  const [statement, setStatement] = useState('');
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const submitApplication = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMsg({ text: '提交中…', error: false });
    try {
      const res = await fetch('/v1/applications', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ handle, email, kind, statement }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; dev_code?: string };
      if (!res.ok) throw new Error(body.error ?? 'network');
      if (body.dev_code) setCode(body.dev_code);
      setPhase('verify');
      setMsg({ text: `验证码已发送到 ${email}`, error: false });
    } catch (error) {
      setMsg({ text: errorText(error instanceof Error ? error.message : 'network'), error: true });
    } finally {
      setBusy(false);
    }
  };

  const submitVerify = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMsg({ text: '验证中…', error: false });
    try {
      const res = await fetch('/v1/applications/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, code }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'network');
      setMsg({ text: '已进入处理队列。', error: false });
      setPhase('form');
      setStatement('');
      setCode('');
    } catch (error) {
      setMsg({ text: errorText(error instanceof Error ? error.message : 'network'), error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto max-w-2xl px-[clamp(18px,2.2vw,34px)] py-10">
      <h1 className="text-2xl font-bold tracking-tight">提交申请</h1>

      {phase === 'form' ? (
        <form onSubmit={submitApplication} id="apply-form" className="panel-card mt-6 space-y-4 p-6">
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="申请类型">
            <KindCard
              value="whitelist"
              checked={kind === 'whitelist'}
              onChange={() => setKind('whitelist')}
              title="进白名单"
              desc="博主宣言，公示展示"
            />
            <KindCard
              value="appeal"
              checked={kind === 'appeal'}
              onChange={() => setKind('appeal')}
              title="申诉误伤"
              desc="公示条目有误，请复核"
            />
          </div>
          <input
            type="text"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="@账号"
            maxLength={16}
            autoComplete="off"
            aria-label="账号名"
            className="h-10 w-full rounded-xl border border-line bg-surface px-4 text-sm outline-none focus:border-gold focus:ring-[3px] focus:ring-ring/30"
          />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="邮箱（用于验证）"
            autoComplete="email"
            aria-label="邮箱"
            className="h-10 w-full rounded-xl border border-line bg-surface px-4 text-sm outline-none focus:border-gold focus:ring-[3px] focus:ring-ring/30"
          />
          <textarea
            value={statement}
            onChange={(e) => setStatement(e.target.value)}
            rows={4}
            maxLength={500}
            placeholder="宣言或申诉理由（8–500 字）"
            aria-label="宣言或申诉理由"
            className="w-full rounded-xl border border-line bg-surface px-4 py-3 text-sm outline-none focus:border-gold focus:ring-[3px] focus:ring-ring/30"
          />
          <button
            type="submit"
            disabled={busy}
            className="h-10 w-full rounded-full bg-primary text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            提交
          </button>
          {msg && (
            <p id="apply-msg" role="status" className={msg.error ? 'text-sm text-destructive' : 'text-sm text-mist'}>
              {msg.text}
            </p>
          )}
        </form>
      ) : (
        <form onSubmit={submitVerify} id="verify-form" className="panel-card mt-6 space-y-4 p-6">
          <div className="flex gap-2">
            <input
              id="verify-code"
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="6 位验证码"
              inputMode="numeric"
              maxLength={6}
              autoComplete="one-time-code"
              aria-label="6 位验证码"
              className="h-10 flex-1 rounded-xl border border-line bg-surface px-4 text-sm outline-none focus:border-gold focus:ring-[3px] focus:ring-ring/30"
            />
            <button
              type="submit"
              disabled={busy}
              className="h-10 rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              验证
            </button>
          </div>
          {msg && (
            <p id="verify-msg" role="status" className={msg.error ? 'text-sm text-destructive' : 'text-sm text-mist'}>
              {msg.text}
            </p>
          )}
        </form>
      )}

      <p className="mt-4 text-xs text-mist">
        每 IP 每日 20 条额度，验证码邮箱 1 小时 3 封。
      </p>
    </main>
  );
}

function KindCard({
  value,
  checked,
  onChange,
  title,
  desc,
}: {
  value: string;
  checked: boolean;
  onChange: () => void;
  title: string;
  desc: string;
}) {
  return (
    <label
      data-value={value}
      className={`cursor-pointer rounded-xl border p-4 transition-colors ${
        checked ? 'border-gold bg-gold-surface' : 'border-line hover:bg-soft-surface'
      }`}
    >
      <input type="radio" name="kind" value={value} checked={checked} onChange={onChange} className="sr-only" />
      <span className="block font-semibold">{title}</span>
      <span className="mt-0.5 block text-xs text-mist">{desc}</span>
    </label>
  );
}

export { ERROR_TEXT };
