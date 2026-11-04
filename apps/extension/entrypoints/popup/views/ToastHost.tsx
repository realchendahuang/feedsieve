import { useEffect, useState } from 'react';
import {
  dismissToast,
  getToast,
  subscribeToast,
  TOAST_MS,
  TOAST_WITH_ACTION_MS,
  type ToastEntry,
} from '../../../src/lib/platform/toast';

/**
 * 全局吐司宿主：订阅 toast 通道，永远只渲染一条。
 * 提示本身不挡点击（pointer-events: none），只有「撤销」这类按钮可点。
 */
export default function ToastHost() {
  const [toast, setToast] = useState<ToastEntry | null>(getToast);

  useEffect(() => subscribeToast(setToast), []);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(
      () => dismissToast(),
      toast.duration ?? (toast.actions?.length ? TOAST_WITH_ACTION_MS : TOAST_MS),
    );
    return () => window.clearTimeout(timeout);
  }, [toast]);

  if (!toast) return null;

  return (
    <p className="toast-notice" role="status">
      <span>{toast.text}</span>
      {toast.actions?.map((action) => (
        <button
          key={action.label}
          type="button"
          onClick={() => {
            dismissToast();
            action.run();
          }}
        >
          {action.label}
        </button>
      ))}
    </p>
  );
}
