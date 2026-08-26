# PureTwitter Competitor Research

> Research target: Chrome extension `nflidllhiamnebgbgoemadhhfdpbbpbi`

## 1. 当前状态

PureTwitter 是一个专门清理 Twitter / X 垃圾内容的 Chrome / Edge 扩展。

公开商店资料显示：

- Chrome Web Store 用户量约 3,000
- 评分约 4.5 / 5
- 30 个评分
- 当前版本：2.1.0
- Chrome Web Store 最后更新时间：2026-01-05
- 大小约 404 KiB
- 支持约 16 种语言

历史公开版本至少包括：

```text
1.0.x     2023
1.3.2     2024-06
2.0.0     2025-04
2.1.0     2026-01
```

因此更准确的判断不是“已经完全停更”，而是：

> **仍然在线，也在更新，但维护频率比较低。**

截至 2026 年 8 月，距离最后一次公开商店更新大约 7 个多月。

## 2. 最早的产品定位

作者 2023 年公开介绍时的核心功能非常直接：

- 自定义关键词
- 获取公共垃圾 / 黄推账号黑名单
- 一键屏蔽账号
- Chrome / Edge 浏览器扩展

它解决的是一个非常具体的问题：热门推文评论区被色情引流、诈骗和机器人账号污染。

这个产品定位已经验证了：

> **在 X 原生网页上做浏览器清理层，是成立的。**

## 3. PureTwitter 已经走过的路线

概念上可以概括为：

```text
Keyword Dictionary
+
Public Account Blacklist
+
Browser Extension
+
One-click Native Blocking
```

和 FeedSieve 最早的想法非常接近。

这意味着 FeedSieve 不应该只做一个“更漂亮的 PureTwitter”，而需要解决 PureTwitter 没有充分解决的下一层问题。

## 4. 用户评论里出现过的关键需求

PureTwitter 的历史用户评论非常值得 FeedSieve 研究。

### 4.1 社区共创阈值

有用户已经提出：

```text
收集用户手动屏蔽的账号
        ↓
达到一定人数阈值
        ↓
同步到社区黑名单
        ↓
其他用户直接受益
```

这与 FeedSieve 当前设计的 Community Filter Network 高度一致。

FeedSieve 的改进是不能停在简单的 `5 人 -> 全局拉黑`，而要增加：

- Candidate / Recommended / Strong
- Reporter Trust
- Rescue Vote
- Burst / Sybil Penalty
- Score Decay
- Appeal / Removal

### 4.2 关键词误杀

历史评论集中反馈过：

- 关键词过宽
- 不同语言容易产生误杀
- 日语简介容易被错误判断
- 色情内容与色情诈骗不能简单视为同一类

FeedSieve 应吸取的结论：

> **Keyword 只能是第一层确定性规则，不能成为整个判断系统。**

后续需要：

- Account Reputation
- Content Fingerprint
- Domain Reputation
- Campaign Reputation
- Optional AI

### 4.3 可维护规则源

用户提出过希望由“简单 source list”持续维护规则，而不是把大量关键词写死在插件里。

FeedSieve 当前 YAML / JSON 双格式正是对这个需求的进一步实现：

```text
Human-maintained YAML
       ↓
GitHub Review / Diff / Fork
       ↓
CI Validation
       ↓
Runtime JSON
       ↓
Extension Local Cache
```

### 4.4 白名单必须覆盖社区判断

有用户反馈：加入白名单后，仍然受到某些视觉标记影响。

FeedSieve 从架构上应该明确：

```text
Personal Allowlist
    > Personal Blocklist
    > Local Rules
    > Community
    > AI
```

用户自己的显式决定始终拥有最高优先级。

### 4.5 UI 不应该污染 X

有用户认为 PureTwitter 的屏蔽按钮影响页面美观，希望鼠标经过时才出现。

FeedSieve 应坚持：

- Inline Action 默认极简
- Hover 时出现额外操作
- 不改变 X 原生信息密度
- 被过滤内容使用小型 Placeholder

### 4.6 屏蔽同时举报

有用户希望“一键屏蔽时同时举报”。

FeedSieve 可以把这个需求拆清楚：

```text
抬走
├── Local Hide
├── Optional Community Report
└── Optional X Native Action
```

X 原生 Report 属于更敏感的动作，后续如果实现，应要求用户明确确认，而不是默认自动提交。

### 4.7 启发式特征

历史用户还提出过类似：

- 特定账号标识
- 经常引用自己的图片推文
- 特定回复行为

说明纯文本关键词之外，用户很自然地会观察“行为模式”。

FeedSieve 后续可以将启发式特征作为 `Heuristic Signals`，但需要：

