# FeedSieve Implementation Plan

## 0. 一句话架构

> **产品形态：浏览器插件。技术本体：独立 Filter Engine。第一战场：X。长期方向：用户自己的互联网注意力过滤层。**

FeedSieve 的核心不应该是“每条内容都问一次 AI”，而是把个人规则、社区共同积累的垃圾账号信誉和可选 AI 组合成一个本地优先、透明、可解释、可 Fork 的过滤系统。

推荐优先级：

> **Local first. Community second. AI third.**

---

## 1. 产品为什么从浏览器插件开始

垃圾信息真正造成价值损失的时刻，是它进入用户视野的那一刻。

FeedSieve 最自然的体验是：用户照常打开 `x.com`，无需切换第三方客户端，插件直接在 Home Timeline、Replies、Search 等页面中完成识别、折叠和隐藏。

第一阶段不建议做完整第三方 X 客户端，也不建议把桌面 App 当成核心入口。浏览器扩展的优点：

- 不改变用户原有 X 使用习惯
- 可以直接作用于原生 Timeline / Replies / Search
- 可以在内容进入视野前完成过滤
- 本地规则延迟极低
- 不依赖 X 写 API 才能产生价值
- Chrome / Edge / Firefox / Safari 可以逐步扩展
- 适合开源分发和快速安装

浏览器扩展只是第一层产品壳，过滤逻辑必须尽量独立于 X DOM 和浏览器 UI。

---

## 2. 总体架构

```text
                         FeedSieve
                             │
             ┌───────────────┴───────────────┐
             │                               │
      Browser Extension              Open Community
             │                               │
       X DOM Adapter                 Reports / Rescue
             │                               │
             └──────────────┬────────────────┘
                            ↓
                     Filter Engine
                            │
          ┌─────────────────┼─────────────────┐
          ↓                 ↓                 ↓
   Personal Rules     Community Data     Optional AI
          │                 │
          │           Community API
          │                 │
          │              Database
          │                 ↓
          │          Open Scoring Logic
          │                 ↓
          │           YAML Snapshot
          │                 ↓
          │          JSON Build Artifact
          │                 ↓
          └────────── Local Cache
                            ↓
                        X Timeline
                            ↓
                    这条味儿不对，抬走
```

长期推荐仓库结构：

```text
feedsieve/
├── apps/
│   └── extension/                 # WXT browser extension
├── packages/
│   ├── filter-engine/             # 与浏览器/X 解耦的核心判断逻辑
│   ├── x-adapter/                 # X DOM / 页面适配
│   ├── community-client/          # 社区名单下载、缓存、校验
│   └── shared/                    # types / schema / utils
├── services/
│   └── community-api/             # 开源社区后端
├── community/
│   ├── source/                    # 人类可读的 YAML 公开源
│   ├── lists/                     # 插件读取的 JSON 构建产物
│   ├── schema/                    # JSON Schema（同样可验证 YAML）
│   └── changelog/                 # 名单变更记录
├── scripts/
│   ├── build-community-lists/
│   ├── validate-community-lists/
│   └── generate-checksums/
├── assets/
│   └── brand/
├── docs/
└── .github/workflows/
```

---

## 3. 三层过滤体系

### Layer 0 — User Override

所有自动判断之前，先检查用户自己的显式选择。

优先级最高：

1. Personal Allowlist
2. Personal Blocklist
3. Temporary Show / Hide

原则：用户自己的明确选择必须覆盖社区和 AI。

例如社区认为某账号是垃圾，但用户把它加入“自己人，别开枪”，FeedSieve 不应该继续隐藏。

---

### Layer 1 — Local Rules

第一层只做本地、确定性、低延迟判断。

支持：

- 关键词
- Exact phrase
- 正则表达式
- 账号黑名单
- 账号白名单
- 域名规则
- 重复文本指纹
- 高重复回复模式
- 常见营销模板
- 用户自定义 Filter Rule
- 后续可订阅的静态 Filter Pack

例子：

