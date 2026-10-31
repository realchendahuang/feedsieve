import { useEffect, useState } from 'react';
import { cn } from './../../lib/utils';

type ToastType = 'success' | 'info';

interface ToastMessage {
  id: string;
  message: string;
  type?: ToastType;
}

const listeners = new Set<(toast: ToastMessage) => void>();

/** 瞬时成功提示：自动消失、不长时间遮挡界面（AGENTS.md 约定） */
export const toast = {
  success: (msg: string) => {
    listeners.forEach((fn) => fn({ id: Math.random().toString(), message: msg, type: 'success' }));
  },
  info: (msg: string) => {
    listeners.forEach((fn) => fn({ id: Math.random().toString(), message: msg, type: 'info' }));
  },
};

export function Toaster() {
  const [current, setCurrent] = useState<ToastMessage | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const handler = (t: ToastMessage) => {
      setCurrent(t);
      clearTimeout(timer);
      timer = setTimeout(() => setCurrent(null), 2800);
    };
    listeners.add(handler);
    return () => {
      listeners.delete(handler);
      clearTimeout(timer);
    };
  }, []);

  return (
    <div className="pointer-events-none fixed inset-x-0 top-5 z-[110] flex justify-center px-4">
      <div role="status" aria-live="polite">
        {current && (
          <div
            key={current.id}
            className={cn(
              'pointer-events-auto animate-[toast-in_220ms_cubic-bezier(0.22,1,0.36,1)] flex items-center gap-2.5 rounded-full border border-edge bg-surface/95 px-4 py-2 text-xs font-semibold text-ink shadow-[var(--panel-elev)] backdrop-blur-xl',
            )}
          >
            <span
              className={cn(
                'size-2 animate-pulse rounded-full',
                current.type === 'success' ? 'bg-gold shadow-[0_0_8px_var(--gold)]' : 'bg-fog',
              )}
            />
            <span>{current.message}</span>
          </div>
        )}
      </div>
    </div>
  );
}
