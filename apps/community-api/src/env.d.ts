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
    /** 快照发布者私钥（PKCS8 DER base64，见 scripts/keygen.mjs）；缺省 = 不签名 */
    SIGNING_PRIVATE_KEY?: string;
    /** 签名使用的 key_id（对应扩展内置 trusted-keys.ts 的公钥） */
    SIGNING_KEY_ID?: string;
    /** "1" = 公开快照端点只服务已签名行；缺省 = 兼容旧部署（不设门槛） */
    REQUIRE_SIGNED_SNAPSHOTS?: string;
    TEST_MIGRATIONS: import('cloudflare:test').D1Migration[];
  }
}
