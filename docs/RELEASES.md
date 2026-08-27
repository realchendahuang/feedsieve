# Release Notes

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