```text
关键词
"DM me"
"link in bio"
"100x gem"
"join telegram"

正则
/(100x|1000x).*(coin|gem)/i

域名
t.me
example-spam.site
```

本地规则命中后不需要调用服务器，也不需要调用模型。

特点：

- 快
- 免费
- 可解释
- 隐私友好
- 离线可用

---

### Layer 2 — Community Filter Network

这是 FeedSieve 最重要的网络效应来源。

用户在 X 页面可以直接点击：

> **抬走这个账号**

本地立刻加入 Personal Blocklist。如果用户开启社区共创，再额外提交一个最小化 Community Report。

推荐分类：

- `bot_spam` — 机器人 / 自动化刷屏
- `copy_paste` — 复制粘贴
- `ai_slop` — 低质量 AI 灌水
- `advertising` — 广告 / 营销
- `adult_spam` — 色情 / 灰产引流
- `scam` — 钓鱼 / 诈骗
- `engagement_bait` — 互动钓鱼
- `other` — 其他

社区的目标不是建立一个“谁是坏人”的名单，而是建立一个更窄、更可解释的信号：

> **这个账号是否正在以大量用户都认为低价值的方式持续消耗注意力？**

核心增长飞轮：

```text
更多用户
   ↓
更多人发现垃圾账号
   ↓
更多高质量社区信号
   ↓
公开名单更准确
   ↓
新用户安装后立即得到价值
   ↓
过滤效果更好
   ↓
更多用户
```

一句产品化表达：

> **一个人发现垃圾，所有人都可以少看一次。**

---

### Layer 3 — Optional AI

AI 只处理前面两层仍然无法可靠判断的内容。

适合 AI 的场景：

- 语义上属于 AI slop，但没有固定关键词
- 软广告
- 隐蔽 engagement bait
- 自然语言定义的个人过滤偏好
- 文本上下文才能判断的低质量回复

不适合 AI 的场景：

- 已经在社区 Strong List 的账号
- 明确黑名单账号
- 命中精确关键词 / 正则
- 已知重复模板

AI Provider 应该可插拔，首版支持 OpenAI-compatible API 即可：

```text
baseURL
apiKey
model
timeout
prompt template
```

默认不强制要求 AI Key。没有模型，FeedSieve 仍然应该是完整可用的产品。

---

## 4. X 页面处理流程

推荐完整顺序：

```text
DOM mutation
   ↓
Post Extractor
   ↓
Normalize
   ↓
Personal Allowlist? ── yes ──> KEEP
   ↓ no
Personal Blocklist? ── yes ──> HIDE
   ↓ no
Local Rules
   ↓
Community Reputation
   ↓
Duplicate / Spam Heuristics
   ↓
Optional AI fallback
   ↓
Decision
   ↓
KEEP / COLLAPSE / HIDE
   ↓
Local stats + explainability
```

每个判断应返回：

```ts
type Decision = {
  action: "keep" | "collapse" | "hide";
  source: "personal" | "local_rule" | "community" | "heuristic" | "ai";
  reason: string;
  category?: string;
  confidence?: number;
  ruleId?: string;
};
```

用户点击“为什么？”时，应该能看到类似：

> 命中 Community / Bot Spam Pack  
> Community Score 0.91  
> 27 个有效报告，2 个 Rescue

或者：

> 命中你的关键词：`join telegram`

这就是 Explainable Filtering。

---

## 5. “5 个人屏蔽”应该怎么实现

`5 个用户屏蔽 -> 自动进入全球黑名单` 可以用于冷启动实验，但不建议成为长期规则。

原因：

- 小号刷票
- 群体围攻
- 竞争对手恶意举报
- 热点争议导致正常账号被误伤
- 5 个相关账号并不等于 5 个独立判断

推荐把“5 个独立有效报告”只作为 Candidate 门槛：

```text
0-4 个独立有效报告
    -> normal

>= 5
    -> candidate

Community Score 达标
    -> recommended

大量高可信、长期分散的一致报告
    -> strong
```

插件可以提供三种过滤强度：

