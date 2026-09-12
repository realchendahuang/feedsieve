import { useEffect } from 'react';
import { Link } from '@tanstack/react-router';

/** 全站 404 兜底卡：与站点一致的视觉 + 返回链接。 */
export function NotFound({ title, description }: { title: string; description?: string }) {
  useEffect(() => {
    document.title = `${title} · 福滤娃 FeedSieve`;
  }, [title]);

  return (
    <main className="mx-auto max-w-4xl px-[clamp(18px,2.2vw,34px)] py-12 text-center sm:py-16">
      <h1 className="text-3xl font-bold">{title}</h1>
      {description && <p className="mt-3 text-mist">{description}</p>}
      <div className="mt-6 flex justify-center gap-3">
        <Link
          to="/"
          className="inline-flex h-9 items-center rounded-full bg-soft-surface px-4 text-sm font-semibold text-mist transition-colors hover:bg-wash-strong hover:text-ink"
        >
          返回首页
        </Link>
        <Link
          to="/lists/blacklist"
          className="inline-flex h-9 items-center rounded-full bg-soft-surface px-4 text-sm font-semibold text-mist transition-colors hover:bg-wash-strong hover:text-ink"
        >
          名单公示
        </Link>
      </div>
    </main>
  );
}
