import React from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { ConfirmDialog } from '../components/confirm';
import { FlashMessage, useFlash } from '../components/flash';
import { Loading, PageHeader } from '../components/layout';
import {
  getKeywords,
  importKeywordCatalog,
  publishKeywords,
  removePack,
  removeRule,
  savePack,
  saveRule,
  type KeywordPack,
  type KeywordRule,
} from '../lib/api';
import { errorText } from '../lib/errors';

const splitTerms = (value: string): string[] =>
  value.split(/[,，]/).map((term) => term.trim()).filter(Boolean);

const packSchema = z.object({
  id: z.string(),
  name_zh: z.string().refine((value) => value.trim().length > 0, '分类名称必填'),
  name_en: z.string(),
  description_zh: z.string().refine((value) => value.trim().length > 0, '分类备注必填'),
  description_en: z.string(),
  source_refs: z.string(),
});

const ruleSchema = z.object({
  id: z.string(),
  pack_id: z.string().min(1, '选择分类'),
  phrase: z.string().refine((value) => {
    const phrase = value.trim();
    return phrase.length > 0 && phrase.length <= 80;
  }, '词组需要 1-80 字'),
  terms: z.string(),
  max_gap: z.string(),
}).refine((values) => {
  const terms = splitTerms(values.terms);
  if (!terms.length) return true;
  const maxGap = Number(values.max_gap.trim());
  return terms.length >= 2 && terms.length <= 5 && Number.isInteger(maxGap) && maxGap >= 0 && maxGap <= 32;
}, '分词需要 2-5 个；最大间隔为 0-32 的整数');

type PackFormValues = {
  id: string;
  name_zh: string;
  name_en: string;
  description_zh: string;
  description_en: string;
  source_refs: string;
};

type RuleFormValues = {
  id: string;
  pack_id: string;
  phrase: string;
  terms: string;
  max_gap: string;
};

const blankPack = (): PackFormValues => ({ id: '', name_zh: '', name_en: '', description_zh: '', description_en: '', source_refs: '' });
const blankRule = (): RuleFormValues => ({ id: '', pack_id: '', phrase: '', terms: '', max_gap: '' });

function packToForm(pack: KeywordPack): PackFormValues {
  return {
    id: pack.id,
    name_zh: pack.name_zh,
    name_en: pack.name_en,
    description_zh: pack.description_zh,
    description_en: pack.description_en,
    source_refs: pack.source_refs.join(', '),
  };
}

function ruleToForm(rule: KeywordRule): RuleFormValues {
  return {
    id: rule.id,
    pack_id: rule.pack_id,
    phrase: rule.phrase,
    terms: rule.terms?.join(', ') ?? '',
    max_gap: rule.max_gap === null ? '' : String(rule.max_gap),
  };
}

function PackEditor({
  pack,
  busy,
  onSave,
  onCancel,
}: {
  pack: KeywordPack | null;
  busy: boolean;
  onSave: (values: PackFormValues) => Promise<void>;
  onCancel: () => void;
}) {
  const defaults = pack ? packToForm(pack) : blankPack();
  const form = useForm<PackFormValues, unknown, PackFormValues>({
    resolver: zodResolver(packSchema),
    defaultValues: defaults,
  });
  const errors = form.formState.errors;
  const submit = form.handleSubmit(async (values) => onSave(values));
  return (
    <form className="editor-card form-grid" onSubmit={submit} noValidate>
      <label>分类名称
        <input {...form.register('name_zh')} />
        {errors.name_zh ? <span className="field-error">{errors.name_zh.message}</span> : null}
      </label>
      <label>英文名称<input {...form.register('name_en')} /></label>
      <label>分类备注
        <input {...form.register('description_zh')} />
        {errors.description_zh ? <span className="field-error">{errors.description_zh.message}</span> : null}
      </label>
      <label>英文备注<input {...form.register('description_en')} /></label>
      <label className="span-2">来源<input {...form.register('source_refs')} placeholder="逗号分隔" /></label>
      <div className="form-actions span-2">
        <button type="submit" disabled={busy}>{pack ? '保存修改' : '保存草稿'}</button>
        <button type="button" className="secondary" onClick={onCancel}>取消</button>
      </div>
    </form>
  );
}

