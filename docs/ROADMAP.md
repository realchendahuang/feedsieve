# FeedSieve Roadmap

> 实施细节见 [`TECHNICAL_SPEC.md`](TECHNICAL_SPEC.md) 与 [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md)。

## v0.1 — 能真正用

目标：**没有后端、没有 AI，也能明显改善 X。**

- WXT + TypeScript + React 基础架构
- 独立 `filter-engine`
- 独立 `x-adapter`
- X Home Timeline
- Replies
- Personal Allowlist / Blocklist
- Keyword / Exact phrase / Regex
- Inline「抬走」
- Hide / Collapse
- 「我偏要看」
- 「为什么？」可解释原因
- 本地统计
- 单账号「顺手拉黑」Browser-native Action
- X DOM fixtures
- Filter Engine unit tests

成功标准：

> 用户安装后 5 分钟内能明显看到垃圾减少，而且断网仍然能工作。

## v0.2 — 社区名单开始产生网络效应

目标：**新用户不用配置规则也能直接受益。**

- Community Snapshot Manifest
- Versioned JSON List
- YAML public source
- Schema validation
- Local Community Index
- Filter strength：清爽 / 标准 / 大扫除
- Community Filter Packs 基础
- Last-known-good offline cache
- PureTwitter / 外部简单名单导入研究

成功标准：

> 新安装用户只开启官方 Community Pack，就能立刻过滤已知垃圾账号。

## v0.3 — 社区共创与公开信誉

目标：**一个人发现垃圾，所有人都可以少看一次。**

- Community Report API
- Rescue API
- Candidate Pool
- Community Score v1
- Reporter Trust v1
- `community/policy/v1.yaml`
- Report / Rescue idempotency
- Basic burst / abuse detection
- YAML Snapshot Generator
- JSON deterministic build
- Changelog
- Account aliases
- `handle` required / `x_user_id` optional

成功标准：

> 任意社区名单条目都能从 GitHub 看懂来源、分类、分数和变更历史。

## v0.4 — Native Action Queue

目标：**把“批量同步到 X”做成一个安全、可恢复的用户任务。**

- Persistent Native Action Queue
- Progress
- Pause / Resume / Cancel
- Error state
- MV3 worker restart recovery
- Incremental Snapshot diff
- Small-batch Native Block Sync
- Mute / Unblock / Unmute

原则：

> 一键启用社区名单默认是 Local Hide；Native Block Sync 永远是用户额外选择。

## v0.5 — 从账号名单升级成垃圾网络识别

- Content Fingerprint
- Normalized template hash
- Domain Reputation
- Account / Fingerprint / Domain entity model
- Campaign foundation
- Duplicate / copy-paste clustering

成功标准：

> 垃圾号换了账号但继续复用同一话术 / 域名时，FeedSieve 仍然能够识别。

## v0.6 — AI 会认

目标：只处理规则、社区和模板仍然不能可靠判断的模糊内容。

- OpenAI-compatible Provider
- 自定义 Endpoint / Model
- AI slop
- Soft advertising
- Engagement bait
- 自然语言过滤偏好
- AI Decision Cache

原则：

> AI 是最后一层增强，不是 FeedSieve 的基础依赖。

## v0.7 — 会整活

目标：让过滤过程产生传播。

- 福滤娃今日战报
- 分享卡片
- 类型统计
- 社区贡献统计
- 估算「替你少看了多少垃圾时间」
- 一键分享到 X

## v0.8 — Filter Pack 生态

- Third-party Filter Pack
- Pack metadata / maintainer / version
- Pack subscription
- Import / Export
- Public Pack Registry（如有必要）
- Firefox
- Safari 评估
- Developer Filter API / SDK
- 更多信息流 Adapter

## 当前实施顺序

如果现在开始开发，严格按照：

```text
v0.1 Local Filter
  ↓
v0.2 Community Snapshot Reader
  ↓
v0.3 Report / Rescue / Open Reputation
  ↓
v0.4 Native Action Queue
  ↓
v0.5 Fingerprint / Domain
  ↓
v0.6 AI
```

不要为了 AI 或批量 Block 推迟第一个可用版本。
