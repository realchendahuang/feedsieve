import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'FeedSieve',
    short_name: 'FeedSieve',
    description: 'X 赛博清洁工：黄框标注垃圾账号，一键批量真拉黑。标注永不隐藏内容。',
    permissions: ['storage'],
    host_permissions: [
      'https://x.com/*',
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
  },
  zip: {
    name: 'feedsieve',
  },
});