- 可解释
- 可开关
- 不单独决定永久社区黑名单

## 5. PureTwitter 的更新节奏

从公开版本历史看，PureTwitter 并非彻底停止维护，但版本间隔明显偏长。

这对 FeedSieve 是一个重要提醒：

> **X Browser Extension 最难的不是写出第一版，而是持续跟进 X DOM 改版。**

因此 FeedSieve 必须把：

```text
X Reader
X Locator
X Native Actions
```

放到独立 `x-adapter` 包里，并建立 Fixture / Smoke Test。

长期维护能力本身就是产品竞争力。

## 6. 可以从公开权限看出的架构信号

公开扩展分析显示 PureTwitter 当前要求：

- `storage`
- `tabs`
- `x.com` host permission
- `puretwitter.ikeyly.cn` host permission

它的产品介绍同时包含“获取公共黑名单”。

因此可以合理推断，它至少存在“浏览器插件 + 远程公共名单服务”这一类架构。

但由于没有找到明确公开的 PureTwitter 源码仓库，不能仅凭权限断言它当前 2.1.0 的具体接口、评分逻辑或 Native Block 实现方式。

FeedSieve 与它最大的区别应该是：

> **不只使用公共名单，还把公共名单本身、名单格式、生成逻辑、治理规则和后端代码全部公开。**

## 7. 关于 Browser-native Actions

PureTwitter 的原始产品就包含“一键屏蔽”。

同时，其开发者网站下的其他 Twitter 管理扩展公开说明：操作直接利用浏览器中已经登录的 Twitter Session，不需要 Twitter API Access。

这进一步验证 FeedSieve 当前方案：

```text
User logged into x.com
       ↓
Browser Extension
       ↓
Real X DOM Controls
       ↓
Block / Mute / Other Action
```

FeedSieve 不需要把 X OAuth 作为这条链路的核心设计。

详细方案见 [`../X_ACTION_ADAPTER.md`](../X_ACTION_ADAPTER.md)。

## 8. PureTwitter 做得好的地方

### 聚焦痛点

产品一开始只解决“评论区垃圾账号”问题，价值非常直接。

### 低学习成本

用户继续使用 X 原生网站，不需要换客户端。

### 关键词 + 公共名单

在 2023 年已经采用混合过滤思路，而不是只做一个关键词插件。

### 一键原生操作

“发现垃圾 -> 一键处理”非常符合浏览器插件形态。

### 多语言

支持多语言说明它已经考虑到跨语言用户群。

## 9. PureTwitter 留给 FeedSieve 的机会

FeedSieve 可以把它没有充分完成的部分系统化：

| PureTwitter 思路 | FeedSieve 升级 |
| --- | --- |
| Public blacklist | Open Reputation Graph |
| Keyword dictionary | Local Rules + Fingerprints + Domain + AI |
| 一键屏蔽 | Local Hide + Native Action Adapter |
| 公共名单 | YAML Source + JSON Runtime + Git Audit |
| 黑名单成员 | Candidate / Recommended / Strong |
| 用户反馈 | Report + Rescue + Appeal |
| 服务端名单 | Open-source Community Backend |
| 单一列表 | Filter Pack Ecosystem |
| 账号级过滤 | Account + Fingerprint + Domain + Campaign |

## 10. FeedSieve 最重要的差异化

FeedSieve 不应该把自己描述成：

> 一个新的 PureTwitter。

更好的定位：

> **PureTwitter 证明“X 垃圾清理插件”这个需求存在；FeedSieve 要把这件事升级成一个公开、透明、社区共创、可 Fork 的互联网过滤基础设施。**

最终产品组合：

```text
Open Filter Engine
+
Open Community Reputation
+
Open YAML / JSON Lists
+
Filter Pack Ecosystem
+
Browser-native X Actions
+
Optional AI
```

## Sources

- Chrome Web Store — PureTwitter
  - https://chromewebstore.google.com/detail/puretwitter/nflidllhiamnebgbgoemadhhfdpbbpbi
- V2EX — PureTwitter -- 一键屏蔽黄推
  - https://www.v2ex.com/t/958849
- 小众软件论坛 — PureTwitter -- 一键屏蔽黄推
  - https://meta.appinn.net/t/topic/45813
- Chrome-Stats — PureTwitter metadata / version history
  - https://chrome-stats.com/d/nflidllhiamnebgbgoemadhhfdpbbpbi
- Developer website — browser-session Twitter tooling
  - https://taskease.info/DeleteTweetsFeatures/Advanced-Tweet-Deletion-Filters

Research date: 2026-08-26
