# FeedSieve Implementation Plan

## 0. 一句话架构

> **产品形态：浏览器插件。技术本体：独立 Filter Engine。第一战场：X。长期方向：用户自己的互联网注意力过滤层。**

FeedSieve 不应该做成一个依赖 X API 的第三方客户端，也不应该把所有内容都交给 AI。

推荐总原则：

> **Local first. Community second. AI third. Browser-native actions when needed.**

也就是：

1. 本地规则先判断
2. 社区信誉其次
3. AI 只处理模糊情况
4. 需要 X 原生 Block / Mute 时，直接通过用户当前浏览器中的 X 页面完成

---

## 1. 为什么第一产品形态是浏览器扩展

垃圾信息真正造成注意力损失的时刻，是它进入用户视野的那一刻。

FeedSieve 最自然的体验：

```text
用户照常打开 x.com
      ↓
FeedSieve 在页面内读取 Timeline / Replies / Search
      ↓
垃圾内容在进入视野前被折叠或隐藏
      ↓
用户想进一步处理时，插件帮助完成 X 原生 Mute / Block
```

浏览器插件的优势：

- 不要求用户换 X 客户端
- 不需要重新登录
- 不需要 X OAuth 才能产生核心价值
- 可以直接处理原生 Timeline / Replies / Search
- 可以操作用户本来就能点击的 X 页面控件
- 安装和开源分发成本低
- Chrome / Edge / Firefox / Safari 可逐步扩展

---

## 2. 总体模块

```text
                         FeedSieve
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
  Browser Extension      Filter Engine       Open Community
        │                    │                    │
  X Browser Adapter          │              Reports / Rescue
        │                    │                    │
  ┌─────┴─────┐              │                    │
  │           │              │              Community API
Reader      Actions          │                    │
  │           │              │                 Database
Timeline   Block             │                    │
Replies    Mute              │              Open Scoring
Search     Unblock           │                    │
Account    Unmute            │               YAML Source
            │                │                    │
      Native Action Queue    │                CI Build
            │                │                    │
            └────────┬───────┴────────────── JSON Snapshot
                     │
                     ↓
                 Local Cache
                     ↓
                   x.com
```

推荐仓库结构：

```text
feedsieve/
├── apps/
│   └── extension/
│
├── packages/
│   ├── filter-engine/
│   ├── x-adapter/
│   │   ├── reader/
│   │   ├── actions/
│   │   ├── locators/
│   │   └── action-queue/
│   ├── community-client/
│   └── shared/
│
├── services/
│   └── community-api/
│
├── community/
│   ├── source/
│   ├── lists/
│   ├── schema/
│   └── changelog/
│
├── fixtures/
│   └── x/
│
├── scripts/
├── assets/
├── docs/
└── .github/workflows/
```

---

## 3. X Browser Adapter

这是浏览器端最重要的适配层。

它分两部分：

### 3.1 Reader

负责读取 X 页面并标准化：

```ts
type FeedItem = {
  source: 'x';
  postId?: string;
  author: {
    id?: string;
    handle: string;
    displayName?: string;
  };
  text: string;
  links: string[];
  context: 'timeline' | 'reply' | 'search' | 'profile' | 'other';
};
```

Reader 负责：

- SPA MutationObserver
- Timeline item 发现
- Replies 发现
- Search item 发现
- Account / Post 提取
- 链接 / 域名提取
- 后续 Fingerprint 输入准备

### 3.2 Actions

Actions 负责帮助用户执行 X 页面已经存在的原生操作：

- Block
- Unblock
- Mute
- Unmute
- Not interested

核心原则：

> **FeedSieve 不需要为了这些动作成为 X API Client。**

用户已经在浏览器里登录 X。插件只需要操作当前页面真实存在的菜单、按钮和确认对话框。

FeedSieve 后端不应该获得：

- X Password
- X Cookie
- X OAuth Token
- X Access Token

详细方案见 [`X_ACTION_ADAPTER.md`](X_ACTION_ADAPTER.md)。

---

## 4. Locator 与 X 改版隔离

不要让整个项目散落大量 X selector。

统一由 `packages/x-adapter/locators` 管理。

优先：

1. `data-testid`
2. `role`
3. `aria-*`
4. 稳定相对结构
5. 文本 fallback

不要依赖长 CSS class。

目标：

> X 改版时只修 x-adapter，不动 Filter Engine。

---

## 5. Filter Engine

这是 FeedSieve 真正长期可复用的技术本体。

输入：

```text
FeedItem
+ Personal Rules
+ Community Snapshot
+ Fingerprint / Domain Data
+ Settings
```

输出：

