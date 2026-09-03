import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, RouterProvider, createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import {
  type AccountEntry,
  type KeywordPack,
  type KeywordRule,
  getAccounts,
  getDashboard,
  getFeedback,
  getKeywords,
  getMe,
  getReleases,
  publishAccounts,
  publishKeywords,
  removeAccount,
  removePack,
  removeRule,
  rollbackRelease,
  saveAccount,
  savePack,
  saveRule,
} from './api';
import './styles.css';

const navigation = [
  ['/', '概览'],
  ['/accounts', '账号'],
  ['/keywords', '词库'],
  ['/feedback', '反馈'],
  ['/releases', '发布'],
  ['/settings', '设置'],
] as const;

type Flash = { tone: 'success' | 'error'; text: string } | null;

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : '操作失败';
  const labels: Record<string, string> = {
    invalid_pack: '分类内容不完整',
    invalid_rule: '规则内容不完整',
    invalid_note: '备注至少需要四个字',
    invalid_handle: '账号格式不正确',
    access_required: 'Access 身份未授权',
    release_not_found: '发布记录不存在',
    release_archive_missing: '发布归档不存在',
    release_archive_invalid: '发布归档不可用',
  };
  return labels[message] ?? message;
}

function useFlash(): [Flash, (tone: Flash extends null ? never : 'success' | 'error', text: string) => void] {
  const [flash, setFlash] = React.useState<Flash>(null);
  const timer = React.useRef<number | null>(null);
  React.useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);
  return [flash, (tone, text) => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    setFlash({ tone, text });
    timer.current = window.setTimeout(() => setFlash(null), 4000);
  }];
}

function FlashMessage({ flash }: { flash: Flash }) {
  return flash ? <div className={`flash ${flash.tone}`} role="status">{flash.text}</div> : null;
}

function PageHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return <header className="page-header"><h1>{title}</h1>{children ? <div className="actions">{children}</div> : null}</header>;
}

function Loading({ error }: { error?: unknown }) {
  return <div className="empty-state">{error ? errorText(error) : '读取中…'}</div>;
}

function Layout() {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">FeedSieve</div>
        <nav aria-label="管理导航">
          {navigation.map(([to, label]) => <Link key={to} to={to} activeProps={{ className: 'active' }}>{label}</Link>)}
        </nav>
      </aside>
      <main className="main"><Outlet /></main>
    </div>
  );
}

function DashboardPage() {
  const dashboard = useQuery({ queryKey: ['dashboard'], queryFn: getDashboard });
  if (!dashboard.data) return <section className="page"><PageHeader title="概览" /><Loading error={dashboard.error} /></section>;
  return (
    <section className="page">
      <PageHeader title="概览" />
      <div className="metrics">
        <div><strong>{dashboard.data.maintainer_entries}</strong><span>账号草稿</span></div>
        <div><strong>{dashboard.data.community_accounts}</strong><span>社区账号</span></div>
        <div><strong>{dashboard.data.false_positive_feedback}</strong><span>误标反馈</span></div>
        <div><strong>{dashboard.data.snapshot_version ?? '—'}</strong><span>名单版本</span></div>
      </div>
    </section>
  );
}

const blankAccount = () => ({ handle: '', x_user_id: '', category: 'scam_phishing', note: '', evidence_post_id: '' });

