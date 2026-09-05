import React from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, Controller } from 'react-hook-form';
import { z } from 'zod';
import { toast } from 'sonner';
import { Search } from 'lucide-react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { LoadError, Loading, PageHeader } from '../components/layout';
import {
  getKeywords,
  importKeywordCatalog,
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
  name_zh: z.string().refine((value) => value.trim().length > 0, '分类名称必填'),
  name_en: z.string(),
  description_zh: z.string().refine((value) => value.trim().length > 0, '分类备注必填'),
  description_en: z.string(),
  source_refs: z.string(),
});

const ruleSchema = z
  .object({
    pack_id: z.string().min(1, '选择分类'),
    phrase: z.string().refine((value) => {
      const phrase = value.trim();
      return phrase.length > 0 && phrase.length <= 80;
    }, '词组需要 1-80 字'),
    terms: z.string(),
    max_gap: z.string(),
  })
  .refine((values) => {
    const terms = splitTerms(values.terms);
    if (!terms.length) return true;
    const maxGap = Number(values.max_gap.trim());
    return terms.length >= 2 && terms.length <= 5 && Number.isInteger(maxGap) && maxGap >= 0 && maxGap <= 32;
  }, '分词需要 2-5 个；最大间隔为 0-32 的整数');

type PackFormValues = z.infer<typeof packSchema>;
type RuleFormValues = z.infer<typeof ruleSchema>;

const blankPack = (): PackFormValues => ({ name_zh: '', name_en: '', description_zh: '', description_en: '', source_refs: '' });
const blankRule = (): RuleFormValues => ({ pack_id: '', phrase: '', terms: '', max_gap: '' });

function packToForm(pack: KeywordPack): PackFormValues {
  return {
    name_zh: pack.name_zh,
    name_en: pack.name_en,
    description_zh: pack.description_zh,
    description_en: pack.description_en,
    source_refs: pack.source_refs.join(', '),
  };
}

function ruleToForm(rule: KeywordRule): RuleFormValues {
  return {
    pack_id: rule.pack_id,
    phrase: rule.phrase,
    terms: rule.terms?.join(', ') ?? '',
    max_gap: rule.max_gap === null ? '' : String(rule.max_gap),
  };
}

function fieldError(message: string | undefined) {
  return message ? <p className="text-xs font-medium text-destructive">{message}</p> : null;
}

type DialogShellProps = {
  open: boolean;
  title: string;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: () => void;
  children: React.ReactNode;
};

function DialogShell({ open, title, pending, onOpenChange, onSubmit, children }: DialogShellProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={onSubmit} noValidate>
          {children}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={pending}>
              保存
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PackEditorDialog({
  pack,
  open,
  pending,
  onOpenChange,
  onSubmit,
}: {
  pack: KeywordPack | null;
  open: boolean;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: PackFormValues) => void;
}) {
  const form = useForm<PackFormValues, unknown, PackFormValues>({
    resolver: zodResolver(packSchema),
    defaultValues: pack ? packToForm(pack) : blankPack(),
  });
  const errors = form.formState.errors;
  return (
    <DialogShell
      open={open}
      title={pack ? '编辑分类' : '新增分类'}
      pending={pending}
      onOpenChange={onOpenChange}
      onSubmit={form.handleSubmit(onSubmit)}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="pack-name-zh">分类名称</Label>
          <Input id="pack-name-zh" {...form.register('name_zh')} />
          {fieldError(errors.name_zh?.message)}
        </div>
        <div className="grid gap-2">
          <Label htmlFor="pack-name-en">英文名称</Label>
          <Input id="pack-name-en" {...form.register('name_en')} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="pack-desc-zh">分类备注</Label>
          <Input id="pack-desc-zh" {...form.register('description_zh')} />
          {fieldError(errors.description_zh?.message)}
        </div>
        <div className="grid gap-2">
          <Label htmlFor="pack-desc-en">英文备注</Label>
          <Input id="pack-desc-en" {...form.register('description_en')} />
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="pack-refs">来源</Label>
        <Input id="pack-refs" placeholder="逗号分隔" {...form.register('source_refs')} />
      </div>
    </DialogShell>
  );
}