function RuleEditor({
  rule,
  packs,
  busy,
  onSave,
  onCancel,
}: {
  rule: KeywordRule | null;
  packs: KeywordPack[];
  busy: boolean;
  onSave: (values: RuleFormValues) => Promise<void>;
  onCancel: () => void;
}) {
  const defaults = rule
    ? ruleToForm(rule)
    : { ...blankRule(), pack_id: packs[0]?.id ?? '' };
  const form = useForm<RuleFormValues, unknown, RuleFormValues>({
    resolver: zodResolver(ruleSchema),
    defaultValues: defaults,
  });
  const errors = form.formState.errors;
  const submit = form.handleSubmit(async (values) => onSave(values));
  return (
    <form className="editor-card form-grid" onSubmit={submit} noValidate>
      <label>分类
        <select {...form.register('pack_id')}>
          {packs.map((pack) => <option key={pack.id} value={pack.id}>{pack.name_zh}</option>)}
        </select>
        {errors.pack_id ? <span className="field-error">{errors.pack_id.message}</span> : null}
      </label>
      <label>词组
        <input {...form.register('phrase')} />
        {errors.phrase ? <span className="field-error">{errors.phrase.message}</span> : null}
      </label>
      <label>分词<input {...form.register('terms')} placeholder="逗号分隔，2-5 个" /></label>
      <label>最大间隔<input inputMode="numeric" {...form.register('max_gap')} /></label>
      {errors.root?.message ? <span className="field-error span-2">{errors.root.message}</span> : null}
      <div className="form-actions span-2">
        <button type="submit" disabled={busy}>{rule ? '保存修改' : '保存草稿'}</button>
        <button type="button" className="secondary" onClick={onCancel}>取消</button>
      </div>
    </form>
  );
}

type Removal = { kind: 'pack' | 'rule'; id: string } | null;

type KeywordsSearch = {
  q?: string;
  pack?: string;
  editor?: 'pack' | 'rule';
  edit_pack?: string;
  edit_rule?: string;
};

