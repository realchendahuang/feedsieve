import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/*/src/**/*.test.ts',
      'apps/*/src/**/*.test.ts',
      'apps/*/entrypoints/**/*.test.ts',
      'apps/*/entrypoints/**/*.test.tsx',
      'scripts/**/*.test.ts',
    ],
    // community-api 用 @cloudflare/vitest-plugin（workerd 运行时）跑自己的配置
    // （见其 vitest.config.ts），由自己的配置文件负责，根 vitest 全量排除
    exclude: ['**/node_modules/**', '**/dist/**', 'apps/community-api/**'],
  },
});
