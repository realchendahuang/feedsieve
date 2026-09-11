# Skill: feedsieve-admin — FeedSieve 全量线上数据管理（Agent 通道）

项目级 skill。维护 FeedSieve 线上全部可管理数据：**维护者名单 / 词库（关键词分类与规则）/ 发布与回滚 / 审计 / 资产清单 / 运行状态**。API 地址由部署者提供，通过环境变量 `FEEDSIEVE_API`（或本地文件 `~/.config/feedsieve/api-base`）指定；本 skill 不硬编码任何真实域名。

## 鉴权

所有 `/api/agent/*` 请求带请求头 `X-Agent-Key`。Key 由部署者生成（`id:secret`，secret ≥16 位）并 `wrangler secret put AGENT_API_KEYS --config wrangler.local.jsonc`（`id:secret` 逗号分隔）配置到 Worker。

本机读取顺序：环境变量 `FEEDSIEVE_AGENT_KEY` → 文件 `~/.config/feedsieve/agent.key`（推荐，0600）。
**Key 绝不写入仓库、Skill 文档、提交或对话。**

## 端点总览（全部需 `X-Agent-Key`）

| 方法 | 路径 | 用途 |
| ---- | ---- | ---- |
| GET | `/api/agent/entries` | 维护者名单（含已撤销） |
| PUT | `/api/agent/entries/:handle` | 新增/更新维护者条目（body: handle/category/note，路径=body.handle） |
| DELETE | `/api/agent/entries/:handle` | 撤销维护者条目（幂等） |
| GET | `/api/agent/keywords` | 词库分类与规则（含停用） |
| PUT | `/api/agent/keywords/packs/:id` | 新增/更新词库分类（body: id/name_zh/name_en?/description_zh/description_en?/source_refs?） |
| DELETE | `/api/agent/keywords/packs/:id` | 停用词库分类 |
| PUT | `/api/agent/keywords/rules/:id` | 新增/更新词库规则（body: id/pack_id/phrase/terms?/max_gap?） |
| DELETE | `/api/agent/keywords/rules/:id` | 停用词库规则 |
| POST | `/api/agent/keywords/publish` | 发布词库（签名 + R2 产物 + 版本号） |
| POST | `/api/agent/keywords/import` | 首次导入词库（空库时幂等生效） |
| POST | `/api/agent/accounts/publish` | 发布维护者快照（名单草稿 + 白名单即时生效，绕开当日一版） |
| GET | `/api/agent/releases` | 发布记录 |
| POST | `/api/agent/releases/:id/rollback` | 按记录类型回滚（accounts 用 id，keywords 用版本内容重新发布） |
| GET | `/api/agent/audit?limit=N` | 审计流水（默认 50，≤500） |
| GET | `/api/agent/status` | 汇总状态（快照版本/条目、kill-switch、社区指标、词库版本） |
| GET | `/api/agent/assets?prefix=` | R2 资产清单（词库产物 + 发布归档，≤1000） |

## 操作流（先看后改，改后验证）

1. **巡检**：`m.sh status` 一次拿快照/词库/开关状态；有异常再 `m.sh assets`、`m.sh audit` 定位。
2. **改名单**：`m.sh find <handle>` 查重 → `m.sh put <handle> <category> <note> [evidence_post_id]` / `m.sh remove <handle>`（拿到举报链接时把 `status/<id>` 的数字作为 evidence 传入，公开快照会带上实锤）。
3. **改词库**：`m.sh klist` → `m.sh kpack <id> <name> <desc>` / `m.sh krule <id> <pack_id> <phrase>` → **`m.sh kpub` 发布**（改词库必须显式发布才生效）。
4. **发布快照**：名单/白名单改动后 `m.sh wpub`（或跑 `scripts/publish-community-whitelist.sh` 自动收尾）即时发布，不用去后台点。
4. **验证**：`m.sh status`（新版本号）或拉取公开产物 `/v1/snapshots/latest`、`/v1/keyword-packs/latest`。
5. **留档**：名单/词库发布后跑 `scripts/mirror-community-lists.sh` 并提交（GitHub 每日自动镜像兜底）。

## 治理红线（违反破坏社区信任，禁止）

- **只能动维护者来源条目与词库**；绝不伪造/修改社区票、安装数据、计票字段。
- 名单条目必须带公开 `note`（为什么进名单）。
- 词库发布前先确认改动范围（`klist` 对一下再 `kpub`）；回滚 `rollback` 是"以新版本号重发历史内容"，不是删除版本。
- 所有写操作都带审计（actor=`agent:<id>`），与人工后台同表；不要绕过 API 直接改 D1。

## 故障排查

- `401 invalid_agent_key`：key 不匹配或 `AGENT_API_KEYS` 未配置（`wrangler secret list` 核对）。
- `handle_mismatch`：路径与 body 的 id/handle 不一致。
- 词库 `signing_key_missing`：`REQUIRE_SIGNED_KEYWORD_PACKS=1` 时 Worker 缺发布私钥，禁止发布（正确行为）。
- `no_active_packs`：没有任何 active 分类时不能发布空词库。