- 保守：只自动隐藏 `strong`
- 默认：隐藏 `strong`，折叠 `recommended`
- 激进：连 `candidate` 都折叠

第一版阈值建议保持简单并公开，后续通过真实数据调整。

---

## 6. Community Score

第一版不需要机器学习，简单、可解释的加权模型更适合开源治理。

概念：

```text
Community Score
= weighted reports
+ consistency bonus
+ temporal spread bonus
- weighted rescue votes
- burst penalty
- sybil penalty
```

输入建议：

### 正向

- 独立有效报告人数
- Reporter Trust
- 报告原因的一致性
- 报告在多个不同时间段持续出现
- 可选的公开 evidence post id

### 负向

- Rescue Vote
- 短时间异常集中举报
- 新安装实例短时间大量举报
- 同一安装对大量无关账号机械式举报
- 举报原因高度混乱

不要为了“独立性”默认收集精确地理位置。时间分布、匿名安装身份和行为模式已经可以提供第一阶段所需的反作弊信号。

---

## 7. Reporter Trust

社区共创不能简单做到“一安装一票永远等权”。

建议插件首次安装时本地生成匿名 installation identity，后续可升级为本地密钥对并对报告签名。

第一版 Trust 可以参考：

- 使用时间越长，权重缓慢提升
- 历史报告与社区最终结果长期一致，提升
- 报告后经常被大量 Rescue，下降
- 短时间疯狂举报，下降
- 一个 installation 对同一 x_user_id 只能贡献一个当前有效意见

不要求用户第一天就注册账号。

后续如果社区遭遇严重 Sybil 攻击，再考虑：

- 可选 GitHub / email 登录
- 更强 device attestation
- reputation staking
- 人工审核队列

先不要过早复杂化。

---

## 8. Rescue / Appeal 必须和 Block 同等重要

“我偏要看”只是本地临时展开，不应该自动产生 Community Rescue，避免把一次好奇点击误当成反对社区判断。

真正的反向信号应该由用户明确点击：

> **这条还能抢救**

社区系统至少支持：

- Report
- Rescue Vote
- Appeal
- Removal
- Personal Allowlist
- Score decay

如果账号行为改变、误判被确认，应该能够离开名单。

名单不是永久刑罚。

---

## 9. Filter Packs

不要维护一个覆盖所有偏好的“宇宙总黑名单”。

官方可以维护多个明确目标的 Filter Pack：

```text
Bot Spam
Copy-paste Replies
AI Slop
Crypto Scam
Adult / Gray Traffic Spam
Engagement Bait
```

用户自由订阅。

高度主观的内容，例如：

- 政治立场
- 某个兴趣领域
- 某种语言
- 某种价值观

默认不应该进入官方垃圾名单。

这些更适合：

- Personal Rules
- 用户主动订阅的第三方 Filter Pack

核心原则：

> **Hide garbage, not opinions.**

---

## 10. YAML 与 JSON：双格式设计

FeedSieve 公开名单建议同时提供 YAML 和 JSON，但职责不同。

### YAML — 人类可读源

位置：

```text
community/source/recommended.yaml
```

用途：

- GitHub 直接阅读
- PR Review
- 手工审计
- Fork
- 查看 Diff
- 讨论治理

YAML 是公开快照的 canonical human-readable representation。

### JSON — 运行时构建产物

位置：

```text
community/lists/recommended.json
```

用途：

- Browser Extension 下载
- 本地缓存
- 快速解析
- JSON Schema 校验
- CDN / Release 分发

推荐 CI：

```text
Database / Reports
      ↓
Open Scoring Algorithm
      ↓
Safeguards
      ↓
recommended.yaml
      ↓
Schema Validate
      ↓
Compile
      ↓
recommended.json
      ↓
SHA-256 / signature
      ↓
Git Commit + GitHub Release
```

这样维护者和社区主要看 YAML，插件主要吃 JSON。

---

## 11. YAML 条目格式

推荐使用稳定 `x_user_id` 作为主键，因为 handle 可以修改。

