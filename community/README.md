# FeedSieve Community Lists

这里存放 FeedSieve 的公开社区名单数据和治理政策。

目标不是维护一个神秘的“封禁名单”，而是让社区能够看到、审计、讨论、申诉和 Fork 名单结果。

核心原则：

> **YAML for humans. JSON for machines.**

## 目录

```text
community/
├── README.md
├── source/
│   └── recommended.yaml       # 人类可读、Git 可审计的公开源
├── lists/
│   ├── manifest.json          # Snapshot 版本入口
│   └── recommended.json       # 浏览器插件读取的构建产物
├── policy/
│   └── v1.yaml                # 公开社区评分政策
├── schema/
│   └── account-list.schema.json
└── changelog/                 # 后续加入版本变更记录
```

## 为什么同时有 YAML 和 JSON

### YAML

`source/*.yaml` 是 GitHub 上主要给人看的格式：

- 可读性好
- PR Review 友好
- Diff 清楚
- 容易审计
- 容易 Fork 和维护第三方 Block Pack

### JSON

`lists/*.json` 是插件运行时使用的格式：

- 解析简单
- 容易缓存
- 容易 Schema 校验
- 适合 CDN / GitHub Release 分发
- 后续可以生成 checksum / signature

### Manifest

`lists/manifest.json` 是 Extension 更新入口。

插件应先检查 Snapshot version，只有版本变化时才下载大名单。

推荐链路：

```text
Community Reports
      ↓
Open Scoring Algorithm
      ↓
community/policy/v1.yaml
      ↓
Safeguards
      ↓
source/recommended.yaml
      ↓
Schema Validate
      ↓
Deterministic Compile
      ↓
lists/recommended.json
      ↓
manifest + SHA-256
      ↓
Extension local cache
```

插件不需要在刷 X 时实时请求服务器，只需要按版本更新名单，然后全天本地查询。

## Account Identity

浏览器插件在 X 页面中通常可以稳定获得 `@handle`，但未必能在不依赖 X API / 私有 runtime 的情况下稳定获得 X User ID。

因此 v1 协议明确：

- `handle`: required
- `x_user_id`: optional
- `aliases`: optional

当未来可靠得到稳定 User ID 时，可以通过 aliases / migration 合并历史 handle。

示例：

```yaml
- handle: example_spam
  x_user_id: "123456789" # optional
  aliases:
    - old_handle
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

每个公开条目应该尽可能回答：

- 为什么这个账号在名单里？
- 属于什么垃圾模式？
- 有多少有效 Report？
- 有多少 Rescue？
- Community Score 是多少？
- 什么时候进入？
- 最近什么时候更新？

## Policy

评分阈值不隐藏在后端代码里。

当前：

[`policy/v1.yaml`](policy/v1.yaml)

冷启动规则示例：

```text
>= 5 independent reports -> candidate
score + time spread -> recommended
higher score + lower rescue -> strong
```

这些参数以后通过真实数据和公开 PR 调整。

## 不公开举报者原始身份

名单透明，不等于贡献者隐私也要公开。

公开：

- 聚合后的账号名单
- 分类
- 分数
- 有效 Report 数
- Rescue 数
- 阈值和算法
- 可选公开 evidence post ids
- 版本与 Git diff

不公开：

- 用户真实身份
- 原始 installation id
- IP 地址
- Cookie
- X 登录凭证
- 私信
- 完整浏览历史

## Extension 使用方式

```text
manifest
   ↓
version changed?
   ↓
JSON snapshot
   ↓
schema + checksum
   ↓
local index
   ↓
X Timeline -> Detector local lookup
```

服务器不可用时继续使用最后一个有效 Snapshot。

## Block Packs

后续计划允许官方和第三方维护独立 Block Pack，例如：

- Bot Spam
- Copy-paste Replies
- AI Slop
- Crypto Scam
- Adult / Gray Traffic Spam
- Engagement Bait

用户自己决定订阅哪些 Pack。

> **Block garbage, not opinions.**

政治立场、价值观、兴趣领域等高度主观偏好默认不进入官方全球垃圾名单，更适合作为第三方可选 Pack。

## 治理

- 名单公开
- 算法公开
- Policy 公开
- 变更可追踪
- 支持 Report / Rescue / Appeal / Removal
- 不公开举报者敏感信息
- 用户自己的判断永远可以覆盖社区标注（可移除、可放回）
- 不把观点差异当成默认垃圾标签

详细文档：

- [`../docs/TECHNICAL_SPEC.md`](../docs/TECHNICAL_SPEC.md)
- [`../docs/IMPLEMENTATION_PLAN.md`](../docs/IMPLEMENTATION_PLAN.md)
- [`../docs/COMMUNITY_FILTERING.md`](../docs/COMMUNITY_FILTERING.md)
- [`../docs/OPEN_SOURCE_GOVERNANCE.md`](../docs/OPEN_SOURCE_GOVERNANCE.md)
