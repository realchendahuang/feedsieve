import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifestVersion: 3,
  manifest: (env) => ({
    name: 'FeedSieve',
    short_name: 'FeedSieve',
    description: 'X 赛博清洁工：黄框标注垃圾账号，一键批量真拉黑。标注永不隐藏内容。',
    ...(env.browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko_android: { strict_min_version: '142.0' },
            gecko: {
              id: 'feedsieve@chendahuang.com',
              // Firefox 140 adds the built-in data transmission consent prompt.
              strict_min_version: '140.0',
              data_collection_permissions: {
                required: [
                  'websiteContent',
                  'websiteActivity',
                  'personallyIdentifyingInfo',
                  'authenticationInfo',
                ],
              },
            },
          },
        }
      : {}),
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
  vite: (env) => ({
    define: {
      // dev/本地测试 API 覆盖：只在 development 构建生效（FEEDSIEVE_API_BASE=http://localhost:8787 pnpm dev）。
      // 生产构建恒为空字符串回退官方线上实例——pack-store 的 manifest 审计查不到
      // 代码内嵌地址，任何环境变量泄漏进生产 zip 都会静默指向错误 API，故此处必须按 mode 隔离。
      __FEEDSIEVE_API_BASE__: JSON.stringify(
        env.mode === 'development' ? (process.env.FEEDSIEVE_API_BASE ?? '') : '',
      ),
    },
  }),
  zip: {
    name: 'feedsieve',
  },
});
