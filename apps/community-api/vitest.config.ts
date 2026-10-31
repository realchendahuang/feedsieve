import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig, defineProject } from 'vitest/config';
import { testDatabaseUrl } from './test/database-url';

export default defineConfig(() => {
  return defineProject({
    plugins: [
      cloudflareTest({
        // 测试入口是纯 Hono 的 api-entry（wrangler.test.jsonc 交换了 main）
        wrangler: { configPath: './wrangler.test.jsonc' },
        miniflare: {
          // 本地 PostgreSQL（docker-compose.yml）的测试库；global-setup 负责建库和跑迁移
          hyperdrives: { HYPERDRIVE: testDatabaseUrl() },
          // Access 中间件用占位配置驱动（JWKS 由测试的 fetchMock 拦截提供假密钥）。
          bindings: {
            FEEDSIEVE_TEST: '1',
            ADMIN_HOST: 'admin.feedsieve-api.chendahuang.com',
            SITE_HOST: 'feedsieve.test',
            ACCESS_AUD: 'feedsieve-test-aud',
            ACCESS_JWKS_URL: 'https://jwks.test/.well-known/jwks.json',
            ACCESS_ALLOWED_EMAILS: 'maintainer@example.com',
            INSTALLATION_SALT: 'override-salt-0123456789',
            // 覆盖 .dev.vars 里的真实密钥：测试绝不能打到付费的第三方（用例里按需注入假 key + stub fetch）
            TIKHUB_API_KEY: '',
            TYPESAFE_API_KEY: '',
          },
        },
      }),
    ],
    test: {
      globalSetup: ['./test/global-setup.ts'],
      setupFiles: ['./test/reset-database.ts'],
      // 所有测试文件共用一个数据库，每个测试前清表，所以文件之间不能并行
      fileParallelism: false,
      // postgres.js 的 Workers 套接字在连接关闭后还会读一次，抛出无害的 Stream was cancelled；只忽略这一种
      onUnhandledError: (error) => (error?.message === 'Stream was cancelled.' ? false : undefined),
    },
  });
});
