import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { SITE_NAME, GITHUB_URL, CHROME_STORE_URL, FIREFOX_STORE_URL } from '../site';

/**
 * 全站统一页脚：现代开发者 3 列布局（品牌定位 / 名单与词库 / 文档与开源）
 */
export function SiteFooter() {
  return (
    <footer className="border-t border-line/60 bg-paper transition-colors">
      <div className="mx-auto max-w-5xl px-[clamp(18px,2.2vw,34px)] py-12">
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-12">
          {/* 左侧：品牌与定位 */}
          <div className="lg:col-span-6 space-y-3">
            <div className="flex items-center gap-2.5">
              <img
                src="/assets/avatar.png"
                alt=""
                width={32}
                height={32}
                className="size-8 rounded-full"
              />
              <span className="text-base font-bold tracking-tight text-ink">{SITE_NAME}</span>
            </div>
            <p className="text-sm font-medium text-ink leading-relaxed">
              用了福滤娃，评论区不骚了，好帖也不漏了。
            </p>
            <p className="max-w-md text-xs text-mist leading-relaxed">
              开源的中文
              X（Twitter）刷推副驾驶：黄推一眼标出、一键原生拉黑；帖子流速、热帖榜、博主主页爆款分析。只读页面已经加载的数据，登录凭证不出浏览器。
            </p>
            <div className="pt-1 flex items-center gap-3 text-xs text-fog">
              <span>MIT License</span>
              <span>·</span>
              <span>开源透明</span>
              <span>·</span>
              <span>Ed25519 验签</span>
            </div>
          </div>

          {/* 中间：名单与数据 */}
          <div className="lg:col-span-3 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-fog">名单与词库</h3>
            <ul className="space-y-2 text-sm text-mist font-medium">
              <li>
                <FooterLink to="/lists/blacklist">黑名单全量公示</FooterLink>
              </li>
              <li>
                <FooterLink to="/lists/whitelist">推荐白名单</FooterLink>
              </li>
              <li>
                <FooterLink to="/lists/rescue">社区抢救名单</FooterLink>
              </li>
              <li>
                <FooterLink to="/lists/keywords">开源分类词库</FooterLink>
              </li>
              <li>
                <FooterLink to="/lists/apply">申请入册 / 申诉</FooterLink>
              </li>
            </ul>
          </div>

          {/* 右侧：文档与社区 */}
          <div className="lg:col-span-3 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-fog">文档与社区</h3>
            <ul className="space-y-2 text-sm text-mist font-medium">
              <li>
                <a
                  href={CHROME_STORE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="transition-colors hover:text-ink inline-flex items-center gap-1"
                >
                  Chrome 应用商店
                </a>
              </li>
              <li>
                <a
                  href={FIREFOX_STORE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="transition-colors hover:text-ink inline-flex items-center gap-1"
                >
                  Firefox 附加组件
                </a>
              </li>
              <li>
                <FooterLink to="/guide">使用教程与指引</FooterLink>
              </li>
              <li>
                <a
                  href={GITHUB_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="transition-colors hover:text-ink"
                >
                  GitHub 开源仓库
                </a>
              </li>
              <li>
                <a
                  href={`${GITHUB_URL}/blob/main/CHANGELOG.md`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="transition-colors hover:text-ink"
                >
                  更新日志
                </a>
              </li>
              <li>
                <a
                  href={`${GITHUB_URL}/blob/main/PRIVACY.md`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="transition-colors hover:text-ink"
                >
                  隐私政策
                </a>
              </li>
              <li>
                <a
                  href={`${GITHUB_URL}/blob/main/DISCLAIMER.md`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="transition-colors hover:text-ink"
                >
                  免责声明
                </a>
              </li>
              <li>
                <a
                  href={`${GITHUB_URL}/issues`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="transition-colors hover:text-ink"
                >
                  反馈误标与 Issue
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* 底栏版权与作者 */}
        <div className="mt-12 pt-6 border-t border-line/50 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-mist">
          <div>
            © 2026 {SITE_NAME} · 由{' '}
            <a
              href="https://x.com/realchendahuang"
              target="_blank"
              rel="noopener noreferrer"
              className="text-ink font-semibold hover:underline underline-offset-4"
            >
              @realchendahuang
            </a>{' '}
            为更干净的中文推特时间线开发
          </div>
          <div className="flex items-center gap-2 text-fog">
            <span>免 API Key</span>
            <span>·</span>
            <span>免推特开发者账号</span>
            <span>·</span>
            <span>本地沙箱</span>
          </div>
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
