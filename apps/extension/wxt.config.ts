import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: (env) => ({
    name: 'FeedSieve',
    short_name: 'FeedSieve',
    description: 'X 赛博清洁工：黄框标注垃圾账号，一键批量真拉黑。标注永不隐藏内容。',
    permissions: ['storage'],
    host_permissions: [
      'https://x.com/*',
      // dev 模式放行本地社区 API（wrangler dev）；生产构建不包含 localhost。
      ...(env.mode === 'development' ? ['http://localhost/*'] : []),
      // 社区名单下载 + 用户黑白名单同步（Cloudflare Worker，自部署见 apps/community-api）
      'https://feedsieve-api.chendahuang.com/*',
    ],
    icons: {
      16: '/icon-16.png',
      32: '/icon-32.png',
      48: '/icon-48.png',
      64: '/icon.png',
      128: '/icon-128.png',
    },
  }),
  vite: () => ({
    define: {
      // dev/本地测试 API 覆盖：FEEDSIEVE_API_BASE=http://localhost:8787 pnpm dev
      // 未设置时为空字符串，src/lib/api-base.ts 回退官方线上实例。
      __FEEDSIEVE_API_BASE__: JSON.stringify(process.env.FEEDSIEVE_API_BASE ?? ''),
    },
  }),
  zip: {
    name: 'feedsieve',
  },
});
