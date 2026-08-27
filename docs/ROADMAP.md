# FeedSieve Roadmap

> 实施细节见 [`TECHNICAL_SPEC.md`](TECHNICAL_SPEC.md) 与 [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md)。

## v0.1 — 能真正拉黑

目标：**没有后端、没有 AI，也能真正送走垃圾账号。**

- WXT + TypeScript + React 基础架构
- 独立 `detector`
- 独立 `x-adapter`
- 独立 `block-queue`
- X Home Timeline / Replies / Search 基础
- 黄框标注（内置名单 + 启发式，带理由）
- 待拉黑列表（持久、可增删）
- 一键批量拉黑（Block Queue）
- 单账号「顺手拉黑」
- 一键撤销（Unblock）
- 本地统计
- X DOM fixtures
- Detector / Block Queue unit tests

成功标准：

> 用户安装后 5 分钟内能把第一批垃圾账号真正拉黑，手机端同步清净，而且断网仍然能标注。

## v0.2 — 社区名单闭环（带后端）

目标：**一个人拉黑，所有人的时间线自动黄框。**

- Cloudflare Worker + Hono + D1 后端（代码同仓库开源，任何人可自部署）
- Report API：拉黑后显式一键上报（匿名安装哈希、去重、限速）
- 快照管线：聚合 → 确定性 JSON + manifest + sha256，版本化分发
- 人工审核闸门：自动化只到 candidate（仅「大扫除」可见），recommended / strong 必须人工提升
- 扩展消费端：manifest 比对 + 校验和 + last-known-good + 本地索引
- 标注强度：清爽 / 标准 / 大扫除
- 个人白名单一票否决（误杀治理）
- Seed：官方名单第一批真实条目

成功标准：

> 全新安装、零配置就能标注官方名单上的垃圾账号；任何一次拉黑都可以流向所有用户。

## v0.3 — 治理升级（Report 基础已在 v0.2 落地）

目标：**上报规模变大后，社区名单仍然可信。**

- Rescue API + Removal 流程（名单不是永久刑罚）
- Community Score v1（置信加权、time spread、rescue 抵扣）
- Reporter Trust v1
- burst / abuse 检测（v0.2 仅去重 + 限速兜底）
- Candidate 自动化策略（`community/policy/v1.yaml`）
- Changelog / Account aliases

## v0.4 — 从账号名单升级成垃圾网络识别

目标：**垃圾号换号但复用话术 / 域名时，仍然能识别。**

- Content Fingerprint
- Normalized template hash
- Domain Reputation
- Account / Fingerprint / Domain entity model
- Campaign foundation
- Duplicate / copy-paste clustering

成功标准：

> 垃圾号换了账号但继续复用同一话术 / 域名时，FeedSieve 仍然能够识别标注。

## v0.5 — AI 会认

目标：只识别名单、启发式和模板仍然拿不准的模糊内容。

- OpenAI-compatible Provider
- 自定义 Endpoint / Model
- AI slop
- Soft advertising
- Engagement bait
- AI Decision Cache

原则：

> AI 是最后一层识别增强，不是 FeedSieve 的基础依赖。

## v0.6 — 会整活

目标：让清理过程产生传播。

- 福滤娃今日战报（今日送走 N 个）
- 分享卡片
- 类型统计
- 社区贡献统计
- 估算「替你少看了多少垃圾时间」
- 一键分享到 X

## v0.7 — Block Pack 生态

- Third-party Block Pack
- Pack metadata / maintainer / version
- Pack subscription
- Import / Export
- Public Pack Registry（如有必要）
- Firefox
- Safari 评估
- Developer Adapter API / SDK
- 更多平台 Adapter（YouTube / Instagram 评论区）

## 当前实施顺序

如果现在开始开发，严格按照：

```text
v0.1 标注 + 批量拉黑（含 Block Queue）
  ↓
v0.2 Community Snapshot Reader
  ↓
v0.3 Report / Rescue / Open Reputation
  ↓
v0.4 Fingerprint / Domain
  ↓
v0.5 AI
```

批量拉黑队列已经放进 v0.1；不要为了 AI 推迟第一个可用版本。
