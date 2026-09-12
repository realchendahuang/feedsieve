import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { SITE_NAME, GITHUB_URL } from '../site';

/**
 * 全站统一页脚：站点身份与站外入口的归口；只放链接，不放说明性文案。
 */
export function SiteFooter() {
  return (
    <footer className="border-t border-line/60 bg-paper">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-4 px-[clamp(18px,2.2vw,34px)] py-6 sm:py-8">
        <div className="min-w-0">
          <div className="text-sm font-bold">{SITE_NAME}</div>
          <div className="mt-0.5 text-xs text-mist">MIT · 开源</div>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm font-semibold text-mist">
          <FooterLink to="/">首页</FooterLink>
          <FooterLink to="/lists/blacklist">黑名单</FooterLink>
          <FooterLink to="/lists/whitelist">推荐白名单</FooterLink>
          <FooterLink to="/lists/rescue">抢救名单</FooterLink>
          <FooterLink to="/lists/keywords">词库</FooterLink>
          <a
            href={`${GITHUB_URL}/blob/main/DISCLAIMER.md`}
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-ink"
          >
            免责声明
          </a>
        </div>
      </div>
    </footer>
  );
}

function FooterLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="transition-colors hover:text-ink">
      {children}
    </Link>
  );
}
