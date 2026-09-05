import React from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, Controller } from 'react-hook-form';
import { z } from 'zod';
import { toast } from 'sonner';
import { Search } from 'lucide-react';
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
import { Textarea } from '@/components/ui/textarea';
import { LoadError, Loading, PageHeader } from '../components/layout';
import { getAccounts, removeAccount, saveAccount, type AccountEntry } from '../lib/api';
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

type AccountFormValues = z.infer<typeof accountSchema>;

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

function fieldError(message: string | undefined) {
  return message ? <p className="text-xs font-medium text-destructive">{message}</p> : null;
}

function AccountEditorDialog({
  entry,
  categories,
  open,
  pending,
  onOpenChange,
  onSubmit,
}: {
  entry: AccountEntry | null;
  categories: readonly string[];
  open: boolean;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: AccountFormValues) => void;
}) {
  const form = useForm<AccountFormValues, unknown, AccountFormValues>({
    resolver: zodResolver(accountSchema),
    defaultValues: entry ? toFormValues(entry) : blankAccount(),
  });
  const errors = form.formState.errors;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{entry ? '编辑账号' : '新增账号'}</DialogTitle>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="account-handle">账号</Label>
              <Input id="account-handle" placeholder="@账号" {...form.register('handle')} />
              {fieldError(errors.handle?.message)}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="account-category">分类</Label>
              <Controller
                name="category"
                control={form.control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="account-category" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((category) => (
                        <SelectItem key={category} value={category}>
                          {category}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {fieldError(errors.category?.message)}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="account-user-id">用户 ID</Label>
              <Input id="account-user-id" {...form.register('x_user_id')} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="account-evidence">证据贴文 ID</Label>
              <Input id="account-evidence" {...form.register('evidence_post_id')} />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="account-note">备注</Label>
            <Textarea id="account-note" {...form.register('note')} />
            {fieldError(errors.note?.message)}
          </div>
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

export function AccountsPage() {
  const queryClient = useQueryClient();
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: getAccounts });
  const [filter, setFilter] = React.useState('');
  const [editor, setEditor] = React.useState<{ open: boolean; entry: AccountEntry | null }>({
    open: false,
    entry: null,
  });
  const [removing, setRemoving] = React.useState<AccountEntry | null>(null);

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['accounts'] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
    ]);
  };

  const saveMutation = useMutation({
    mutationFn: (values: AccountFormValues) =>
      saveAccount({
        handle: values.handle.trim().replace(/^@+/, '').toLowerCase(),
        category: values.category,
        x_user_id: values.x_user_id.trim() || null,
        evidence_post_id: values.evidence_post_id.trim() || null,
        note: values.note.trim(),
      }),
    onSuccess: async () => {
      await invalidate();
      toast.success(editor.entry ? '已生效' : '已添加');
      setEditor({ open: false, entry: null });
    },
    onError: (error) => toast.error(errorText(error)),
  });

  const removeMutation = useMutation({
    mutationFn: (handle: string) => removeAccount(handle),
    onSuccess: async () => {
      await invalidate();
      toast.success('已移除');
      setRemoving(null);
    },
    onError: (error) => toast.error(errorText(error)),
  });

  const categories = accounts.data?.categories ?? ['scam_phishing'];
  const needle = filter.trim().toLowerCase();
  const entries = (accounts.data?.entries ?? []).filter(
    (entry) =>
      entry.active &&
      (!needle || entry.handle.includes(needle) || entry.note.toLowerCase().includes(needle)),
  );

  return (
    <section>
      <PageHeader title="账号黑名单">
        <Button onClick={() => setEditor({ open: true, entry: null })}>新增</Button>
      </PageHeader>
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="搜账号或备注"
            className="pl-8"
          />
        </div>
      </div>
      {accounts.isPending ? (
        <Loading />
      ) : accounts.isError ? (
        <LoadError error={accounts.error} onRetry={() => void accounts.refetch()} />
      ) : entries.length === 0 ? (
        <div className="mt-6 grid h-44 place-items-center rounded-lg border border-dashed text-sm text-muted-foreground">
          {needle ? '无匹配' : '名单为空'}
        </div>
      ) : (
        <div className="mt-4 overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>账号</TableHead>
                <TableHead>分类</TableHead>
                <TableHead className="max-w-md">备注</TableHead>
                <TableHead className="w-32 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.handle}>
                  <TableCell className="font-medium">@{entry.handle}</TableCell>
                  <TableCell className="text-muted-foreground">{entry.category}</TableCell>
                  <TableCell className="max-w-md truncate text-muted-foreground">
                    {entry.note}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditor({ open: true, entry })}
                      >
                        编辑
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setRemoving(entry)}
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
      )}
      <AccountEditorDialog
        key={editor.entry?.handle ?? 'new'}
        entry={editor.entry}
        categories={categories}
        open={editor.open}
        pending={saveMutation.isPending}
        onOpenChange={(open) => setEditor((prev) => ({ ...prev, open }))}
        onSubmit={(values) => saveMutation.mutate(values)}
      />
      <ConfirmRemoval
        removal={removing}
        pending={removeMutation.isPending}
        onRemove={(handle) => removeMutation.mutate(handle)}
        onClose={() => setRemoving(null)}
      />
    </section>
  );
}

function ConfirmRemoval({
  removal,
  pending,
  onRemove,
  onClose,
}: {
  removal: AccountEntry | null;
  pending: boolean;
  onRemove: (handle: string) => void;
  onClose: () => void;
}) {
  return (
    <AlertDialog open={removal !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>移除 @{removal?.handle ?? ''}？</AlertDialogTitle>
          <AlertDialogDescription>移除立即生效，公开名单同步更新。</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            className={buttonVariants({ variant: 'destructive' })}
            disabled={pending}
            onClick={() => removal && onRemove(removal.handle)}
          >
            移除
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
