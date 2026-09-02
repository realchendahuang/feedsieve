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
echo "your-admin-token" | wrangler secret put ADMIN_TOKEN --config wrangler.local.jsonc
echo "your-salt"        | wrangler secret put INSTALLATION_SALT --config wrangler.local.jsonc
pnpm deploy                                   # = wrangler deploy --config wrangler.local.jsonc
pnpm keyword-packs:publish                    # 发布仓库中已审阅的词库版本到 R2
curl https://你的域名/healthz
```

注意：中国大陆访问 `*.workers.dev` 不可靠，务必绑定自定义域。

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
| `GET /maintainer`                      | ✅   | 维护者黑名单管理页面（页面公开，操作需 token） |
| `POST /admin/publish`                  | ✅   | 生成并发布新快照版本                           |
| `GET /admin/blocklist`                 | ✅   | 维护者条目（含已撤销）                         |
| `POST /admin/blocklist`                | ✅   | 加入或更新维护者条目并立即发布                 |
| `DELETE /admin/blocklist/:handle`      | ✅   | 撤销维护者来源并立即发布                       |
| `GET /admin/community-votes`           | ✅   | 社区聚合票数诊断视图（只读）                   |
| `GET /admin/false-positives`           | ✅   | 误标规则汇总 + 最近反馈（不返回安装标识）      |

社区只有一个公式：`report_count - rescue_count >= 3` 时进入最终名单，低于 3 时退出。
维护者条目存放在独立的 `maintainer_blocklist` 表，不参与社区计票。最终快照取两者并集，
并通过 `sources` 公开标注 `community` / `maintainer`；不存在隐藏 owner 权重或永久否决。

计票以 `active_labels` 为准：一个匿名安装对一个账号只能保留一个当前判断，
后一次“拉黑 / 白名单”会覆盖前一次，避免同一用户同时贡献正负票。`reports` 与
`rescues` 仍保留规则和内容证据，供误标审计使用；名单删除只撤票，不抹审计记录。

## 维护者页面与 CLI

打开 `https://你的域名/maintainer`，输入部署时设置的 `ADMIN_TOKEN`。令牌只保存在当前
标签页的 `sessionStorage`；仓库、扩展和页面源码都不包含它。加入、更新、撤销操作会写入
`maintainer_blocklist_audit`，并在请求完成前生成新快照。

```sh
apps/community-api/scripts/admin.sh community-votes     # 社区票数诊断
apps/community-api/scripts/admin.sh blocklist           # 维护者条目
apps/community-api/scripts/admin.sh false-positives     # 误标审计
apps/community-api/scripts/admin.sh publish             # 发布新快照
```

令牌读 `FEEDSIEVE_ADMIN_TOKEN` 或 `~/.feedsieve-secrets.txt`；`FEEDSIEVE_API` 可指向自部署实例。

需要本地验证“三个不同安装投票后入榜”时，启动 `pnpm dev` 后把账号喂给
`apps/community-api/scripts/seed.sh`。该脚本只接受 `localhost` / `127.0.0.1`，线上维护请用
维护者页面，禁止用种子脚本制造虚假共识。

## 公开词库发布

词库唯一编辑入口是仓库根目录的 `community/keyword-packs/source.json`，生成物和 manifest 也必须提交，方便每个变更接受 Git diff / PR 审阅。发布不需要也不应该修改扩展代码：

```sh
pnpm keyword-packs:build
pnpm keyword-packs:check
pnpm keyword-packs:publish
```

Worker 仅从 R2 读取 `keyword-packs/latest.json` 和 `keyword-packs/<version>/official.json`；扩展按 manifest 校验 SHA-256 后缓存。远程产物缺失或校验失败时，扩展继续使用 last-known-good 版本。
