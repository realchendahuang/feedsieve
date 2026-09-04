import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ConfirmDialog } from '../components/confirm';
import { FlashMessage, useFlash } from '../components/flash';
import { Loading, PageHeader } from '../components/layout';
import { getReleases, rollbackRelease, type Release } from '../lib/api';
import { errorText } from '../lib/errors';

export function ReleasesPage() {
  const queryClient = useQueryClient();
  const releases = useQuery({ queryKey: ['releases'], queryFn: getReleases });
  const [flash, showFlash] = useFlash();
  const [busy, setBusy] = React.useState(false);
  const [pending, setPending] = React.useState<Release | null>(null);
  const rollback = async (release: Release) => {
    setBusy(true);
    try {
      const result = await rollbackRelease(release.id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['releases'] }),
        queryClient.invalidateQueries({ queryKey: ['accounts'] }),
        queryClient.invalidateQueries({ queryKey: ['keywords'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      ]);
      showFlash('success', `已回退 ${result.snapshot_version ?? result.version ?? ''}`);
    } catch (error) {
      showFlash('error', errorText(error));
    } finally {
      setBusy(false);
      setPending(null);
    }
  };
  return <section className="page">
    <PageHeader title="发布记录" />
    <FlashMessage flash={flash} />
    {!releases.data ? <Loading error={releases.error} /> : <div className="table-wrap"><table><thead><tr><th>类型</th><th>版本</th><th>维护者</th><th>时间</th><th /></tr></thead><tbody>{releases.data.map((release) => <tr key={release.id}><td>{release.kind === 'accounts' ? '名单' : '词库'}</td><td>{release.version}</td><td>{release.actor_email}</td><td>{new Date(release.created_at * 1000).toLocaleString('zh-CN')}</td><td className="row-actions"><button type="button" className="secondary" disabled={busy} onClick={() => setPending(release)}>回退</button></td></tr>)}</tbody></table></div>}
    <ConfirmDialog
      open={pending !== null}
      title={`回退到 ${pending?.version ?? ''}？`}
      body="名单草稿和公开快照会一起恢复到该版本，并生成一条新的发布记录。"
      confirmLabel="回退"
      busy={busy}
      onConfirm={() => pending && rollback(pending)}
      onCancel={() => setPending(null)}
    />
  </section>;
}
