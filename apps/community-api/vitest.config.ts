import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig, defineProject } from 'vitest/config';

export default defineConfig(async () => {
  const migrations = await readD1Migrations('./migrations');

  return defineProject({
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          // 测试专用绑定：迁移内容注入为绑定，setup 文件里 applyD1Migrations 消费；
          // Access 中间件用占位配置驱动（JWKS 由测试的 fetchMock 拦截提供假密钥）。
          bindings: {
            TEST_MIGRATIONS: migrations,
            ADMIN_HOST: 'admin.feedsieve-api.chendahuang.com',
            ACCESS_AUD: 'feedsieve-test-aud',
            ACCESS_JWKS_URL: 'https://jwks.test/.well-known/jwks.json',
            ACCESS_ALLOWED_EMAILS: 'maintainer@example.com',
            INSTALLATION_SALT: 'override-salt-0123456789',
          },
        },
      }),
    ],
    test: {
      setupFiles: ['./test/apply-migrations.ts'],
    },
  });
});
