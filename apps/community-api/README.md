# @feedsieve/community-api

FeedSieve 社区名单与公开关键词后端：Cloudflare Worker + Hono + D1 + R2。D1 收上报、攒名单；R2 分发版本化的公开关键词包。

官方实例：`https://feedsieve-api.chendahuang.com`（由项目维护者运营）。
**代码完全开源，任何人都可以部署自己的实例。**

## 公私分明

本目录的公开/私有边界是刻意的工程结构，不是靠自觉：

| 内容                                     | 位置                           | 是否入库                                  |
| ---------------------------------------- | ------------------------------ | ----------------------------------------- |
| 全部源码 / schema / 测试                 | `src/` `migrations/` `test/`   | ✅ 提交                                   |
| 公开 Worker 配置（占位 database_id）     | `wrangler.jsonc`               | ✅ 提交                                   |
| 私有配置模板                             | `wrangler.local.example.jsonc` | ✅ 提交                                   |
| 真实 account_id / database_id / 域名路由 | `wrangler.local.jsonc`         | ❌ gitignored                             |
| 线上密钥                                 | `wrangler secret put`          | ❌ 只存在 Cloudflare                      |
| 本地开发密钥                             | `.dev.vars`                    | ❌ gitignored（提交 `.dev.vars.example`） |

隐私红线（见 `docs/OPEN_SOURCE_GOVERNANCE.md` §5）：举报者侧数据只存服务器加盐哈希，IP / 原始安装 UUID 永不落库、永不公开。

## 本地开发

```sh
pnpm install
cp .dev.vars.example .dev.vars
pnpm dev        # wrangler dev，本地 workerd + 本地 D1
pnpm test       # vitest + @cloudflare/vitest-plugin，真 workerd + 真迁移
pnpm typecheck
```

## 部署你自己的实例

```sh
wrangler login
wrangler d1 create feedsieve-community        # 记下输出的 database_id
wrangler r2 bucket create feedsieve-keyword-packs
cp wrangler.local.example.jsonc wrangler.local.jsonc
#   编辑 wrangler.local.jsonc：填 account_id、database_id、你的域名
wrangler d1 migrations apply feedsieve-community --remote --config wrangler.local.jsonc
echo "your-salt" | wrangler secret put INSTALLATION_SALT --config wrangler.local.jsonc
pnpm --filter @feedsieve/admin build
pnpm deploy                                   # = wrangler deploy --config wrangler.local.jsonc
pnpm keyword-packs:publish                    # 发布仓库中已审阅的词库版本到 R2
curl https://你的域名/healthz
```

注意：中国大陆访问 `*.workers.dev` 不可靠，务必绑定自定义域。

## 维护后台

管理端位于 `apps/admin/`，使用 React、TanStack Router 和 TanStack Query 构建；生产静态资源由同一个 Worker 的 `ASSETS` 绑定提供。它不是令牌输入页、拼接 HTML 或手改 JSON 的替代品。

为自己的实例配置一个独立的管理子域（例如 `admin.example.com`），把它写入 `ADMIN_HOST`，并在 Cloudflare Zero Trust 中创建一个 **Self-hosted** Access 应用：

1. 目标设为该管理子域，并只关联维护者允许策略。
2. 在该应用的“其他设置”复制 **Application Audience (AUD) tag**。
3. 写入 Worker 密钥后重新部署：

```sh
echo "AUD_TAG" | wrangler secret put ACCESS_AUD --config wrangler.local.jsonc
echo "https://TEAM.cloudflareaccess.com/cdn-cgi/access/certs" | wrangler secret put ACCESS_JWKS_URL --config wrangler.local.jsonc
echo "owner@example.com" | wrangler secret put ACCESS_ALLOWED_EMAILS --config wrangler.local.jsonc
pnpm deploy
```

维护者通过 Cloudflare Access 邮箱一次性验证码进入后台；Worker 会同时校验 `Cf-Access-Jwt-Assertion` 的签名、Audience 和允许邮箱。后台提供账号草稿与显式发布、词库分类和规则管理、去标识化反馈、发布归档与回退。普通 API 域名不会提供这些端点。

## 端点

| 端点                                   | 状态 | 说明                                           |
| -------------------------------------- | ---- | ---------------------------------------------- |
| `GET /healthz`                         | ✅   | 存活检查                                       |
| `POST /v1/reports`                     | ✅   | 显式上报（匿名安装哈希、去重、限速，批量 ≤50） |
| `POST /v1/rescues`                     | ✅   | 显式误标/抢救反馈（可带检测来源、规则与理由）  |
| `POST /v1/labels/retract`              | ✅   | 本地名单删除后撤回当前票（原始审计证据保留）   |
| `GET /v1/snapshots/latest`             | ✅   | manifest（版本 + sha256 + 条目数，短缓存）     |
| `GET /v1/snapshots/:version/:file`     | ✅   | 快照文件（immutable 缓存）                     |
| `GET /v1/blocklist/latest.yaml`        | ✅   | 当前最终黑名单（人类可读 YAML）                |
| `GET /v1/blocklist/latest.json`        | ✅   | 当前最终黑名单（机器 JSON）                    |
| `GET /v1/keyword-packs/latest`         | ✅   | R2 词库 manifest（版本 + SHA-256，短缓存）     |
| `GET /v1/keyword-packs/:version/:file` | ✅   | R2 版本化词库文件（immutable 缓存）            |
| `GET /api/admin/dashboard`             | ✅   | 后台概览（仅管理域 + Cloudflare Access）       |
| `GET/POST/DELETE /api/admin/accounts`  | ✅   | 账号管理，保存/移除即自动发布（仅管理域 + Access） |
| `POST /api/admin/accounts/publish`     | ✅   | 手动发布（一般无需调用，保存已自动发布）       |
| `GET/POST/DELETE /api/admin/keywords/*`| ✅   | 词库分类、规则、回退与显式导入（变更即自动发布） |
| `GET /api/admin/feedback`              | ✅   | 去标识化的误标反馈                             |
| `GET/POST /api/admin/releases/*`       | ✅   | 发布记录与回退                                 |

社区只有一个公式：`report_count - rescue_count >= 3` 时进入最终名单，低于 3 时退出。
维护者条目存放在独立的 `maintainer_blocklist` 表，不参与社区计票。最终快照取两者并集，
并通过 `sources` 公开标注 `community` / `maintainer`；不存在隐藏 owner 权重或永久否决。

计票以 `active_labels` 为准：一个匿名安装对一个账号只能保留一个当前判断，
后一次“拉黑 / 白名单”会覆盖前一次，避免同一用户同时贡献正负票。`reports` 与
`rescues` 仍保留规则和内容证据，供误标审计使用；名单删除只撤票，不抹审计记录。

需要本地验证“三个不同安装投票后入榜”时，启动 `pnpm dev` 后把账号喂给
`apps/community-api/scripts/seed.sh`。该脚本只接受 `localhost` / `127.0.0.1`，线上维护请用
受 Cloudflare Access 保护的管理后台，禁止用种子脚本制造虚假共识。

## 公开词库发布

词库唯一编辑入口是仓库根目录的 `community/keyword-packs/source.json`，生成物和 manifest 也必须提交，方便每个变更接受 Git diff / PR 审阅。发布不需要也不应该修改扩展代码：

```sh
pnpm keyword-packs:build
pnpm keyword-packs:check
pnpm keyword-packs:publish
```

Worker 仅从 R2 读取 `keyword-packs/latest.json` 和 `keyword-packs/<version>/official.json`；扩展按 manifest 校验 SHA-256 后缓存。远程产物缺失或校验失败时，扩展继续使用 last-known-good 版本。
