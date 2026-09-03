// Worker 运行时绑定。测试环境会额外注入 TEST_MIGRATIONS（见 vitest.config.ts），
// 仅 test/apply-migrations.ts 使用。
declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    /** 公开、版本化的关键词词库生成物；源文件仍提交在 community/keyword-packs/。 */
    KEYWORD_PACKS?: R2Bucket;
    ASSETS: Fetcher;
    ACCESS_AUD?: string;
    ACCESS_JWKS_URL?: string;
    ACCESS_ALLOWED_EMAILS?: string;
    /** 仅这个 hostname 可访问 React 维护端；公开 API host 永远不回退到静态后台。 */
    ADMIN_HOST?: string;
    INSTALLATION_SALT: string;
    TEST_MIGRATIONS: import('cloudflare:test').D1Migration[];
  }
}
