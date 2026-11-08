import { ArrowRight, ExternalLink } from 'lucide-react';
import { CHROME_STORE_URL, FIREFOX_STORE_URL } from '../site';

/**
 * 双商店安装入口。全站以前只给 Chrome 一个按钮，Firefox 用户得自己去 AMO 搜；
 * 这里把两个商店做成同尺寸并列的两颗按钮，主次只体现在配色上。
 *
 * 返回 Fragment 而不是自带宽度的容器：首页 hero、AI 报告页、指南底部各有各的
 * flex 布局（居中 / 左对齐 / 换行间距不同），由外层 div 统一控制。
 */
const SIZE = {
  sm: 'h-10 px-5 text-xs',
  md: 'h-11 px-6 text-sm',
  lg: 'h-12 px-8 text-sm',
} as const;

export function InstallButtons({
  chromeLabel = 'Chrome 商店一键安装',
  firefoxLabel = 'Firefox 商店一键安装',
  size = 'md',
}: {
  chromeLabel?: string;
  firefoxLabel?: string;
  size?: keyof typeof SIZE;
}) {
  const pill = SIZE[size];
  return (
    <>
      <a
        href={CHROME_STORE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={`inline-flex ${pill} items-center justify-center gap-2 rounded-full bg-primary font-bold text-primary-foreground shadow-lg shadow-black/5 transition-all hover:scale-[1.02] hover:opacity-95 active:scale-98`}
      >
        <span>{chromeLabel}</span>
        <ArrowRight className="size-4" />
      </a>
      <a
        href={FIREFOX_STORE_URL}
        target="_blank"
        rel="noopener noreferrer"
        title="Firefox 附加组件（AMO）官方条目 FeedSieve 福滤娃"
        className={`inline-flex ${pill} items-center justify-center gap-2 rounded-full border border-line/70 bg-surface font-semibold text-ink shadow-sm transition-all hover:scale-[1.02] hover:bg-wash-strong active:scale-98`}
      >
        <span>{firefoxLabel}</span>
        <ExternalLink className="size-3.5 text-mist" />
      </a>
    </>
  );
}

/** 行内小入口：一句说明后面并列 Chrome / Firefox，两处「装扩展自动折叠」共用 */
export function StoreLinks({ label }: { label: string }) {
  const link = 'font-semibold hover:text-ink hover:underline underline-offset-2';
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span>{label}：</span>
      <a href={CHROME_STORE_URL} target="_blank" rel="noopener noreferrer" className={link}>
        Chrome
      </a>
      <span aria-hidden className="opacity-60">
        /
      </span>
      <a href={FIREFOX_STORE_URL} target="_blank" rel="noopener noreferrer" className={link}>
        Firefox
      </a>
    </span>
  );
}