function RuleEditorDialog({
  rule,
  packs,
  open,
  pending,
  onOpenChange,
  onSubmit,
}: {
  rule: KeywordRule | null;
  packs: readonly KeywordPack[];
  open: boolean;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: RuleFormValues) => void;
}) {
  const form = useForm<RuleFormValues, unknown, RuleFormValues>({
    resolver: zodResolver(ruleSchema),
    defaultValues: rule
      ? ruleToForm(rule)
      : { ...blankRule(), pack_id: packs[0]?.id ?? '' },
  });
  const errors = form.formState.errors;
  return (
    <DialogShell
      open={open}
      title={rule ? '编辑规则' : '新增规则'}
      pending={pending}
      onOpenChange={onOpenChange}
      onSubmit={form.handleSubmit(onSubmit)}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="rule-pack">分类</Label>
          <Controller
            name="pack_id"
            control={form.control}
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="rule-pack" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {packs.map((pack) => (
                    <SelectItem key={pack.id} value={pack.id}>
                      {pack.name_zh}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          {fieldError(errors.pack_id?.message)}
        </div>
        <div className="grid gap-2">
          <Label htmlFor="rule-phrase">词组</Label>
          <Input id="rule-phrase" {...form.register('phrase')} />
          {fieldError(errors.phrase?.message)}
        </div>
        <div className="grid gap-2">
          <Label htmlFor="rule-terms">分词</Label>
          <Input id="rule-terms" placeholder="逗号分隔，2-5 个" {...form.register('terms')} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="rule-max-gap">最大间隔</Label>
          <Input id="rule-max-gap" inputMode="numeric" {...form.register('max_gap')} />
        </div>
      </div>
      {errors.root?.message ? <p className="text-xs font-medium text-destructive">{errors.root.message}</p> : null}
    </DialogShell>
  );
}

type Removal = { kind: 'pack' | 'rule'; id: string; label: string } | null;

/** 单包内先渲染的规则条数，超出部分手动展开。 */
const RULE_PREVIEW = 50;

export function KeywordsPage() {
  const queryClient = useQueryClient();
  const keywords = useQuery({ queryKey: ['keywords'], queryFn: getKeywords });
  const [filter, setFilter] = React.useState('');
  const [openIds, setOpenIds] = React.useState<string[]>([]);
  const [showAll, setShowAll] = React.useState<Record<string, boolean>>({});
  const [packEditor, setPackEditor] = React.useState<{ open: boolean; pack: KeywordPack | null }>({
    open: false,
    pack: null,
  });
  const [ruleEditor, setRuleEditor] = React.useState<{ open: boolean; rule: KeywordRule | null }>({
    open: false,
    rule: null,
  });
  const [removing, setRemoving] = React.useState<Removal>(null);

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['keywords'] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
    ]);
  };

  const savePackMutation = useMutation({
    mutationFn: (values: PackFormValues) =>
      savePack({
        id: packEditor.pack?.id,
        name_zh: values.name_zh.trim(),
        name_en: values.name_en.trim() || values.name_zh.trim(),
        description_zh: values.description_zh.trim(),
        description_en: values.description_en.trim() || values.description_zh.trim(),
        source_refs: splitTerms(values.source_refs),
      }),
    onSuccess: async () => {
      await invalidate();
      toast.success('已生效');
      setPackEditor({ open: false, pack: null });
    },
    onError: (error) => toast.error(errorText(error)),
  });

  const saveRuleMutation = useMutation({
    mutationFn: (values: RuleFormValues) => {
      const terms = splitTerms(values.terms);
      return saveRule({
        id: ruleEditor.rule?.id,
        pack_id: values.pack_id,
        phrase: values.phrase.trim(),
        terms,
        max_gap: terms.length ? Number(values.max_gap.trim()) : undefined,
      });
    },
    onSuccess: async () => {
      await invalidate();
      toast.success('已生效');
      setRuleEditor({ open: false, rule: null });
    },
    onError: (error) => toast.error(errorText(error)),
  });

  const removeMutation = useMutation({
    mutationFn: async (target: NonNullable<Removal>) =>
      target.kind === 'pack' ? removePack(target.id) : removeRule(target.id),
    onSuccess: async () => {
      await invalidate();
      toast.success('已移除');
      setRemoving(null);
    },
    onError: (error) => toast.error(errorText(error)),
  });

  const importMutation = useMutation({
    mutationFn: importKeywordCatalog,
    onSuccess: async (result) => {
      await invalidate();
      toast.success(result.imported ? `已导入 ${result.packs} 分类 ${result.rules} 规则` : '无可导入内容');
    },
    onError: (error) => toast.error(errorText(error)),
  });

  const packs = keywords.data?.packs ?? [];
  const activePacks = packs.filter((pack) => pack.active);
  const activeRules = (keywords.data?.rules ?? []).filter((rule) => rule.active);
  const needle = filter.trim().toLowerCase();

  const rulesFor = (packId: string) => activeRules.filter((rule) => rule.pack_id === packId);
  const visiblePacks = needle
    ? activePacks.filter(
        (pack) =>
          pack.name_zh.toLowerCase().includes(needle) ||
          rulesFor(pack.id).some((rule) => rule.phrase.toLowerCase().includes(needle)),
      )
    : activePacks;
  // 搜索时全部展开命中分类；清空搜索回到手动展开状态。
  const accordionValue = needle ? visiblePacks.map((pack) => pack.id) : openIds;
  const showImport = keywords.data !== undefined && activePacks.length === 0 && !needle;

  return (
    <section>
      <PageHeader title="关键词词库">
        <Button
          variant="outline"
          onClick={() => setPackEditor({ open: true, pack: null })}
        >
          新增分类
        </Button>
        <Button
          variant="outline"
          disabled={activePacks.length === 0}
          onClick={() => setRuleEditor({ open: true, rule: null })}
        >
          新增规则
        </Button>
      </PageHeader>
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="搜分类或词组"
            className="pl-8"
          />
        </div>
        {showImport ? (
          <Button variant="outline" disabled={importMutation.isPending} onClick={() => importMutation.mutate()}>
            导入公开词库
          </Button>
        ) : null}
      </div>
      {keywords.isPending ? (
        <Loading />
      ) : keywords.isError ? (
        <LoadError error={keywords.error} onRetry={() => void keywords.refetch()} />
      ) : visiblePacks.length === 0 ? (
        <div className="mt-6 grid h-44 place-items-center rounded-lg border border-dashed text-sm text-muted-foreground">
          {needle ? '无匹配' : '词库为空'}
        </div>
      ) : (
        <Accordion type="multiple" className="mt-4" value={accordionValue} onValueChange={setOpenIds}>
          {visiblePacks.map((pack) => {
            const packRules = needle
              ? rulesFor(pack.id).filter((rule) => rule.phrase.toLowerCase().includes(needle))
              : rulesFor(pack.id);
            const expanded = needle || showAll[pack.id] || false;
            const shownRules = expanded ? packRules : packRules.slice(0, RULE_PREVIEW);
            return (
              <AccordionItem key={pack.id} value={pack.id}>
                <div className="flex items-center">
                  <AccordionTrigger className="min-w-0 flex-1 hover:no-underline">
                    <span className="truncate">{pack.name_zh}</span>
                    <Badge variant="secondary" className="ml-2 shrink-0">
                      {packRules.length}
                    </Badge>
                  </AccordionTrigger>
                  <div className="flex shrink-0 gap-1 pl-2">
                    <Button variant="ghost" size="sm" onClick={() => setPackEditor({ open: true, pack })}>
                      编辑
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      disabled={removeMutation.isPending}
                      onClick={() => setRemoving({ kind: 'pack', id: pack.id, label: pack.name_zh })}
                    >
                      移除
                    </Button>
                  </div>
                </div>
                <AccordionContent>
                  {packRules.length === 0 ? (
                    <p className="py-2 text-sm text-muted-foreground">无规则</p>
                  ) : (
                    <>
                      <div className="overflow-hidden rounded-lg border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>词组</TableHead>
                              <TableHead>分词</TableHead>
                              <TableHead>间隔</TableHead>
                              <TableHead className="w-32 text-right">操作</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {shownRules.map((rule) => (
                              <TableRow key={rule.id}>
                                <TableCell className="font-medium">{rule.phrase}</TableCell>
                                <TableCell className="text-muted-foreground">
                                  {rule.terms?.join(' · ') ?? '—'}
                                </TableCell>
                                <TableCell className="text-muted-foreground">
                                  {rule.max_gap ?? '—'}
                                </TableCell>
                                <TableCell className="text-right">
                                  <div className="inline-flex justify-end gap-1">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => setRuleEditor({ open: true, rule })}
                                    >
                                      编辑
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="text-destructive hover:text-destructive"
                                      disabled={removeMutation.isPending}
                                      onClick={() => setRemoving({ kind: 'rule', id: rule.id, label: rule.phrase })}
                                    >
                                      移除
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                      {packRules.length > shownRules.length ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="mt-2 w-full text-muted-foreground"
                          onClick={() => setShowAll((prev) => ({ ...prev, [pack.id]: true }))}
                        >
                          显示全部 {packRules.length} 条
                        </Button>
                      ) : null}
                    </>
                  )}
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}
      <PackEditorDialog
        key={packEditor.pack?.id ?? 'pack-new'}
        pack={packEditor.pack}
        open={packEditor.open}
        pending={savePackMutation.isPending}
        onOpenChange={(open) => setPackEditor((prev) => ({ ...prev, open }))}
        onSubmit={(values) => savePackMutation.mutate(values)}
      />
      <RuleEditorDialog
        key={ruleEditor.rule?.id ?? 'rule-new'}
        rule={ruleEditor.rule}
        packs={activePacks}
        open={ruleEditor.open}
        pending={saveRuleMutation.isPending}
        onOpenChange={(open) => setRuleEditor((prev) => ({ ...prev, open }))}
        onSubmit={(values) => saveRuleMutation.mutate(values)}
      />
      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {removing?.kind === 'pack' ? `移除分类「${removing.label}」？` : `移除规则「${removing?.label}」？`}
            </AlertDialogTitle>
            <AlertDialogDescription>移除立即生效，公开词库同步更新。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: 'destructive' })}
              disabled={removeMutation.isPending}
              onClick={() => removing && removeMutation.mutate(removing)}
            >
              移除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