```ts
type Decision = {
  action: 'keep' | 'collapse' | 'hide';
  source: 'personal' | 'local_rule' | 'community' | 'heuristic' | 'ai';
  reason: string;
  category?: string;
  confidence?: number;
  ruleId?: string;
};
```

Filter Engine 不允许直接点击 X 页面。

它只回答一个问题：

> **这条内容要不要给用户看？**

---

## 6. 过滤优先级

### Layer 0 — User Override

最高优先级：

```text
Personal Allowlist
Personal Blocklist
Temporary Show / Hide
```

用户明确选择必须覆盖社区和 AI。

### Layer 1 — Local Rules

本地完成：

- keyword
- exact phrase
- regex
- account allow/deny list
- domain rules
- template rules
- repeated content fingerprint
- local filter packs

优点：

- 快
- 免费
- 可解释
- 离线可用
- 隐私好

### Layer 2 — Community Reputation

社区逐步维护四种信誉实体：

```text
Account
Content Fingerprint
Domain
Campaign
```

这样垃圾号换账号以后，模板和域名仍然可以暴露同一 Campaign。

### Layer 3 — Optional AI

AI 只处理前面仍然无法可靠判断的模糊内容：

- AI slop
- 软广告
- engagement bait
- 隐蔽营销
- 用户自然语言偏好

AI 不是必需依赖。

---

## 7. 页面处理流程

```text
DOM Mutation
   ↓
X Reader
   ↓
Normalize FeedItem
   ↓
Personal Allowlist? ─── yes ──> KEEP
   ↓ no
Personal Blocklist? ─── yes ──> HIDE
   ↓ no
Local Rules
   ↓
Community Reputation
   ↓
Fingerprint / Domain / Campaign Heuristics
   ↓
Optional AI
   ↓
Decision
   ↓
KEEP / COLLAPSE / HIDE
   ↓
Explainability + Local Stats
```

隐藏后必须允许：

> 已滤，别看了 · 为什么？ · 我偏要看

---

## 8. “抬走”操作

用户看到垃圾账号时：

```text
点击「抬走」
    ↓
立即加入 Personal Blocklist
    ↓
当前页面立即 Hide
    ↓
用户开启社区共创？
    ├── yes -> 提交 Community Report
    └── no  -> 仅本地
    ↓
可选：是否同步到 X？
    ├── 不用
    ├── Mute
    └── Block
```

这样一个动作同时覆盖：

- 个人体验
- 社区贡献
- 可选 X 原生状态

三者互相独立。

---

## 9. Community Report

推荐分类：

- `bot_spam`
- `copy_paste`
- `ai_slop`
- `advertising`
- `adult_spam`
- `scam`
- `engagement_bait`
- `other`

最小 payload：

```ts
{
  accountId?: string;
  handle: string;
  reason: string;
  evidencePostId?: string;
  reporterInstallationId: string;
  timestamp: string;
}
```

默认不上传：

- 完整浏览历史
- 全部看过的 Tweet
- DM
- X Cookie
- X Credential

---

## 10. Candidate / Recommended / Strong

“5 人屏蔽”适合作为候选门槛，不适合作为长期全球封禁规则。

```text
0-4 个独立有效报告
   -> normal

>= 5
   -> candidate

Community Score 达标
   -> recommended

大量高可信、时间分散的一致报告
   -> strong
```

插件模式：

- 清爽模式：只隐藏 Strong
- 标准清扫：Strong Hide + Recommended Collapse
- 大扫除：Candidate 也 Collapse

所有阈值公开。

---

## 11. Community Score

第一版使用可解释算法：

```text
Community Score
= Weighted Reports
+ Consistency Bonus
+ Temporal Spread Bonus
- Weighted Rescue Votes
- Burst Penalty
- Sybil Penalty
```

不要一开始就上黑箱 ML。

### 正向

- 独立报告人数
- Reporter Trust
- 原因一致
- 多时间段持续出现
- 可公开 Evidence

### 负向

- Rescue Vote
- 短时间集中举报
- 新安装实例异常大量举报
- 原因高度混乱

---

## 12. Reporter Trust

插件首次安装生成匿名 identity。

后续可升级本地密钥对，对报告签名。

Trust 参考：

- 使用历史
- 举报最终一致率
- Rescue 反向反馈
- 举报频率异常
- 同一 installation 对同一对象只算一份有效意见

第一阶段不强制注册。

---

## 13. Rescue / Appeal / Decay

社区系统必须支持：

- Report
- Rescue
- Appeal
- Removal
- Personal Allowlist
- Score Decay

“我偏要看”只是临时展开，不自动等于 Rescue。

Rescue 必须是用户显式动作：

> **这条还能抢救**

