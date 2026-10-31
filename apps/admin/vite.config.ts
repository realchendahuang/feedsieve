import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  build: { outDir: 'dist', sourcemap: 'hidden' },
  server: {
    // 本地管理端开发：pnpm dev 把 /api 转发到社区 API 的 wrangler dev。
    // 配套：在 apps/community-api/.dev.vars 设 ADMIN_HOST=localhost 放行 host 门禁，
    // 再 pnpm --filter @feedsieve/community-api dev。生产构建不受影响。
    proxy: { '/api': 'http://localhost:8787' },
  },
});