```yaml
- x_user_id: "123456789"
  handle: example_spam
  category: bot_spam
  status: recommended
  community_score: 0.91
  report_count: 27
  rescue_count: 2
  first_seen_at: "2026-08-20T12:00:00Z"
  updated_at: "2026-08-26T00:00:00Z"
  evidence_post_ids:
    - "0000000000000000000"
```

公开名单尽可能回答：

- 为什么它在这里？
- 是哪一种垃圾模式？
- 有多少有效报告？
- 有多少 Rescue？
- 当前 Community Score？
- 什么时候加入？
- 最近什么时候更新？

---

## 12. 公开什么，不公开什么

### 应公开

- 聚合社区名单
- 分类
- status
- Community Score
- report count
- rescue count
- 阈值与评分算法
- 公开 evidence post id（可选）
- 名单版本
- Git diff
- 加入 / 移除原因
- 构建脚本

### 不公开

- 用户真实身份
- 原始 installation id
- IP 地址
- Cookie
- X 登录凭证
- 私信
- 完整浏览历史
- 所有用户看过的推文

透明针对的是 **过滤决策**，不是贡献者隐私。

---

## 13. Community API

第一版 API 可以很小。

### 提交报告

```http
POST /v1/reports
```

```json
{
  "target_x_user_id": "123456789",
  "target_handle": "example_spam",
  "reason": "bot_spam",
  "evidence_post_id": "0000000000000000000",
  "client_version": "0.2.0"
}
```

### Rescue

```http
POST /v1/rescues
```

### 获取 Manifest

```http
GET /v1/lists/manifest
```

返回：

```json
{
  "recommended": {
    "version": "2026.08.26.143",
    "sha256": "...",
    "url": "..."
  }
}
```

### 获取公开账号解释

```http
GET /v1/accounts/:x_user_id
```

可以返回聚合后的公开解释，不返回举报者原始身份。

---

## 14. 最小数据库

建议首版使用普通 SQL；Cloudflare Workers + D1 是一个轻量选择，但架构不应绑定 Cloudflare。

```text
accounts
- x_user_id PK
- current_handle
- first_seen_at
- updated_at
- community_score
- status

reporters
- id
- anonymous_public_key / installation hash
- trust_score
- created_at
- updated_at

reports
- id
- reporter_id
- x_user_id
- reason
- evidence_post_id nullable
- created_at
- active

rescues
- id
- reporter_id
- x_user_id
- created_at
- active

list_entries
- x_user_id
- category
- score
- status
- snapshot_version
- updated_at
```

如需服务端防滥用，可以短暂使用网络层速率限制，但不要把可识别 IP 当作公开数据或长期社区身份。

---

## 15. 一键启用社区名单，而不是一开始同步 X Block

产品 UI 可以叫：

> **一键抬走社区名单**

但 MVP 技术上应该采用 FeedSieve Local Block：

```text
下载 Community JSON
      ↓
本地建立 Set / Map
      ↓
X 页面出现账号
      ↓
命中列表
      ↓
collapse / hide
```

好处：

- 不依赖 X 写 API
- 快
- 免费
- 可以瞬间撤销
- 不污染用户原生 Block List
- X API 政策变化不会摧毁核心功能

以后可以把“同步到 X Mute / Block”做成可选高级能力，但不能成为主链路。

---

## 16. 社区名单同步策略

不要在用户滚动 Timeline 时为每个账号实时请求服务器。

正确做法：

```text
Extension startup / scheduled refresh
      ↓
GET manifest
      ↓
版本没变 -> 继续使用本地缓存
      ↓
版本变化
      ↓
下载 JSON
      ↓
checksum / signature verify
      ↓
IndexedDB / extension storage
      ↓
全天本地查询
```

对于几万或几十万账号，可以逐步采用：

- Hash Set
- IndexedDB
- 分包 Filter Pack
- 压缩快照
- Bloom Filter 做快速前置判断

MVP 先用简单 Map/Set，不要过早优化。

---

## 17. 安全与供应链

长期建议每个列表版本生成：