名单不是永久刑罚。

---

## 14. YAML + JSON

### YAML = 人类可读源

```text
community/source/*.yaml
```

用于：

- GitHub Review
- PR
- Diff
- Audit
- Fork
- 人工理解

### JSON = Runtime Artifact

```text
community/lists/*.json
```

用于：

- Extension 下载
- 本地缓存
- Schema validation
- Hash / signature
- 高效解析

推荐流水线：

```text
Community Reports
      ↓
Open Scoring
      ↓
Safeguards
      ↓
YAML Snapshot
      ↓
Schema Validate
      ↓
JSON Build
      ↓
Checksum / Signature
      ↓
GitHub Release / CDN
      ↓
Extension Local Cache
```

---

## 15. Filter Packs

官方不维护一个覆盖所有偏好的“宇宙总黑名单”。

推荐：

```text
Bot Spam
Copy-paste Replies
AI Slop
Crypto Scam
Adult / Gray Traffic Spam
Engagement Bait
```

以后第三方可以发布自己的 Pack。

用户自己选择订阅。

核心原则：

> **Hide garbage, not opinions.**

---

## 16. Native Action Queue

FeedSieve Local Hide 可以瞬间启用整个 Community List。

但是把清单同步成 X 原生 Block/Mute 时，必须排队。

```ts
type QueueItem = {
  action: 'block_account' | 'mute_account' | 'unblock_account' | 'unmute_account';
  handle: string;
  accountId?: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped';
  attempts: number;
  error?: string;
};
```

默认串行执行，因为 X 的 Dropdown / Dialog / SPA 状态不能安全并发。

用户界面：

```text
福滤娃正在大扫除
37 / 387

@spam001   已抬走
@spam002   已抬走
@spam003   失败
@spam004   正在处理

[暂停] [停止]
```

连续出现 X UI 结构错误、Challenge 或需要用户操作时，自动暂停。

不实现绕过平台验证或隐藏自动化行为的功能。

---

## 17. FeedSieve Hide 与 X Block 的区别

### 一键启用社区清单

默认推荐：

```text
Community JSON
   ↓
Local Cache
   ↓
Filter Engine
   ↓
Hide / Collapse
```

特点：瞬时、可撤销、不修改 X 账号状态。

### 同步到 X

用户显式触发：

```text
User confirms
   ↓
Native Action Queue
   ↓
X Browser UI
   ↓
Block / Mute
```

一句话：

> **Hide 是 FeedSieve 的基础能力；Block / Mute 是 FeedSieve 帮用户操作 X 的增强能力。**

---

## 18. Community API 的职责边界

Community API 只负责：

- reports
- rescue votes
- reporter trust
- entity reputation
- snapshots
- changelog

它不负责：

- 保存用户 X 登录状态
- 保存 X Cookie
- 保存 X OAuth Token
- 替用户调用 X Block API

因此服务器被攻破时，也不应该存在用户的 X 登录凭证可泄露。

---

## 19. X 改版测试

维护 Fixture：

```text
fixtures/x/
├── timeline/
├── replies/
├── search/
├── post-menu/
├── block-dialog/
├── mute-state/
└── account-page/
```

测试层：

- Locator Unit Test
- Filter Engine Unit Test
- Queue State Test
- Extension + Mock DOM Integration
- 每个 Release Manual Smoke Test

X 改版时优先修 `x-adapter`。

---

## 20. MVP 开发顺序

### v0.1 — 能滤

- WXT Extension
- X Reader
- Keyword / Regex
- Personal Block / Allow List
- Inline Hide / Show
- 一键“抬走”
- Local Stats

### v0.2 — 会共创

- Community API
- YAML / JSON Pipeline
- Candidate / Recommended / Strong
- Reporter Trust
- Rescue
- Community Packs
- Local community snapshot

### v0.3 — 会操作 X

- Block Action
- Mute Action
- Unblock / Unmute
- Native Action Queue
- 批量同步进度 UI

### v0.4 — 会认

- Content Fingerprint
- Domain Reputation
- Campaign Reputation
- Optional AI

### v0.5 — 会整活

- 今日战报
- 注意力节省估算
- 分享卡片
- 社区增长机制

---

## 21. 最终定位

FeedSieve 最终不是一个简单的“关键词屏蔽插件”。

它应该形成：

```text
Open Filter Engine
+
Open Reputation Graph
+
Open Filter Pack Ecosystem
+
Browser-native X Actions
+
Optional AI
```

最终一句话：

> **Filter Engine 决定“要不要看”；X Action Adapter 帮用户完成“要不要在 X 本身也处理掉”；Community 让一个人踩过的坑，后面的人不用再踩。**