function AccountsPage() {
  const queryClient = useQueryClient();
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: getAccounts });
  const [flash, showFlash] = useFlash();
  const [form, setForm] = React.useState(blankAccount);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const entries = accounts.data?.entries ?? [];
  const categories = accounts.data?.categories ?? ['scam_phishing'];

  const reset = () => {
    setForm(blankAccount());
    setEditing(null);
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await saveAccount({
        ...form,
        x_user_id: form.x_user_id || null,
        evidence_post_id: form.evidence_post_id || null,
      });
      await queryClient.invalidateQueries({ queryKey: ['accounts'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      showFlash('success', editing ? '草稿已更新' : '草稿已保存');
      reset();
    } catch (error) {
      showFlash('error', errorText(error));
    } finally {
      setBusy(false);
    }
  };
  const edit = (entry: AccountEntry) => {
    setEditing(entry.handle);
    setForm({
      handle: entry.handle,
      x_user_id: entry.x_user_id ?? '',
      category: entry.category,
      note: entry.note,
      evidence_post_id: entry.evidence_post_id ?? '',
    });
  };
  const remove = async (handle: string) => {
    setBusy(true);
    try {
      await removeAccount(handle);
      await queryClient.invalidateQueries({ queryKey: ['accounts'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      showFlash('success', '草稿已移除');
      if (editing === handle) reset();
    } catch (error) {
      showFlash('error', errorText(error));
    } finally {
      setBusy(false);
    }
  };
  const publish = async () => {
    setBusy(true);
    try {
      const result = await publishAccounts();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['releases'] }),
      ]);
      showFlash('success', `名单已发布 ${result.snapshot_version}`);
    } catch (error) {
      showFlash('error', errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="page">
      <PageHeader title="账号黑名单"><button type="button" onClick={publish} disabled={busy}>发布名单</button></PageHeader>
      <FlashMessage flash={flash} />
      <form className="editor-card form-grid" onSubmit={submit}>
        <label>账号<input value={form.handle} onChange={(event) => setForm({ ...form, handle: event.target.value })} placeholder="@账号" required /></label>
        <label>分类<select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
        <label>用户 ID<input value={form.x_user_id} onChange={(event) => setForm({ ...form, x_user_id: event.target.value })} /></label>
        <label>证据贴文 ID<input value={form.evidence_post_id} onChange={(event) => setForm({ ...form, evidence_post_id: event.target.value })} /></label>
        <label className="span-2">备注<textarea value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} required /></label>
        <div className="form-actions span-2"><button disabled={busy}>{editing ? '保存修改' : '保存草稿'}</button>{editing ? <button type="button" className="secondary" onClick={reset}>取消</button> : null}</div>
      </form>
      {!accounts.data ? <Loading error={accounts.error} /> : (
        <div className="table-wrap"><table><thead><tr><th>账号</th><th>分类</th><th>备注</th><th>状态</th><th /></tr></thead><tbody>
          {entries.map((entry) => <tr key={entry.handle}><td>@{entry.handle}</td><td>{entry.category}</td><td>{entry.note}</td><td>{entry.active ? '草稿' : '已移除'}</td><td className="row-actions">{entry.active ? <><button type="button" className="secondary" onClick={() => edit(entry)}>编辑</button><button type="button" className="danger" onClick={() => remove(entry.handle)} disabled={busy}>移除</button></> : null}</td></tr>)}
        </tbody></table></div>
      )}
    </section>
  );
}

const blankPack = () => ({ id: '', name_zh: '', name_en: '', description_zh: '', description_en: '', source_refs: '' });
const blankRule = () => ({ id: '', pack_id: '', phrase: '', terms: '', max_gap: '' });

function parseTerms(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function KeywordsPage() {
  const queryClient = useQueryClient();
  const keywords = useQuery({ queryKey: ['keywords'], queryFn: getKeywords });
  const [flash, showFlash] = useFlash();
  const [packForm, setPackForm] = React.useState(blankPack);
  const [ruleForm, setRuleForm] = React.useState(blankRule);
  const [showPackEditor, setShowPackEditor] = React.useState(false);
  const [showRuleEditor, setShowRuleEditor] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const packs = (keywords.data?.packs ?? []).filter((pack) => Number(pack.active) === 1);
  const rules = keywords.data?.rules ?? [];
  const refresh = async () => queryClient.invalidateQueries({ queryKey: ['keywords'] });
  const submitPack = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await savePack({
        ...packForm,
        source_refs: packForm.source_refs.split(',').map((item) => item.trim()).filter(Boolean),
      });
      await refresh();
      showFlash('success', packForm.id ? '分类已更新' : '分类已保存');
      setPackForm(blankPack());
      setShowPackEditor(false);
    } catch (error) { showFlash('error', errorText(error)); } finally { setBusy(false); }
  };
  const submitRule = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const terms = ruleForm.terms.split(',').map((item) => item.trim()).filter(Boolean);
      await saveRule({ ...ruleForm, terms, max_gap: terms.length ? ruleForm.max_gap : undefined });
      await refresh();
      showFlash('success', ruleForm.id ? '规则已更新' : '规则已保存');
      setRuleForm(blankRule());
      setShowRuleEditor(false);
    } catch (error) { showFlash('error', errorText(error)); } finally { setBusy(false); }
  };
  const publish = async () => {
    setBusy(true);
    try {
      const result = await publishKeywords();
      await queryClient.invalidateQueries({ queryKey: ['releases'] });
      showFlash('success', `词库已发布 ${result.version}`);
    } catch (error) { showFlash('error', errorText(error)); } finally { setBusy(false); }
  };
  const remove = async (kind: 'pack' | 'rule', id: string) => {
    setBusy(true);
    try {
      if (kind === 'pack') await removePack(id); else await removeRule(id);
      await refresh();
      showFlash('success', '草稿已移除');
    } catch (error) { showFlash('error', errorText(error)); } finally { setBusy(false); }
  };
  const editPack = (pack: KeywordPack) => {
    setPackForm({
      id: pack.id,
      name_zh: pack.name_zh,
      name_en: pack.name_en,
      description_zh: pack.description_zh,
      description_en: pack.description_en,
      source_refs: parseTerms(pack.source_refs).join(', '),
    });
    setShowPackEditor(true);
  };
  const editRule = (rule: KeywordRule) => {
    setRuleForm({
      id: rule.id,
      pack_id: rule.pack_id,
      phrase: rule.phrase,
      terms: parseTerms(rule.terms).join(', '),
      max_gap: rule.max_gap === null ? '' : String(rule.max_gap),
    });
    setShowRuleEditor(true);
  };

  return (
    <section className="page">
      <PageHeader title="关键词词库">
        <button type="button" className="secondary" onClick={() => { setPackForm(blankPack()); setShowPackEditor(true); }}>新增分类</button>
        <button type="button" className="secondary" onClick={() => { setRuleForm({ ...blankRule(), pack_id: packs[0]?.id ?? '' }); setShowRuleEditor(true); }}>新增规则</button>
        <button type="button" onClick={publish} disabled={busy}>发布词库</button>
      </PageHeader>
      <FlashMessage flash={flash} />
      {showPackEditor ? <form className="editor-card form-grid" onSubmit={submitPack}>
        <label>分类名称<input value={packForm.name_zh} onChange={(event) => setPackForm({ ...packForm, name_zh: event.target.value })} required /></label>
        <label>英文名称<input value={packForm.name_en} onChange={(event) => setPackForm({ ...packForm, name_en: event.target.value })} /></label>
        <label>分类备注<input value={packForm.description_zh} onChange={(event) => setPackForm({ ...packForm, description_zh: event.target.value })} required /></label>
        <label>英文备注<input value={packForm.description_en} onChange={(event) => setPackForm({ ...packForm, description_en: event.target.value })} /></label>
        <label className="span-2">来源<input value={packForm.source_refs} onChange={(event) => setPackForm({ ...packForm, source_refs: event.target.value })} /></label>
        <div className="form-actions span-2"><button disabled={busy}>{packForm.id ? '保存修改' : '保存草稿'}</button><button type="button" className="secondary" onClick={() => setShowPackEditor(false)}>取消</button></div>
      </form> : null}
      {showRuleEditor ? <form className="editor-card form-grid" onSubmit={submitRule}>
        <label>分类<select value={ruleForm.pack_id} onChange={(event) => setRuleForm({ ...ruleForm, pack_id: event.target.value })} required>{packs.map((pack) => <option key={pack.id} value={pack.id}>{pack.name_zh}</option>)}</select></label>
        <label>词组<input value={ruleForm.phrase} onChange={(event) => setRuleForm({ ...ruleForm, phrase: event.target.value })} required /></label>
        <label>分词<input value={ruleForm.terms} onChange={(event) => setRuleForm({ ...ruleForm, terms: event.target.value })} /></label>
        <label>最大间隔<input inputMode="numeric" value={ruleForm.max_gap} onChange={(event) => setRuleForm({ ...ruleForm, max_gap: event.target.value })} /></label>
        <div className="form-actions span-2"><button disabled={busy}>{ruleForm.id ? '保存修改' : '保存草稿'}</button><button type="button" className="secondary" onClick={() => setShowRuleEditor(false)}>取消</button></div>
      </form> : null}
      {!keywords.data ? <Loading error={keywords.error} /> : <div className="pack-list">
        {packs.map((pack) => {
          const packRules = rules.filter((rule) => rule.pack_id === pack.id && Number(rule.active) === 1);
          return <details className="pack-card" key={pack.id}><summary><span>{pack.name_zh}</span><span>{packRules.length}</span></summary><div className="pack-body">
            <div className="row-actions"><button type="button" className="secondary" onClick={() => editPack(pack)}>编辑分类</button><button type="button" className="danger" onClick={() => remove('pack', pack.id)} disabled={busy}>移除分类</button></div>
            <div className="table-wrap"><table><thead><tr><th>词组</th><th>分词</th><th>间隔</th><th /></tr></thead><tbody>{packRules.map((rule) => <tr key={rule.id}><td>{rule.phrase}</td><td>{parseTerms(rule.terms).join(' · ')}</td><td>{rule.max_gap ?? '—'}</td><td className="row-actions"><button type="button" className="secondary" onClick={() => editRule(rule)}>编辑</button><button type="button" className="danger" onClick={() => remove('rule', rule.id)} disabled={busy}>移除</button></td></tr>)}</tbody></table></div>
          </div></details>;
        })}
      </div>}
    </section>
  );
}

