# FeedSieve Implementation Plan

> 详细工程规范见 [`TECHNICAL_SPEC.md`](TECHNICAL_SPEC.md)。  
> 本文件用于回答：**按什么顺序开发，做到什么程度可以进入下一阶段。**

## 0. 最终架构决定

FeedSieve 不做成一个依赖 X API 的第三方客户端。

总原则：

> **Local first. Community second. AI third. Browser-native actions when needed.**

具体决定：

- 浏览器插件是第一产品形态
- `filter-engine` 是技术本体
- `x-adapter` 同时包含 Reader Adapter 和 Action Adapter
- FeedSieve 自己的 Hide / Collapse 永远本地优先
- X 原生 Block / Mute 通过用户当前已登录的网页完成
- Community API 只负责 FeedSieve 社区报告 / 评分 / Snapshot
- 不把 X OAuth / Developer API 作为核心依赖
- YAML 是公开审计源，JSON 是 Extension 运行时产物
- `x_user_id` 可选，`handle` 是 MVP 可稳定获得的身份字段
- Community Snapshot 在本地查询，不在滚动 Timeline 时逐条请求服务器

## 1. 推荐仓库结构

```text
apps/
  extension/

packages/
  filter-engine/
  x-adapter/
  community-client/
  list-format/
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
- `packages/filter-engine`
- `packages/x-adapter`
- Vitest
- Playwright
- ESLint / formatter / typecheck
- GitHub Actions

验收：

- unpacked extension 可正常加载
- `x.com` 能注入 content script
- workspace package 能互相引用
- CI build / test 通过

## 3. Phase 1 — X Reader + Local Filter

这是第一个真正有用户价值的版本。

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

### Filter Engine

实现：

- Personal Allowlist
- Personal Blocklist
- Keyword
- Exact phrase
- Regex

优先级：

```text
Allowlist
> Personal Blocklist
> Local Rules
> Community
> AI
```

### UI

实现：

```text
抬走
已滤，别看了
为什么？
我偏要看
自己人，别开枪
```

验收：

- 完全断网仍可过滤
- 滚动 Timeline 不明显掉帧
- 每条过滤结果能解释原因
- 用户恢复内容后页面不崩

## 4. Phase 2 — Single X Native Action

目标：验证 Browser-native Action Adapter。

只做**单账号**，不要一开始批量。

流程：

```text
用户点击「抬走」
      ↓
FeedSieve 本地 Hide
      ↓
可选「顺手拉黑」
      ↓
X Action Adapter 打开原生 ... 菜单
      ↓
找到 Block
      ↓
点击确认
      ↓
等待 UI 成功状态
```

Action Adapter 必须：

- 识别当前 handle
- 有 timeout
- 有 error reason
- 不成功不假装成功
- 中文 / 英文至少有 fixture

验收：

- 用户显式触发一次 Block 能稳定完成
- 页面 DOM 不匹配时安全失败
- 不读取 Cookie / OAuth Token

## 5. Phase 3 — Community Snapshot Consumer

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
- 本地 index
- 网络失败使用 last-known-good snapshot

第一版社区模式：

- 清爽：Strong
- 标准：Strong hide + Recommended collapse
- 大扫除：Recommended / Strong hide，Candidate collapse

验收：

> 一个全新安装、没有任何用户自定义规则的 FeedSieve，也可以因为公开名单立刻产生过滤效果。

## 6. Phase 4 — Community Contribution Backend

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

## 7. Phase 5 — Open Reputation Pipeline

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

## 8. Phase 6 — Native Action Queue

这一阶段才做批量 X 原生操作。

研究 PureTwitter / Twitter-Block-Porn 后确认：批量动作必须作为一个**持久化队列系统**实现，而不是 `for (...) click()`。

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
- 暂停
- 恢复
- 取消
- 页面反馈后再进入下一项
- 验证 / 登录异常立即停
- Manifest V3 service worker 被回收后状态不丢

默认“一键启用社区清单”仍然只是 Local Hide。

Native Block Sync 是高级可选能力。

## 9. Phase 7 — Fingerprint + Domain Reputation

Pure account list 有天然缺点：垃圾号会不断换号。

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

验收：新垃圾账号复制已知垃圾模板时，能够被模板规则识别。

## 10. Phase 8 — Optional AI

到这里才加入 AI。

AI 用于：

- 隐蔽 AI slop
- 软广告
- 语义型 engagement bait
- 自然语言个人偏好

AI 不处理：

- 已知 Personal Block
- Strong Community Account
- 明确 Keyword / Regex
- 已知 Fingerprint

必须有 Decision Cache。

## 11. Phase 9 — Growth

- 今日战报
- 估算“替你少看了多少垃圾时间”
- X 分享卡片
- Filter Pack 订阅生态
- Third-party Packs
- PureTwitter / 外部列表导入

## 12. v0.1 的明确范围

v0.1 **不要等后端**。

发布条件：

- Chrome / Edge
- Home Timeline
- Replies
- Account allow/block
- Keyword / Regex
- 抬走
- Collapse / Hide
- 我偏要看
- 为什么
- 本地统计
- 单账号“顺手拉黑”
- Reader fixtures
- Filter Engine unit tests

做到这一点就发第一个版本。

## 13. 竞争产品带来的实施原则

### PureTwitter

证明：

- Keyword + Blacklist 有真实价值
- 用户需要共享名单
- 用户强烈在意误杀

因此 FeedSieve 必须把：

- Allowlist precedence
- Explainability
- Rescue
- Open List

作为基础能力。

### Twitter-Block-Porn

证明：

- GitHub JSON 名单能实际工作
- 批量 Block 有真实需求
- Queue / progress / incremental update 是必须的

因此 FeedSieve：

- 用 GitHub / CDN 发布 Snapshot
- Native batch action 必须 Queue 化
- 只对新增 Snapshot entry 生成可选同步任务

## 14. 开工前不要再改的核心决策

除非实测证明不可行，以下先冻结：

1. WXT + TypeScript + React
2. Filter Engine 独立 package
3. X Reader / Action Adapter 独立 package
4. Local Hide 是核心
5. Browser-native X actions，不以 OAuth 为主
6. Community Snapshot 本地查询
7. YAML source + JSON runtime
8. `handle` required / `x_user_id` optional
9. Community Policy 公开 YAML
10. AI 最后接入

先把 v0.1 跑起来，再根据真实 X DOM 和用户数据调整。
