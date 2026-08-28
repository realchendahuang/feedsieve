# Release Notes

## v0.2.0 — 社区名单闭环（2026-08-28）

v0.2 目标：**一个人拉黑，所有人的时间线自动黄框。**

### 能力清单

- **社区名单后端**（`apps/community-api`，Cloudflare Worker + D1，开源可自部署）：匿名上报、聚合、版本化快照（manifest + sha256）、人工审核闸门、管理 CLI。官方实例 `feedsieve-api.chendahuang.com`。
- **扩展消费端**：快照同步（manifest 版本比对、sha256 校验、last-known-good 离线缓存、jsDelivr 镜像兜底、6h 节流）；本地索引查询，滚动时间线零请求。
- **标注强度三档**：清爽（仅 strong）/ 标准（+recommended）/ 大扫除（+candidate），popup 即时切换。
- **零摩擦自动贡献**：拉黑成功即匿名上报（账号 + 分类），无逐条弹窗；全局开关默认开，关一次永远安静；失败进本地积压，下次启动补交。
- **个人白名单**：黄框上「误标？」一票否决，popup 可查看 / 移除。
- **已拉黑回显**：已拉黑账号仍出现在 feed 时打黄框（徽章「已拉黑 · X 仍展示」+ 移除按钮）。
- **popup**：多标签投递（遍历 x.com 标签找活会话，不再依赖 active tab）、手动同步、文案图标化。

### 安全边界

- 自动化最高到 candidate（默认强度不可见）；`recommended` / `strong` 必须人工提升，`dismissed` 立即退出名单。
- 上报只存安装 ID 的加盐 sha256；(installation, handle) 唯一去重 + 单安装日限速；绝无浏览数据。
- 标注自动，拉黑永远用户显式触发。

### 工程

- 新包 `@feedsieve/community-lists`（纯 TS 消费协议，12 测试）。
- 快照镜像回仓库（`scripts/mirror-community-lists.sh`）：git diff 即审计日志。
- 测试 108（根）+ 17（API，真 workerd + 真 D1 迁移）；`pnpm verify` 本地门禁。

### 已知状态

- 后端全链路已在线上验证（上报 → candidate → 人工提升 → 发布 → 校验和闭环）。
- 扩展端到端真机验证（种子名单入库后）统一进行中。

## v0.1.0 — 能真正拉黑（2026-08-27）

v0.1 目标：**没有后端、没有 AI，也能真正送走垃圾账号。**
成功标准：安装后 5 分钟内能把第一批垃圾账号真正拉黑，手机端同步清净，断网仍然能标注。

### 能力清单

- **黄框标注（带理由）**：内置名单 + 启发式（giveaway/空投模板、中文色诱话术、数字名账号、可疑链接域名），每条标注可解释来源与规则。
- **顺手拉黑**：时间线黄框徽章上单账号直拉黑，经 X 网页端原生产链路（`1.1/blocks/create.json`，页面登录会话），rest_id 缓存 miss 时按 handle 当场解析回填。
- **拉黑即消失**：拉黑确认成功后，该账号页面上可见的推文一并移除（对齐 X 原生拉黑行为）。
- **待拉黑列表**：popup 可看、可单项移除、可清空；勾选在时间线黄框里进行。
- **一键批量拉黑**：popup 一键执行整张待拉黑列表，逐条率控、失败保留并显示原因（限流/登录失效/网络错误等）。
- **一键撤销**：已拉黑记录可单项或全部撤销（`1.1/blocks/destroy.json`），误伤可恢复。
- **本地统计**：标注 / 拉黑 / 撤销计数器，全部本地累计，不上报。
- **X DOM fixtures**：脱敏样本（timeline / search f=live / replies / profile）锁定 reader→detector 契约。

### 工程

- WXT 0.21 + React 19 + MV3，最小权限（storage + x.com）。
- 四包 monorepo：detector（纯逻辑）/ x-adapter / block-queue / extension。
- 95 个单元测试 + 本地质量门禁（lint / typecheck / test / build，pre-push 自动执行）。
- 架构借鉴 PureTwitter / TBWL 实证方案：XHR 桥（MAIN world）取 GraphQL 数据 → 原生 Block API 执行，不做任何 Hide / Collapse。

### 已知限制

- 已拉黑账号的推文在 X f=live 搜索流中重开页面仍可能被服务端返回（扩展在拉黑当次移除 DOM）；持久过滤已拉黑账号留待后续版本。
- 批量操作依赖当前活动标签页为 x.com 新版页面；多标签场景下旧标签可能提示找不到会话。