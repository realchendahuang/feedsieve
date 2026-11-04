import { useEffect, useState } from 'react';
import type { UiLanguage } from '../../../../src/lib/platform/i18n';
import {
  getBackups,
  removeBackup,
  subscribeBackups,
  type ArticleBackup,
} from '../../../../src/lib/compose/schedule-store';
import { EmptyState, formatAgo, HelpIcon, IconButton, useArmedConfirm } from '../shared';

const COPY = {
  zh: {
    backups: '文章备份',
    backupsHint:
      '在 X 文章编辑器里写作时，标题和正文会转成 Markdown 存在本机，每篇留 5 个版本（10 分钟内的修改合并成一版）。X 编辑器出问题或误删时，从这里复制回去。',
    empty: '还没有备份',
    untitled: '（无标题）',
    copy: '复制 Markdown',
    open: '在 X 打开',
    delete: '删除备份',
    deleteConfirm: '再点一次删除',
    deleted: '已删除备份',
    version: '版本',
    copied: '已复制',
  },
  en: {
    backups: 'Article backups',
    backupsHint:
      'While you write in the X article editor, the title and body are saved here as Markdown, 5 versions per article (edits within 10 minutes count as one). Copy them back if the X editor loses your work.',
    empty: 'No backups yet',
    untitled: '(untitled)',
    copy: 'Copy Markdown',
    open: 'Open on X',
    delete: 'Delete backup',
    deleteConfirm: 'Click again to delete',
    deleted: 'Backup deleted',
    version: 'Version',
    copied: 'Copied',
  },
} as const;

export default function ArticleBackups({
  language,
  notify,
}: {
  language: UiLanguage;
  notify: (message: string | null) => void;
}) {
  const c = COPY[language];
  const [backups, setBackups] = useState<ArticleBackup[]>([]);
  const [versionPick, setVersionPick] = useState<Record<string, number>>({});
  // 备份是本机唯一一份，删了不可恢复：按行「再点一次确认」，和水军、禁语一个规矩
  const armedDelete = useArmedConfirm<string>();

  useEffect(() => {
    void getBackups().then(setBackups);
    return subscribeBackups(setBackups);
  }, []);

  function copyText(text: string): void {
    void navigator.clipboard.writeText(text).then(
      () => notify(c.copied),
      () => undefined,
    );
  }

  async function openArticle(id: string): Promise<void> {
    const url = `https://x.com/compose/articles/edit/${id}`;
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id && /^https:\/\/(www\.)?x\.com\//.test(tab.url ?? ''))
      await browser.tabs.update(tab.id, { url });
    else await browser.tabs.create({ url });
  }

  return (
    <section className="group" aria-label={c.backups}>
      <div className="group-head">
        <h3 className="group-title">{c.backups}</h3>
        <HelpIcon text={c.backupsHint} />
      </div>
      {backups.length === 0 ? (
        <EmptyState className="is-clean">{c.empty}</EmptyState>
      ) : (
        backups.map((backup) => {
          const pick = Math.min(versionPick[backup.id] ?? 0, backup.versions.length - 1);
          const version = backup.versions[pick]!;
          const latest = backup.versions[0]!;
          const markdown = version.title.trim()
            ? `# ${version.title.trim()}\n\n${version.markdown}`
            : version.markdown;
          return (
            <div className="row write-backup" key={backup.id}>
              <span className="row-label">
                <span>{latest.title.trim() || c.untitled}</span>
              </span>
              {backup.versions.length > 1 ? (
                <select
                  className="sort-select"
                  value={pick}
                  aria-label={c.version}
                  onChange={(event) =>
                    setVersionPick((current) => ({
                      ...current,
                      [backup.id]: Number(event.target.value),
                    }))
                  }
                >
                  {backup.versions.map((item, index) => (
                    <option key={item.savedAt} value={index}>
                      {formatAgo(item.savedAt, language)}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="row-meta">{formatAgo(latest.savedAt, language)}</span>
              )}
              <span className="row-control">
                <IconButton icon="copy" label={c.copy} onClick={() => copyText(markdown)} />
                <IconButton
                  icon="external"
                  label={c.open}
                  onClick={() => void openArticle(backup.id)}
                />
                <IconButton
                  icon="x"
                  label={armedDelete.isArmed(backup.id) ? c.deleteConfirm : c.delete}
                  onClick={() => {
                    if (!armedDelete.arm(backup.id)) return;
                    armedDelete.reset();
                    void removeBackup(backup.id).then((next) => {
                      setBackups(next);
                      notify(c.deleted);
                    });
                  }}
                />
              </span>
            </div>
          );
        })
      )}
    </section>
  );
}
