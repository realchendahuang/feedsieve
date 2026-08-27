// Worker 运行时绑定。测试环境会额外注入 TEST_MIGRATIONS（见 vitest.config.ts），
// 仅 test/apply-migrations.ts 使用。
declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    ADMIN_TOKEN: string;
    INSTALLATION_SALT: string;
    TEST_MIGRATIONS: import('cloudflare:test').D1Migration[];
  }
}
