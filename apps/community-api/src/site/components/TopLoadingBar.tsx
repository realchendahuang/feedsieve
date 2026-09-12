import { useEffect, useState } from 'react';
import { useRouterState } from '@tanstack/react-router';

/** 路由 pending 顶部加载条（纯 CSS 动画，少一个 motion 依赖） */
export function TopLoadingBar() {
  const isLoading = useRouterState({ select: (s) => s.status === 'pending' });
  // 只在路由 pending 持续超过 60ms 时置位，避免微小闪烁；
  // 重置走 effect cleanup（不直呼 setState，规范见 react-hooks/set-state-in-effect）
  const [delayed, setDelayed] = useState(false);

  useEffect(() => {
    if (!isLoading) return;
    const timer = setTimeout(() => setDelayed(true), 60);
    return () => {
      clearTimeout(timer);
      setDelayed(false);
    };
  }, [isLoading]);

  if (!delayed) return null;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-[2px] origin-left animate-[loadbar_0.9s_cubic-bezier(0.16,1,0.3,1)_infinite] bg-gradient-to-r from-gold-warm via-gold to-gold-deep"
    />
  );
}
