# FeedSieve Implementation Plan

> 详细工程规范见 [`TECHNICAL_SPEC.md`](TECHNICAL_SPEC.md)。  
> 本文件用于回答：**按什么顺序开发，做到什么程度可以进入下一阶段。**

## 0. 最终架构决定

FeedSieve 不做成一个依赖 X API 的第三方客户端。

总原则：

> **可见优先，拉黑唯一。Local detect. Community list. AI last. Native Block through the page.**

具体决定：

- 浏览器插件是第一产品形态
- `Block Engine` 是技术本体 = Detector（识别标注）+ Block Queue（拉黑队列）
- `x-adapter` 同时包含 Reader Adapter 和 Action Adapter
- 产品**不做任何 Hide / Collapse**。一切保持可见，直到用户按下拉黑
- X 原生 Block / Unblock 通过用户当前已登录的网页完成
- 所有批量动作由持久化 Block Queue 执行，绝不做 for-loop 点击
- Community API 只负责 FeedSieve 社区报告 / 评分 / Snapshot
- 不把 X OAuth / Developer API 作为核心依赖
- YAML 是公开审计源，JSON 是 Extension 运行时产物
- `x_user_id` 可选，`handle` 是 MVP 可稳定获得的身份字段
- 名单在本地查询，滚动 Timeline 时绝不逐条请求服务器

## 1. 推荐仓库结构

```text
apps/
  extension/

packages/
  detector/           # 识别标注（纯逻辑：名单 + 启发式）
  x-adapter/          # X Reader + Action Adapter
  block-queue/        # 持久化拉黑队列
  community-client/   # 快照下载 / 缓存 / 校验
  list-format/        # YAML / JSON / Schema
  shared/

services/
  community-api/

community/
  source/
  lists/
  policy/
  schema/
  changelog/

fixtures/x/
scripts/
docs/
```

## 2. Phase 0 — 工程骨架

目标：建立以后不需要推倒重来的边界。

实施：

- pnpm workspace
- WXT + React + TypeScript
- `packages/detector`
- `packages/x-adapter`
- `packages/block-queue`
- Vitest
- Playwright
- ESLint / formatter / typecheck
- 本地质量门禁（git pre-push 钩子：lint / typecheck / test / build）

验收：

- unpacked extension 可正常加载
- `x.com` 能注入 content script
- workspace package 能互相引用
- CI build / test 通过

## 3. Phase 1 — X Reader + Detector 标注

这是第一个真正有用户价值的版本：能认出垃圾。

### Reader Adapter

实现：

- Home Timeline
- Replies
- 基础 Search
- Tweet handle / post id / text / links
- SPA route change
- MutationObserver
- 去重处理

Selector 全部放到 `packages/x-adapter/src/selectors`。

### Detector

输入 FeedItem，输出标注结论（mark + reason + source）：

- 社区名单命中（v0.1 先用内置 `community/lists/recommended.json`）
- 账号启发式 v1：默认名 + 随机数字、垃圾域名链接、模板化文本
- **每个标注必须可解释**

### 标注 UI

- 黄框 + 理由标签（如「名单命中 · bot_spam」）
- 可勾选 / 取消勾选
- 「顺手拉黑」入口
- 标注绝不改动页面任何内容显示

验收：

- 完全断网仍可标注
- 滚动 Timeline 不明显掉帧
- 每个标注能解释原因
- 页面内容除黄框外零改动

## 4. Phase 2 — 单账号原生 Block / Unblock

目标：验证 Browser-native Action Adapter。

流程：

```text
黄框标注的账号
      ↓
用户点「顺手拉黑」
      ↓
X Action Adapter 打开原生 ... 菜单
      ↓
找到 Block
      ↓
点击确认
      ↓
等待 UI 成功状态
```

同时实现反向动作「放回来」（Unblock），误伤一键恢复。

Action Adapter 必须：

- 识别当前 handle
- 有 timeout
- 有 error reason
- 不成功不假装成功
- 中文 / 英文至少有 fixture

验收：

- 用户显式触发一次 Block 能稳定完成
- 用户显式触发一次 Unblock 能稳定完成
- 页面 DOM 不匹配时安全失败
- 不读取 Cookie / OAuth Token

## 5. Phase 3 — Block Queue 批量拉黑

这是 v0.1 的核心交付。

实现：

```text
待拉黑列表（持久，跨页面 / 会话累积）
Popup 可查看、增删
用户按下「一键拉黑 N 个」
      ↓
Block Queue 持久化全部任务
      ↓
逐项执行原生 Block
      ↓
验证页面反馈后再进入下一项
      ↓
进度 / 暂停 / 恢复 / 取消
```

Queue 要求：

```text
pending
running
success
failed
cancelled
```

必须：

- 用户显式启动
- 显示进度
- 暂停 / 恢复 / 取消
- 页面反馈后再进入下一项
- 登录异常 / 风控页面立即停
- Manifest V3 service worker 被回收后状态不丢
- 失败任务有明确原因

验收：

- 跨会话状态不丢（关闭浏览器后能恢复）
- 中途取消后 pending 任务保持可重新执行
- 不承诺某个固定批量数量一定安全

## 6. Phase 4 — Community Snapshot Consumer

