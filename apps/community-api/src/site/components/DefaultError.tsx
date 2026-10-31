import { useEffect } from 'react';
import { Link, type ErrorComponentProps } from '@tanstack/react-router';

/** 全站默认错误页：loader / 渲染抛错时的中文兜底（替代 TanStack 英文原始页）。 */
export function DefaultError({ error }: ErrorComponentProps) {
  useEffect(() => {
    document.title = '出错了 · 福滤娃 FeedSieve';
  }, []);
  const message = error instanceof Error ? error.message : String(error);

  return (
    <div className="mx-auto max-w-4xl px-[clamp(18px,2.2vw,34px)] py-12 sm:py-16">
      <h1 className="text-3xl font-bold">页面出错了</h1>
      <p className="mt-3 text-mist">数据加载时出了点问题，通常是短暂故障，稍后重试即可恢复。</p>
      <p className="mt-4 rounded-xl bg-soft-surface px-4 py-3 text-xs break-all text-mist">{message}</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <button
          onClick={() => window.location.reload()}
          className="inline-flex h-9 items-center rounded-full bg-gold px-4 text-sm font-semibold text-paper transition-opacity hover:opacity-90"
        >
          刷新重试
        </button>
        <Link
          to="/"
          className="inline-flex h-9 items-center rounded-full bg-soft-surface px-4 text-sm font-semibold text-mist transition-colors hover:bg-wash-strong hover:text-ink"
        >
          返回首页
        </Link>
      </div>
    </div>
  );
}
