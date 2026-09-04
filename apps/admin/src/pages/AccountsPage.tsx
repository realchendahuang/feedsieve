import React from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { ConfirmDialog } from '../components/confirm';
import { FlashMessage, useFlash } from '../components/flash';
import { Loading, PageHeader } from '../components/layout';
import { getAccounts, publishAccounts, removeAccount, saveAccount, type AccountEntry } from '../lib/api';
import { errorText } from '../lib/errors';

const accountSchema = z.object({
  handle: z.string().refine((value) => /^@?[a-zA-Z0-9_]{1,15}$/.test(value.trim()), '账号格式不正确'),
  category: z.string().min(1, '选择分类'),
  x_user_id: z.string(),
  evidence_post_id: z.string(),
  note: z.string().refine((value) => {
    const note = value.trim();
    return note.length >= 4 && note.length <= 240;
  }, '备注需要 4-240 字'),
});

type AccountFormValues = {
  handle: string;
  category: string;
  x_user_id: string;
  evidence_post_id: string;
  note: string;
};

const blankAccount = (): AccountFormValues => ({
  handle: '',
  category: 'scam_phishing',
  x_user_id: '',
  evidence_post_id: '',
  note: '',
});

function toFormValues(entry: AccountEntry): AccountFormValues {
  return {
    handle: entry.handle,
    category: entry.category,
    x_user_id: entry.x_user_id ?? '',
    evidence_post_id: entry.evidence_post_id ?? '',
    note: entry.note,
  };
}

/** 编辑器是独立组件：key 随编辑目标变化整体重挂，表单默认值随之刷新，无需 effect 同步。 */
function AccountEditor({
  entry,
  categories,
  busy,
  onSave,
  onCancel,
}: {
  entry: AccountEntry | null;
  categories: readonly string[];
  busy: boolean;
  onSave: (values: AccountFormValues) => Promise<void>;
  onCancel: () => void;
}) {
  const defaults = entry ? toFormValues(entry) : blankAccount();
  const form = useForm<AccountFormValues, unknown, AccountFormValues>({
    resolver: zodResolver(accountSchema),
    defaultValues: defaults,
  });
  const errors = form.formState.errors;
  const submit = form.handleSubmit(async (values) => onSave(values));
  return (
    <form className="editor-card form-grid" onSubmit={submit} noValidate>
      <label>账号
        <input {...form.register('handle')} placeholder="@账号" />
        {errors.handle ? <span className="field-error">{errors.handle.message}</span> : null}
      </label>
      <label>分类
        <select {...form.register('category')}>
          {categories.map((category) => <option key={category} value={category}>{category}</option>)}
        </select>
      </label>
      <label>用户 ID<input {...form.register('x_user_id')} /></label>
      <label>证据贴文 ID<input {...form.register('evidence_post_id')} /></label>
      <label className="span-2">备注
        <textarea {...form.register('note')} />
        {errors.note ? <span className="field-error">{errors.note.message}</span> : null}
      </label>
      <div className="form-actions span-2">
        <button type="submit" disabled={busy}>{entry ? '保存修改' : '保存草稿'}</button>
        <button type="button" className="secondary" onClick={onCancel}>取消</button>
      </div>
    </form>
  );
}

