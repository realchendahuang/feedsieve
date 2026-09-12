import { copyFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'wxt';

// 大数据 JSON 不进 JS chunk：buildStart 时拷入 public/，随扩展以静态资源
// 发布，运行时 browser.runtime.getURL + fetch 读取。此前静态 import 让
// background / content / popup 三个入口各抄一份，产物膨胀到 4 MB，
// CWS 上传 zip 也跟着翻倍。
function officialJsonPlugin() {
  return {
    name: 'feedsieve-copy-official-json',
    buildStart() {
      const root = resolve(import.meta.dirname, '../..');
      const listsDst = resolve(import.meta.dirname, 'public/community/lists');
      mkdirSync(listsDst, { recursive: true });
      copyFileSync(resolve(root, 'community/lists/official.json'), resolve(listsDst, 'official.json'));
      const packsDst = resolve(import.meta.dirname, 'public/community/keyword-packs');
      mkdirSync(packsDst, { recursive: true });
      copyFileSync(
        resolve(root, 'community/keyword-packs/official.json'),
        resolve(packsDst, 'official.json'),
      );
      copyFileSync(
        resolve(import.meta.dirname, 'src/lib/detection/variant-tables.json'),
        resolve(packsDst, 'variant-tables.json'),
      );
    },
  };
}

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: (env) => ({
    name: 'FeedSieve',
    short_name: 'FeedSieve',
    description: 'X 赛博清洁工：黄框标注垃圾账号，一键批量真拉黑。标注永不隐藏内容。',
    permissions: ['storage', 'sidePanel'],
    side_panel: {
      default_path: 'popup.html',
    },
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