function FeedbackPage() {
  const feedback = useQuery({ queryKey: ['feedback'], queryFn: getFeedback });
  return <section className="page"><PageHeader title="用户反馈" />{!feedback.data ? <Loading error={feedback.error} /> : <>
    <div className="table-wrap"><table><thead><tr><th>来源</th><th>规则</th><th>数量</th></tr></thead><tbody>{feedback.data.summary.map((item) => <tr key={`${item.detection_source}-${item.rule_id}`}><td>{item.detection_source}</td><td>{item.rule_id}</td><td>{item.count}</td></tr>)}</tbody></table></div>
    <div className="table-wrap spaced"><table><thead><tr><th>账号</th><th>规则</th><th>分类</th><th>时间</th></tr></thead><tbody>{feedback.data.feedback.map((item, index) => <tr key={`${item.handle}-${item.created_at}-${index}`}><td>@{item.handle}</td><td>{item.rule_id ?? '—'}</td><td>{item.category ?? '—'}</td><td>{new Date(item.created_at * 1000).toLocaleString('zh-CN')}</td></tr>)}</tbody></table></div>
  </>}</section>;
}

function ReleasesPage() {
  const queryClient = useQueryClient();
  const releases = useQuery({ queryKey: ['releases'], queryFn: getReleases });
  const [flash, showFlash] = useFlash();
  const [busy, setBusy] = React.useState<number | null>(null);
  const rollback = async (id: number) => {
    setBusy(id);
    try {
      const result = await rollbackRelease(id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['releases'] }),
        queryClient.invalidateQueries({ queryKey: ['accounts'] }),
        queryClient.invalidateQueries({ queryKey: ['keywords'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      ]);
      showFlash('success', `已回退 ${result.snapshot_version ?? result.version ?? ''}`);
    } catch (error) { showFlash('error', errorText(error)); } finally { setBusy(null); }
  };
  return <section className="page"><PageHeader title="发布记录" /><FlashMessage flash={flash} />{!releases.data ? <Loading error={releases.error} /> : <div className="table-wrap"><table><thead><tr><th>类型</th><th>版本</th><th>维护者</th><th>时间</th><th /></tr></thead><tbody>{releases.data.map((release) => <tr key={release.id}><td>{release.kind === 'accounts' ? '名单' : '词库'}</td><td>{release.version}</td><td>{release.actor_email}</td><td>{new Date(release.created_at * 1000).toLocaleString('zh-CN')}</td><td className="row-actions"><button type="button" className="secondary" disabled={busy !== null} onClick={() => rollback(release.id)}>回退</button></td></tr>)}</tbody></table></div>}</section>;
}

function SettingsPage() {
  const me = useQuery({ queryKey: ['me'], queryFn: getMe });
  return <section className="page"><PageHeader title="后台设置" />{!me.data ? <Loading error={me.error} /> : <div className="settings-value"><span>维护者邮箱</span><strong>{me.data.email}</strong></div>}</section>;
}

const rootRoute = createRootRoute({ component: Layout });
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: DashboardPage });
const accountsRoute = createRoute({ getParentRoute: () => rootRoute, path: 'accounts', component: AccountsPage });
const keywordsRoute = createRoute({ getParentRoute: () => rootRoute, path: 'keywords', component: KeywordsPage });
const feedbackRoute = createRoute({ getParentRoute: () => rootRoute, path: 'feedback', component: FeedbackPage });
const releasesRoute = createRoute({ getParentRoute: () => rootRoute, path: 'releases', component: ReleasesPage });
const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: 'settings', component: SettingsPage });
const routeTree = rootRoute.addChildren([indexRoute, accountsRoute, keywordsRoute, feedbackRoute, releasesRoute, settingsRoute]);
const router = createRouter({ routeTree });
declare module '@tanstack/react-router' { interface Register { router: typeof router } }

const queryClient = new QueryClient();
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider></React.StrictMode>,
);