export function AccountsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { q?: string; edit?: string };
  const q = search.q?.trim() ?? '';
  const accounts = useQuery({ queryKey: ['accounts', q], queryFn: () => getAccounts(q || undefined) });
  const [flash, showFlash] = useFlash();
  const [busy, setBusy] = React.useState(false);
  const [removing, setRemoving] = React.useState<AccountEntry | null>(null);
  const searchInput = React.useRef<HTMLInputElement>(null);

  const entries = accounts.data?.entries ?? [];
  const categories = accounts.data?.categories ?? ['scam_phishing'];
  const editing = search.edit ?? null;
  const editingEntry = editing
    ? entries.find((entry) => entry.handle === editing && entry.active) ?? null
    : null;
  // key 里带上 updated_at：目标行内容变化（如加载完成）也会重挂，编辑目标不存在时保持 loading 占位。
  const editorKey = editing ? `${editing}:${editingEntry?.updated_at ?? 'loading'}` : 'new';

  const clearEdit = () => {
    if (editing) {
      navigate({ to: '/accounts', search: (prev) => ({ ...prev, edit: undefined }) });
    }
  };

  // 编辑目标不存在（已移除）时清掉 edit 参数。
  React.useEffect(() => {
    if (editing && accounts.data && !editingEntry) clearEdit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, accounts.data, editingEntry]);

  const save = async (values: AccountFormValues) => {
    setBusy(true);
    try {
      await saveAccount({
        handle: values.handle.trim().replace(/^@+/, '').toLowerCase(),
        category: values.category,
        x_user_id: values.x_user_id.trim() || null,
        evidence_post_id: values.evidence_post_id.trim() || null,
        note: values.note.trim(),
      });
      await queryClient.invalidateQueries({ queryKey: ['accounts'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      showFlash('success', editing ? '草稿已更新' : '草稿已保存');
      clearEdit();
    } catch (error) {
      showFlash('error', errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (handle: string) => {
    setBusy(true);
    try {
      await removeAccount(handle);
      await queryClient.invalidateQueries({ queryKey: ['accounts'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      showFlash('success', '草稿已移除');
      if (editing === handle) clearEdit();
    } catch (error) {
      showFlash('error', errorText(error));
    } finally {
      setBusy(false);
      setRemoving(null);
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

  const applySearch = () => {
    const value = searchInput.current?.value.trim() ?? '';
    navigate({ to: '/accounts', search: (prev) => ({ ...prev, q: value || undefined }) });
  };
  const clearSearch = () => {
    if (searchInput.current) searchInput.current.value = '';
    navigate({ to: '/accounts', search: (prev) => ({ ...prev, q: undefined }) });
  };

  return (
    <section className="page">
      <PageHeader title="账号黑名单"><button type="button" onClick={publish} disabled={busy}>发布名单</button></PageHeader>
      <FlashMessage flash={flash} />
      <AccountEditor
        key={editorKey}
        entry={editingEntry}
        categories={categories}
        busy={busy}
        onSave={save}
        onCancel={clearEdit}
      />
      <div className="toolbar">
        <input
          ref={searchInput}
          key={q}
          defaultValue={q}
          className="search-input"
          placeholder="搜账号或备注"
          onKeyDown={(event) => { if (event.key === 'Enter') applySearch(); }}
        />
        <button type="button" className="secondary" onClick={applySearch}>搜索</button>
        {q ? <button type="button" className="secondary" onClick={clearSearch}>清除</button> : null}
      </div>
      {!accounts.data ? <Loading error={accounts.error} /> : (
        <div className="table-wrap"><table><thead><tr><th>账号</th><th>分类</th><th>备注</th><th>状态</th><th /></tr></thead><tbody>
          {entries.map((entry) => <tr key={entry.handle}><td>@{entry.handle}</td><td>{entry.category}</td><td>{entry.note}</td><td>{entry.active ? '草稿' : '已移除'}</td><td className="row-actions">{entry.active ? <><button type="button" className="secondary" onClick={() => navigate({ to: '/accounts', search: (prev) => ({ ...prev, edit: entry.handle }) })}>编辑</button><button type="button" className="danger" onClick={() => setRemoving(entry)} disabled={busy}>移除</button></> : null}</td></tr>)}
        </tbody></table></div>
      )}
      <ConfirmDialog
        open={removing !== null}
        title={`移除 @${removing?.handle ?? ''}？`}
        body="草稿标记为已移除；已发布的内容要再次发布名单后才会更新。"
        confirmLabel="移除"
        busy={busy}
        onConfirm={() => removing && remove(removing.handle)}
        onCancel={() => setRemoving(null)}
      />
    </section>
  );
}
