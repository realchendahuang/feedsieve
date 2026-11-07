// Worker 运行时绑定。
declare namespace Cloudflare {
  interface Env {
    /** PostgreSQL 经 Hyperdrive 接入；用 src/db/client.ts 的 getDb(env) 访问 */
    HYPERDRIVE: Hyperdrive;
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
    /** 部署环境标记；置 "production" 后发邮箱验证码时若未配置邮件通道，绝不返回 dev_code */
    WORKER_ENV?: string;
    /** 仅测试："1" 时允许在 withDb 作用域外调用 getDb（vitest.config.ts 注入） */
    FEEDSIEVE_TEST?: string;
    /** 全站热榜的独立加盐（≥16 位，线上用 wrangler secret put 设置）；缺省回落 INSTALLATION_SALT */
    HOT_SALT?: string;
    /** 全站热榜上榜所需的最少不同会话数（1–20）；不设时按最近 2 小时的活跃上报人数自动定（1 → 2 → 3） */
    HOT_MIN_REPORTERS?: string;
    /** 扩展上报全站热榜观测的间隔（分钟，5–60，默认 15）；随上报响应下发，调长即可降写入量 */
    HOT_UPLOAD_INTERVAL_MIN?: string;
    /** 出站邮件 webhook（POST {to, subject, text}）；缺省 = 发邮箱验证码时降级返回 dev_code（仅限开发） */
    MAIL_WEBHOOK_URL?: string;
    /** Email Service 发件地址（如 no-reply@chendahuang.com）；EMAIL 绑定发信必配 */
    MAIL_FROM?: string;
    /** SMTP 直连发信（优先于 webhook）：SMTP_USER + SMTP_PASS 即可，host/port 按账号域自动推断 */
    SMTP_HOST?: string;
    SMTP_PORT?: string;
    SMTP_USER?: string;
    SMTP_PASS?: string;
    SMTP_FROM?: string;
    /** TikHub API key（拉账号最近回复，AI 号判定用；线上 wrangler secret put）；缺省 = /v1/ai-accounts/check 返回 503 */
    TIKHUB_API_KEY?: string;
    /** TypeSafe 直连 key（旧判定通道，只有 AI_JUDGE_PROVIDERS 里写了 typesafe-direct 才用；默认不走） */
    TYPESAFE_API_KEY?: string;
    /** Cloudflare Workers AI / AI Gateway 绑定（AI 号判定模型网关的默认通道）；缺省 = workers-ai provider 不可用 */
    AI?: Ai;
    /** AI 号判定的模型 provider 顺序（逗号分隔）：workers-ai、workers-ai:<model id>、typesafe-direct；默认 workers-ai */
    AI_JUDGE_PROVIDERS?: string;
    /** workers-ai provider 的默认模型 id（默认 typesafe/jev-1.14.0；换模型不用改代码） */
    AI_JUDGE_MODEL?: string;
    /** AI Gateway id（第三方模型必须经网关；默认 default，首次认证请求自动创建） */
    AI_GATEWAY_ID?: string;
    /** 全站每天新判定 AI 号的「兜底闸」（默认 200000，纯防余额烧穿；单用户限额才是业务闸）；0 = 暂停新判定，只返缓存 */
    AI_CHECK_DAILY_BUDGET?: string;
    /** 福滤娃周刊 Worker（fsw-web）的 service binding：首页「本周 X 精选」读它的公开热帖；缺省 = 不显示该模块 */
    WEEKLY?: Fetcher;
  }
}
