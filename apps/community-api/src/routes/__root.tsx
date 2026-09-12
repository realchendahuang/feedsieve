import { Outlet, createRootRoute, HeadContent, Scripts } from '@tanstack/react-router';
import { SiteFooter } from '@/site/components/SiteFooter';
import { TopLoadingBar } from '@/site/components/TopLoadingBar';
import { NotFound } from '@/site/components/NotFound';
import { Toaster } from '@/site/components/ui/toast';
import { ThemeProvider } from '@/site/components/ThemeProvider';
import { THEME_BOOT_SCRIPT } from '@/site/lib/theme';
import { SITE_NAME, SITE_URL } from '@/site/site';
import '@/site/styles.css';

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      // 初始给浅色值；深色用户的真实值由 THEME_BOOT_SCRIPT 首帧前改写
      { name: 'theme-color', content: '#f5f6f7' },
      // 全站共享的站点级 meta（各页只写页面级 title/og，避免重复标签）
      { property: 'og:site_name', content: SITE_NAME },
    ],
    links: [
      { rel: 'icon', href: '/assets/avatar.png', type: 'image/png' },
    ],
    scripts: [
      // 站点级 JSON-LD：告诉搜索引擎这是什么站点
      {
        type: 'application/ld+json',
        children: JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'WebSite',
          name: SITE_NAME,
          url: SITE_URL,
          inLanguage: 'zh-CN',
        }),
      },
    ],
  }),
  component: RootComponent,
  // 全局未匹配路径的 404 兜底：与站点一致的视觉，子路由的 notFoundComponent 优先
  notFoundComponent: GlobalNotFound,
});

function RootComponent() {
  return (
    <html lang="zh-CN">
      <head>
        <HeadContent />
        {/* 主题启动脚本：阻塞在 head、首帧前按存储/系统偏好落 .dark，深色用户不闪白屏 */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="flex min-h-dvh flex-col bg-paper text-foreground antialiased">
        <ThemeProvider>
          <TopLoadingBar />
          <Toaster />
          {/* flex-1：内容不足一屏时页脚也贴底 */}
          <div className="flex-1">
            <Outlet />
          </div>
          <SiteFooter />
          <Scripts />
        </ThemeProvider>
      </body>
    </html>
  );
}

function GlobalNotFound() {
  return <NotFound title="页面不存在" description="你要找的页面不在这里，去首页或名单公示看看。" />;
}