```text
recommended.yaml
recommended.json
recommended.json.sha256
recommended.json.sig
```

插件只加载：

1. Schema 合法
2. checksum 正确
3. 签名可信
4. schema_version 支持

的快照。

GitHub 本身提供变更历史；签名用于防止 CDN、镜像或分发链路被偷偷替换。

---

## 18. 开源治理

FeedSieve 的开源目标：

> **Open Code + Open Rules + Open Lists + Open Governance**

尽量公开：

- Browser Extension
- Filter Engine
- X Adapter
- Community API
- Community Score
- Reporter Trust
- YAML Lists
- JSON Artifacts
- Schema
- Build Scripts
- CI
- Changelog
- Appeal / Removal 流程

任何影响“为什么一条内容或一个账号被过滤”的核心逻辑，都应该尽量能够被查看和讨论。

Git 本身就是审计日志：

- 每一次名单变化有 diff
- 可以 Issue 申诉
- 可以 PR 修正
- 可以 Fork
- 可以建立第三方 Pack
- 可以独立复现构建结果

最终理念：

> **过滤权属于用户。**

以及：

> **连黑名单本身都应该晒在阳光下。**

---

## 19. UI 最小闭环

### X Inline Actions

```text
抬走这个账号
自己人，别开枪
这条还能抢救
```

### Filter Placeholder

```text
已滤，别看了 · 为什么？ · 我偏要看
```

### Extension Popup

尽量轻：

```text
福滤娃

今天替你看了 428 条
抬走 38 条

[ 今日战报 ]
[ 调教福滤娃 ]
```

### Options

- Enable / Disable
- Personal Blocklist
- Personal Allowlist
- Keywords / Regex
- Filter Packs
- Community filtering strength
- Community contribution opt-in
- AI Provider（后期）
- Privacy / Data reset

---

## 20. 开发顺序

### v0.1 — 个人过滤先跑通

目标：完全没有后端、没有 AI 也能有价值。

- WXT + TypeScript + React
- X DOM Observer
- Post Extractor
- Personal Blocklist / Allowlist
- Keywords / Regex
- 手动“抬走”
- “我偏要看”
- 本地统计
- Explainable reason

成功标准：

> 用户安装 5 分钟后明显感觉 X 更干净。

### v0.2 — 社区网络

- Community API
- Anonymous reporter identity
- Report / Rescue
- Candidate >= 5
- Community Score
- Reporter Trust
- YAML canonical snapshot
- JSON generated artifact
- Manifest + local cache
- 一键启用社区名单
- Filter Packs

成功标准：

> 新用户安装后，即使没有配置任何关键词，也能立刻继承社区已有过滤经验。

### v0.3 — AI 增强

- OpenAI-compatible adapter
- Natural language personal rules
- AI slop classifier
- soft-ad classifier
- fallback only

成功标准：

> AI 主要处理长尾模糊场景，而不是成为高成本主链路。

### v0.4 — 传播

- 福滤娃今日战报
- 分享卡片
- 垃圾类别统计
- 随机品牌梗文案
- 一键分享到 X

增长循环：

```text
过滤
 ↓
统计
 ↓
生成战报
 ↓
发 X
 ↓
新用户安装
 ↓
贡献更多社区信号
 ↓
过滤更准
```

---

## 21. 最终产品壁垒

模型能力本身很难形成长期壁垒，因为任何插件都可以调用类似的模型。

FeedSieve 更值得积累的资产是：

1. **高质量 Local Filter Engine**
2. **公开、可审计的 X 垃圾账号信誉图谱**
3. **社区贡献与 Rescue 数据**
4. **Filter Pack 生态**
5. **透明治理和可信构建链路**
6. **福滤娃品牌人格与传播机制**

如果这一层做好，未来第三方甚至不需要使用 FeedSieve 浏览器插件，也可以直接消费公开名单，把它接进自己的客户端、Agent、研究系统或其他信息过滤产品。

FeedSieve 就会从一个浏览器扩展，逐步变成一个开放的互联网过滤基础设施。
