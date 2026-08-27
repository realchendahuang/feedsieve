import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/*/src/**/*.test.ts',
      'apps/*/src/**/*.test.ts',
      'apps/*/entrypoints/**/*.test.ts',
      'apps/*/entrypoints/**/*.test.tsx',
    ],
    // community-api 用 @cloudflare/vitest-plugin（workerd 运行时）跑自己的配置，
    // 不能被根 vitest 的 happy-dom 环境误收
    exclude: ['**/node_modules/**', '**/dist/**', 'apps/community-api/**'],
  },
});