此阶段可以先没有社区写入后端。

实现：

```text
community/lists/manifest.json
community/lists/recommended.json
```

Extension：

- 定期读取 manifest
- 版本变化才下载 snapshot
- schema validate
- checksum verify（生成流程完成后启用）
- 本地 index（供 Detector 查询）
- 网络失败使用 last-known-good snapshot

标注强度：

- 清爽：仅 Strong 名单命中标注
- 标准：Strong + Recommended 标注
- 大扫除：Strong + Recommended + Candidate 标注

验收：

> 一个全新安装、没有任何用户自定义规则的 FeedSieve，也能立刻黄框标注公开名单上的垃圾账号。

## 7. Phase 5 — Community Contribution Backend

推荐：

```text
Cloudflare Worker
+ Hono
+ D1
```

API：

```text
POST /v1/reports
POST /v1/rescues
GET  /v1/snapshots/latest
```

Report 只在用户明确点击“贡献给社区”时发送。

不上传完整浏览历史。

后端最低数据：

```text
accounts
account_aliases
reporters
votes
snapshots
```

必须实现：

- idempotency
- rate limit
- 一个 installation 对同目标一个当前有效意见
- reason enum
- basic burst detection

验收：

- 同一用户重复点不会无限加票
- Report / Rescue 可以相互覆盖
- 数据库可以重新计算账号状态

## 8. Phase 6 — Open Reputation Pipeline

目标：真正形成“公开透明的黑名单”。

Policy：

```text
community/policy/v1.yaml
```

默认：

```text
>= 5 independent reports -> candidate
score + time spread -> recommended
higher score + lower rescue -> strong
```

生成：

```text
DB
 ↓
Open Scoring
 ↓
YAML Snapshot
 ↓
Schema Validation
 ↓
Deterministic JSON
 ↓
Checksum
 ↓
Git / Release
```

公开字段：

- handle
- optional x_user_id
- aliases
- category
- status
- community_score
- report_count
- rescue_count
- first_seen_at
- updated_at
- optional evidence_post_ids

验收：

- 任意人可以仅从 GitHub 看懂某账号为什么进入名单
- JSON 可以从 YAML 确定性生成
- Policy 改动有 Git Diff

## 9. Phase 7 — Fingerprint + Domain 识别增强

纯账号名单有天然缺点：垃圾号会不断换号。

加入：

### Content Fingerprint

```text
normalize text
-> URL / mention placeholder
-> deterministic fingerprint
```

先 exact normalized fingerprint，后续再做 SimHash / MinHash。

### Domain

当能从 DOM 稳定拿到目标 URL 时记录 hostname。

长期实体：

```text
Account
Fingerprint
Domain
Campaign
```

验收：新垃圾账号复制已知垃圾模板时，Detector 能够识别标注。

## 10. Phase 8 — Optional AI

到这里才加入 AI。

AI 用于识别：

- 隐蔽 AI slop
- 软广告
- 语义型 engagement bait

AI 不处理：

- 社区名单强命中
- 明确启发式命中
- 已知 Fingerprint

必须有 Decision Cache。

## 11. Phase 9 — Growth

- 今日战报（今日送走 N 个）
- 估算“替你少看了多少垃圾时间”
- X 分享卡片
- Block Pack 订阅生态
- Third-party Packs
- 更多平台 Adapter（YouTube / Instagram 评论区）

## 12. v0.1 的明确范围

v0.1 **不要等后端**。

发布条件：

- Chrome / Edge
- Home Timeline / Replies / Search 基础
- 黄框标注（内置名单 + 启发式，带理由）
- 待拉黑列表（持久、可增删）
- 一键批量拉黑（Block Queue：进度 / 暂停 / 恢复 / 取消）
- 单账号顺手拉黑
- 一键撤销（Unblock）
- 本地统计
- X DOM fixtures
- Detector / Block Queue unit tests

做到这一点就发第一个版本。

## 13. 竞争产品带来的实施原则

### PureTwitter

证明：

- 用户需要共享名单
- 用户强烈在意误杀

因此 FeedSieve 必须把：

- 标注审查（用户确认后才拉黑）
- Explainability（每个黄框有理由）
- 一键撤销（Unblock）
- 开放名单

作为基础能力。

### Twitter-Block-Porn

证明：

- GitHub JSON 名单能实际工作
- 批量 Block 有真实需求
- Queue / progress / incremental update 是必须的

因此 FeedSieve：

- 用 GitHub / CDN 发布 Snapshot
- 批量拉黑必须队列化
- 只对新增 Snapshot entry 生成可选同步任务

## 14. 开工前不要再改的核心决策

除非实测证明不可行，以下先冻结：

1. WXT + TypeScript + React
2. Block Engine 独立（detector / block-queue / x-adapter 独立 package）
3. 产品永不隐藏内容（无 Hide / Collapse）
4. 黄框标注 → 待拉黑列表 → 一键批量拉黑 的产品循环
5. Browser-native Block，不以 OAuth 为主
6. Community Snapshot 本地查询
7. YAML source + JSON runtime
8. `handle` required / `x_user_id` optional
9. Community Policy 公开 YAML
10. AI 最后接入

先把 v0.1 跑起来，再根据真实 X DOM 和用户数据调整。
