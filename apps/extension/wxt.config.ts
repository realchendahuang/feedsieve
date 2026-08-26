import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'FeedSieve',
    short_name: 'FeedSieve',
    description: 'X 赛博清洁工：黄框标注垃圾账号，一键批量真拉黑。标注永不隐藏内容。',
    permissions: ['storage'],
    host_permissions: ['https://x.com/*'],
    icons: {
      64: '/icon.png',
    },
  },
});
