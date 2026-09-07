# Skill: feedsieve-maintainer — FeedSieve 社区名单维护（Agent 通道）

> 注意：全量管理能力已升级为项目级 skill（仓库 `.agents/skills/feedsieve-admin/`）。
> 本 skill 是名单维护的快速入口，完整端点/操作流/红线以项目级为准。

用于维护 FeedSieve 公开名单的 **维护者来源** 条目，以及查看线上快照状态。
API 地址不硬编码：优先环境变量 `FEEDSIEVE_API`，其次文件 `~/.config/feedsieve/api-base`（0600，本地调试可覆盖为本地实例）。

## 鉴权

请求头 `X-Agent-Key`。Key 由项目部署者生成（`id:secret`，secret ≥16 位），
通过 `wrangler secret put AGENT_API_KEYS --config wrangler.local.jsonc` 配置到 Worker。

本机读取优先级：
1. 环境变量 `FEEDSIEVE_AGENT_KEY`
2. 文件 `~/.config/feedsieve/agent.key`（推荐，权限 0600）

**绝不把 Key 写进仓库、Skill 文档、聊天内容或任何提交。**

## 端点（全部需要 `X-Agent-Key`）

| 方法 | 路径                              | 用途                                   |
| ---- | --------------------------------- | -------------------------------------- |
| GET  | `/api/agent/entries`              | 维护者条目列表（含已撤销条目与状态）   |
| PUT  | `/api/agent/entries/:handle`      | 新增/更新一条（body: handle/category/note/evidence_post_id，路径与 body.handle 必须一致） |
| DELETE| `/api/agent/entries/:handle`      | 撤销一条（幂等）                       |

每次写操作都会立即发布新快照（不受「当日一版」日更节流），并把审计写入 `admin_audit_log`（actor=`agent:<id>`），与人工后台操作同表可查。公开快照端点不变：`GET /v1/snapshots/latest`、`GET /v1/snapshots/:version/official.json`。

## 用户举报 → 快速标记（最高频场景，全流程）

用户发来垃圾账号（截图 / 链接 / 文案）要求标记时，按固定流程走，目标是最快把 handle 送进名单：

1. **提取 handle**：
   - 链接：`https://x.com/<handle>/status/<post_id>` 或 `x.com/<handle>` → handle 取中间段（去 `@`、转小写）。
   - 截图/文案：从账号名、链接或推文信息里找 handle（通常带 `@` 或紧跟「· 关注率」）。
   - **同时提取证据**：`status/<post_id>` 的数字 ID（最多 25 位）作为 `evidence_post_id` 一并传入——公开快照会带上这条实锤链接，比只有 note 更有说服力。
2. **查重**：`m.sh find <handle>` —— 一次看清「公开名单是否已有 / 维护者草稿是否已有」。
   - 已在公开名单：告诉用户「已在名单里」，不需要重复标记；若来源只有 community 想补维护者背书，仍可 put。
   - 维护者草稿已有：核对 note 是否已说明原因，避免重复写。
3. **分类**（下拉决策表，拿不准用 `other` 并在 note 里描述特征）：
   | 看到的内容 | category |
   | --- | --- |
   | 黄推/色情引流（emoji 灌水话术、关注率异常、头像/简介涉黄） | `adult_gray_traffic` |
   | 机器刷屏/重复无意义文案、随机字母数字 ID 复制粘贴 | `copy_paste` |
   | 批量关注/粉丝、系统化机器人行为 | `bot_spam` |
   | 明显 AI 生成内容（谈天说地但空洞） | `ai_slop` |
   | 打广告卖货/导流到商店 | `advertising` |
   | 钓鱼/诈骗（假客服、中奖、钱包地址） | `scam_phishing` |
   | 求转发/求关注/互动诱饵 | `engagement_bait` |
   | 拿不准，或不在以上任何一类 | `other` |
4. **写入**：`m.sh put <handle> <category> <note> [evidence_post_id]`。
   - note ≥4 字符，**必须能说明为什么进名单**（例：`用户举报黄推引流：emoji灌水话术+关注率异常`；如果是模板化文案，把话术特征写进 note，方便日后合并同类项）。
5. **验证**：`m.sh find <handle>` 或拉 `official.json`，确认 handle 已进名单、category/note 正确、快照版本已 +1。
6. **留档**：跑仓库 `scripts/mirror-community-lists.sh` 并提交 `community/lists/`（GitHub 每日镜像兜底，主动维护后手动补一档更好）。

用户连续发多个账号时，重复 1-5，全部处理完统一留档（一次 mirror + 一次提交）。

## 标准操作流（先看后改）

1. **先 GET 现状**：`m.sh list`，核对 handle、active 状态再动手。
2. **改/加条目**：`m.sh put <handle> <category> <note> [evidence_post_id]`。
3. **撤销条目**：`m.sh remove <handle>`（撤销前先 `m.sh find <handle>` 确认社区票是否仍达标——达标则会留在名单里降级为 community 来源，这是政策）。
4. **验证快照**：`m.sh find <handle>` 或拉 `official.json`，确认目标条目已进/已出名单，版本号已更新。
5. **留档**：同上方第 6 步。

## 治理红线（违反会破坏社区信任，禁止）

- **只能维护「维护者来源」条目**。绝不通过任何方式伪造/修改社区票（reports）、安装数据、计票字段。
- 维护者条目必须带公开 `note` 说明（为什么进名单）。
- 撤销条目时有社区票仍达标的账号会留在名单（降级为 community 来源），这是政策，不是失败。
- 客户端拉黑不从这里触发——本通道只维护名单数据，不做任何破坏性/外发动作。

## 故障排查

- `401 invalid_agent_key`：Key 不匹配或 `AGENT_API_KEYS` 未配置（部署侧 `wrangler secret list` 核对）。
- `handle_mismatch`：路径 handle 与 body.handle 不一致。
- `invalid_category` / `invalid_note`：category 不在 8 类合法分类内，或 note 长度 <4 / >240。
- `500 internal_error` 且 wrangler tail 见 `Too many API requests by single Worker invocation`：快照发布路径撞 D1 请求上限，已修复（2026-09-07）；若再出现，检查是否又有全表逐行查询（见项目记忆 `d1-invocation-request-limit`）。
- 快照没变化：内容比对（含票数）完全相同会复用版本，属正常。