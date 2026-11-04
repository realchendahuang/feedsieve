import { useEffect, useState } from 'react';
import { UI_COPY, type UiLanguage } from '../../../../src/lib/platform/i18n';
import { AppIcon, useArmedConfirm } from '../shared';

export { Row } from '../shared';

/** 可点进二级页的一行：标签 + 数量/状态 + 右侧箭头。 */
export function NavRow({
  label,
  meta,
  onOpen,
}: {
  label: string;
  meta?: string | number | null;
  onOpen: () => void;
}) {
  return (
    <button type="button" className="row nav-row" onClick={onOpen}>
      <span className="row-label">
        <span>{label}</span>
      </span>
      {meta === null || meta === undefined ? null : <span className="row-meta">{meta}</span>}
      <span className="chevron" aria-hidden="true">
        <AppIcon name="chevron" size={14} />
      </span>
    </button>
  );
}

/** 清空主页洞察的本地帖子库：点一下变成「确认」，3 秒内再点才清空。 */
export function ClearProfilesButton({
  language,
  notify,
}: {
  language: UiLanguage;
  notify: (message: string | null) => void;
}) {
  const t = UI_COPY[language];
  const { isArmed, arm, reset } = useArmedConfirm();
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    void browser.runtime
      .sendMessage({ type: 'feedsieve:profile-count' })
      .then((value: unknown) => setCount(typeof value === 'number' ? value : null))
      .catch(() => setCount(null));
  }, []);
  async function clear(): Promise<void> {
    if (!arm('clear')) return;
    reset();
    try {
      await browser.runtime.sendMessage({ type: 'feedsieve:profile-clear' });
      setCount(0);
      notify(t.profileCleared);
    } catch {
      notify(t.profileActionFailed);
    }
  }
  return (
    <button
      type="button"
      className={`text-button${isArmed('clear') ? ' is-danger' : ''}`}
      disabled={count === 0}
      onClick={() => void clear()}
    >
      {isArmed('clear')
        ? t.profileClearConfirm
        : count
          ? t.profileClearAction(count)
          : t.profileClearAction(0)}
    </button>
  );
}

/** 版本号：测试和预览环境里拿不到 manifest 时不显示。 */
export function extensionVersion(): string {
  try {
    const version = browser.runtime.getManifest?.().version;
    return version ? `v${version}` : '';
  } catch {
    return '';
  }
}