export function KeywordsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as KeywordsSearch;
  const q = search.q?.trim() ?? '';
  const packFilter = search.pack?.trim() ?? '';
  const keywords = useQuery({
    queryKey: ['keywords', q, packFilter],
    queryFn: () => getKeywords({ q: q || undefined, packId: packFilter || undefined }),
  });
  const [flash, showFlash] = useFlash();
  const [busy, setBusy] = React.useState(false);
  const [removing, setRemoving] = React.useState<Removal>(null);
  const [importing, setImporting] = React.useState(false);
  const searchInput = React.useRef<HTMLInputElement>(null);

  const packs = keywords.data?.packs ?? [];
  const activePacks = packs.filter((pack) => pack.active);
  const rules = keywords.data?.rules ?? [];
  const newPack = search.editor === 'pack';
  const newRule = search.editor === 'rule';
  const editingPack = activePacks.find((pack) => pack.id === (search.edit_pack ?? ''));
  const editingRule = rules.find((rule) => rule.id === (search.edit_rule ?? '')) ?? null;

  const patchSearch = (patch: KeywordsSearch) => {
    navigate({ to: '/keywords', search: (prev) => ({ ...prev, ...patch }) });
  };
  const closeEditors = () => patchSearch({ editor: undefined, edit_pack: undefined, edit_rule: undefined });

  const handleSavePack = async (values: PackFormValues) => {
    setBusy(true);
    try {
      await savePack({
        id: values.id || undefined,
        name_zh: values.name_zh.trim(),
        name_en: values.name_en.trim(),
        description_zh: values.description_zh.trim(),
        description_en: values.description_en.trim(),
        source_refs: splitTerms(values.source_refs),
      });
      await queryClient.invalidateQueries({ queryKey: ['keywords'] });
      showFlash('success', values.id ? '分类已更新' : '分类已保存');
      closeEditors();
    } catch (error) {
      showFlash('error', errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const handleSaveRule = async (values: RuleFormValues) => {
    const terms = splitTerms(values.terms);
    setBusy(true);
    try {
      await saveRule({
        id: values.id || undefined,
        pack_id: values.pack_id,
        phrase: values.phrase.trim(),
        terms,
        max_gap: terms.length ? Number(values.max_gap.trim()) : undefined,
      });
      await queryClient.invalidateQueries({ queryKey: ['keywords'] });
      showFlash('success', values.id ? '规则已更新' : '规则已保存');
      closeEditors();
    } catch (error) {
      showFlash('error', errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    setBusy(true);
    try {
      const result = await publishKeywords();
      await queryClient.invalidateQueries({ queryKey: ['releases'] });
      showFlash('success', `词库已发布 ${result.version}`);
    } catch (error) {
      showFlash('error', errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (kind: 'pack' | 'rule', id: string) => {
    setBusy(true);
    try {
      if (kind === 'pack') await removePack(id); else await removeRule(id);
      await queryClient.invalidateQueries({ queryKey: ['keywords'] });
      showFlash('success', '草稿已移除');
      if (kind === 'pack' && search.edit_pack === id) closeEditors();
      if (kind === 'rule' && search.edit_rule === id) closeEditors();
    } catch (error) {
      showFlash('error', errorText(error));
    } finally {
      setBusy(false);
      setRemoving(null);
    }
  };

  const importCatalog = async () => {
    setImporting(true);
    try {
      const result = await importKeywordCatalog();
      await queryClient.invalidateQueries({ queryKey: ['keywords'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      showFlash('success', result.imported ? `已导入 ${result.packs} 个分类 ${result.rules} 条规则` : '没有可导入的公开词库');
    } catch (error) {
      showFlash('error', errorText(error));
    } finally {
      setImporting(false);
    }
  };

  const applySearch = () => {
    const value = searchInput.current?.value.trim() ?? '';
    patchSearch({ q: value || undefined });
  };
  const clearSearch = () => {
    if (searchInput.current) searchInput.current.value = '';
    patchSearch({ q: undefined, pack: undefined });
  };
  const showImport = keywords.data !== undefined && activePacks.length === 0 && !q && !packFilter;

  return (
    <section className="page">
      <PageHeader title="关键词词库">
        <button type="button" className="secondary" onClick={() => patchSearch({ editor: 'pack', edit_pack: undefined })}>新增分类</button>
        <button type="button" className="secondary" onClick={() => patchSearch({ editor: 'rule', edit_rule: undefined })}>新增规则</button>
        <button type="button" onClick={publish} disabled={busy}>发布词库</button>
      </PageHeader>
      <FlashMessage flash={flash} />
      {newPack || search.edit_pack ? (
        <PackEditor
          key={editingPack ? `pack-${editingPack.id}:${editingPack.updated_at}` : 'pack-new'}
          pack={newPack ? null : editingPack ?? null}
          busy={busy}
          onSave={handleSavePack}
          onCancel={closeEditors}
        />
      ) : null}
      {newRule || search.edit_rule ? (
        <RuleEditor
          key={editingRule ? `rule-${editingRule.id}:${editingRule.updated_at}` : 'rule-new'}
          rule={newRule ? null : editingRule}
          packs={activePacks}
          busy={busy}
          onSave={handleSaveRule}
          onCancel={closeEditors}
        />
      ) : null}
      <div className="toolbar">
        <input
          ref={searchInput}
          key={q}
          defaultValue={q}
          className="search-input"
          placeholder="搜词组"
          onKeyDown={(event) => { if (event.key === 'Enter') applySearch(); }}
        />
        <button type="button" className="secondary" onClick={applySearch}>搜索</button>
        {q || packFilter ? <button type="button" className="secondary" onClick={clearSearch}>清除</button> : null}
        {showImport ? <button type="button" className="secondary" onClick={importCatalog} disabled={importing}>导入公开词库</button> : null}
      </div>
      {!keywords.data ? <Loading error={keywords.error} /> : <div className="pack-list">
        {activePacks.map((pack) => {
          const packRules = rules.filter((rule) => rule.pack_id === pack.id && rule.active);
          return <details className="pack-card" key={pack.id}><summary><span>{pack.name_zh}</span><span>{packRules.length}</span></summary><div className="pack-body">
            <div className="row-actions"><button type="button" className="secondary" onClick={() => patchSearch({ editor: undefined, edit_pack: pack.id, edit_rule: undefined })}>编辑分类</button><button type="button" className="danger" onClick={() => setRemoving({ kind: 'pack', id: pack.id })} disabled={busy}>移除分类</button></div>
            <div className="table-wrap"><table><thead><tr><th>词组</th><th>分词</th><th>间隔</th><th /></tr></thead><tbody>{packRules.map((rule) => <tr key={rule.id}><td>{rule.phrase}</td><td>{rule.terms?.join(' · ') ?? '—'}</td><td>{rule.max_gap ?? '—'}</td><td className="row-actions"><button type="button" className="secondary" onClick={() => patchSearch({ editor: undefined, edit_pack: undefined, edit_rule: rule.id })}>编辑</button><button type="button" className="danger" onClick={() => setRemoving({ kind: 'rule', id: rule.id })} disabled={busy}>移除</button></td></tr>)}</tbody></table></div>
          </div></details>;
        })}
      </div>}
      <ConfirmDialog
        open={removing !== null}
        title={removing?.kind === 'pack' ? `移除分类 ${removing.id}？` : '移除这条规则？'}
        body="草稿标记为已移除；已发布的内容要再次发布词库后才会更新。"
        confirmLabel="移除"
        busy={busy}
        onConfirm={() => removing && remove(removing.kind, removing.id)}
        onCancel={() => setRemoving(null)}
      />
    </section>
  );
}
