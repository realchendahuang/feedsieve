import { useEffect, useState, type ReactNode } from 'react';
import { UI_COPY, type UiLanguage } from '../../../../src/lib/platform/i18n';
import { AppIcon, HelpIcon } from '../shared';

/** 设置页统一的一行：左标签（可带 ! 说明）+ 右控件。 */
export function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="row">
      <div className="row-label">
        <span>{label}</span>
        {hint ? <HelpIcon text={hint} /> : null}
      </div>
      <div className="row-control">{children}</div>
    </div>
  );
}

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
  const [armed, setArmed] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    void browser.runtime
      .sendMessage({ type: 'feedsieve:profile-count' })
      .then((value: unknown) => setCount(typeof value === 'number' ? value : null))
      .catch(() => setCount(null));
  }, []);
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), 3_000);
    return () => window.clearTimeout(timer);
  }, [armed]);
  async function clear(): Promise<void> {
    if (!armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
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
      className={`text-button${armed ? ' is-danger' : ''}`}
      disabled={count === 0}
      onClick={() => void clear()}
    >
      {armed
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
