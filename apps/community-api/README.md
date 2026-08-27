# @feedsieve/community-api

FeedSieve 社区名单后端：Cloudflare Worker + Hono + D1。收上报、攒名单、发名单。

官方实例：`https://feedsieve-api.chendahuang.com`（由项目维护者运营）。
**代码完全开源，任何人都可以部署自己的实例。**

## 公私分明

本目录的公开/私有边界是刻意的工程结构，不是靠自觉：

| 内容 | 位置 | 是否入库 |
| --- | --- | --- |
| 全部源码 / schema / 测试 | `src/` `migrations/` `test/` | ✅ 提交 |
| 公开 Worker 配置（占位 database_id） | `wrangler.jsonc` | ✅ 提交 |
| 私有配置模板 | `wrangler.local.example.jsonc` | ✅ 提交 |
| 真实 account_id / database_id / 域名路由 | `wrangler.local.jsonc` | ❌ gitignored |
| 线上密钥 | `wrangler secret put` | ❌ 只存在 Cloudflare |
| 本地开发密钥 | `.dev.vars` | ❌ gitignored（提交 `.dev.vars.example`） |

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
cp wrangler.local.example.jsonc wrangler.local.jsonc
#   编辑 wrangler.local.jsonc：填 account_id、database_id、你的域名
wrangler d1 migrations apply feedsieve-community --remote --config wrangler.local.jsonc
echo "your-admin-token" | wrangler secret put ADMIN_TOKEN --config wrangler.local.jsonc
echo "your-salt"        | wrangler secret put INSTALLATION_SALT --config wrangler.local.jsonc
pnpm deploy                                   # = wrangler deploy --config wrangler.local.jsonc
curl https://你的域名/healthz
```

注意：中国大陆访问 `*.workers.dev` 不可靠，务必绑定自定义域。

## 端点（随 v0.2 各阶段上线）

| 端点 | 阶段 | 说明 |
| --- | --- | --- |
| `GET /healthz` | ✅ Phase A | 存活检查 |
| `POST /v1/reports` | Phase B | 显式上报（匿名安装哈希、去重、限速） |
| `GET /v1/snapshots/latest` + `/v1/snapshots/:version/:file` | Phase C | 版本化快照 + manifest + sha256 |
| `POST /admin/*` | Phase D | 人工审核（ADMIN_TOKEN 保护） |

审核闸门：自动化只能把账号标到 `candidate`；`recommended` / `strong` 必须人工提升。
