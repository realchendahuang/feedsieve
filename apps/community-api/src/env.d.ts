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
    /** Access 团队域（形如 xxx.cloudflareaccess.com）；设置后校验 JWT issuer 归属 */
    ACCESS_TEAM_DOMAIN?: string;
    /** 仅这个 hostname 可访问 React 维护端；公开 API host 永远不回退到静态后台。 */
    ADMIN_HOST?: string;
    /** 官网公开页（/ /lists /styles.css /assets）仅服务这个 hostname；缺省 = 该域名 404。 */
    SITE_HOST?: string;
    INSTALLATION_SALT: string;
    /** 快照与词库发布者私钥（PKCS8 DER base64，见 scripts/keygen.mjs）；缺省 = 不签名 */
    SIGNING_PRIVATE_KEY?: string;
    /** 签名使用的 key_id（对应扩展内置 trusted-keys.ts 的公钥） */
    SIGNING_KEY_ID?: string;
    /** "1" = 公开快照端点只服务已签名行；缺省 = 兼容旧部署（不设门槛） */
    REQUIRE_SIGNED_SNAPSHOTS?: string;
    /** "1" = 词库后台发布/回滚必须带发布者签名，密钥缺失时拒绝发布；缺省 = 兼容本地/CI（不设门槛） */
    REQUIRE_SIGNED_KEYWORD_PACKS?: string;
    /** 设置后随签名快照下发「破坏性动作暂停」开关（值为公开理由）；清除即恢复 */
    DESTRUCTIVE_KILL_SWITCH?: string;
    /** Agent 维护通道密钥（`id:secret` 逗号分隔，secret ≥16 位）；缺省 = 该通道不可用 */
    AGENT_API_KEYS?: string;
    /** 部署环境标记；置 "production" 后 bind-email 未配置邮件通道时绝不返回 dev_code */
    WORKER_ENV?: string;
    /** 出站邮件 webhook（POST {to, subject, text}）；缺省 = bind-email 降级返回 dev_code（仅限开发） */
    MAIL_WEBHOOK_URL?: string;
    /** Email Service 发件地址（如 no-reply@chendahuang.com）；EMAIL 绑定发信必配 */
    MAIL_FROM?: string;
    /** SMTP 直连发信（优先于 webhook）：SMTP_USER + SMTP_PASS 即可，host/port 按账号域自动推断 */
    SMTP_HOST?: string;
    SMTP_PORT?: string;
    SMTP_USER?: string;
    SMTP_PASS?: string;
    SMTP_FROM?: string;
    TEST_MIGRATIONS: import('cloudflare:test').D1Migration[];
  }
}
