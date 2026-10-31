import { defineConfig } from 'wxt';
import { copyRuntimeData } from './scripts/copy-runtime-data.mjs';

// 大数据 JSON 不进 JS chunk：buildStart 时按 scripts/copy-runtime-data.mjs
// 的唯一清单拷入 public/，随扩展以静态资源发布，运行时
// 由后台读取并缓存到 storage。此前静态 import 让 background /
// content / popup 三个入口各抄一份，产物膨胀到 4 MB，CWS 上传 zip 也跟着翻倍。
function officialJsonPlugin() {
  return {
    name: 'feedsieve-copy-official-json',
    buildStart() {
      copyRuntimeData();
    },
  };
}

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  // Firefox 也用 MV3；WXT 会为 Firefox 输出 background.scripts，Chrome 仍是 service worker。
  manifestVersion: 3,
  manifest: (env) => {
    const firefox = env.browser === 'firefox';
    return {
      name: 'FeedSieve',
      short_name: 'FeedSieve',
      // 商店简短描述同这一句（≤132 字），改动时同步 docs/08-商店上架材料.md
      description:
        '评论区不骚了，好帖也不漏了。黄推标出一键原生拉黑；流速与量级、热帖榜、博主爆款分析、定时排期与文章 Markdown，中文 X 副驾驶。',
      // unlimitedStorage：主页洞察的本地帖子库（profile-catalog.ts）会超过 storage.local 默认的 10 MB。
      // Firefox 没有 sidePanel，用 sidebar_action 承载同一个 popup.html。
      permissions: ['storage', 'unlimitedStorage', ...(firefox ? [] : ['sidePanel'])],
      ...(firefox
        ? {
            sidebar_action: {
              default_panel: 'popup.html',
              default_title: 'FeedSieve',
              default_icon: { 16: '/icon-16.png', 32: '/icon-32.png', 48: '/icon-48.png' },
            },
            browser_specific_settings: {
              gecko: {
                // AMO 首次提交后不可改；改之前先确认没有已存在的条目。
                id: 'feedsieve@feedsieve.win',
                strict_min_version: '140.0',
                // Firefox 140 起的数据传输声明，和 PRIVACY.md 的条目对应。
                data_collection_permissions: {
                  required: [
                    'websiteContent',
                    'websiteActivity',
                    'personallyIdentifyingInfo',
                    'authenticationInfo',
                  ],
                },
              },
              gecko_android: { strict_min_version: '142.0' },
            },
          }
        : { side_panel: { default_path: 'popup.html' } }),
      host_permissions: [
        'https://x.com/*',
        // dev 模式放行本地社区 API（wrangler dev）；生产构建不包含 localhost。
        ...(env.mode === 'development' ? ['http://localhost/*'] : []),
        // 社区 API（api.feedsieve.win）不占主机权限：服务端对 /v1/* 开了 CORS，扩展按普通跨域请求访问。
        // 加主机权限会让 Chrome 在升级时停用扩展等用户重新同意，不要加回来。
      ],
      icons: {
        16: '/icon-16.png',
        32: '/icon-32.png',
        48: '/icon-48.png',
        64: '/icon.png',
        128: '/icon-128.png',
      },
    };
  },
  vite: (env) => ({
    plugins: [officialJsonPlugin()],
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
