# PureTwitter Competitor Research

> Research target: Chrome extension `nflidllhiamnebgbgoemadhhfdpbbpbi`  
> Updated: 2026-08-26

## 1. 当前状态

PureTwitter 是一个专门清理 Twitter / X 垃圾内容的 Chrome 扩展。

公开商店资料显示：

- Chrome Web Store 用户量约 3,000
- 评分约 4.5 / 5
- 30 个评分
- 当前版本：2.1.0
- 最后更新时间：2026-01-05
- 大小约 404 KiB
- 支持约 16 种语言

因此更准确的判断是：

> **仍然在线，但维护频率偏低。**

截至 2026-08，距离公开商店最后更新约 7 个多月。

## 2. 产品定位

核心能力：

- 根据公共黑名单过滤账号
- 根据关键词 / dictionary 过滤内容
- 屏蔽色情、暴力、广告等内容
- 屏蔽 X 账号

早期公开介绍还明确强调：

- 自定义敏感关键词
- 获取公共垃圾 / 黄推账号
- 一键屏蔽账号

这证明 FeedSieve 选择“浏览器插件直接净化 X”是一个已有真实需求验证的方向。

## 3. 权限与实现信号

公开扩展元数据显示当前版本使用：

```text
permissions:
- storage
- tabs

host permissions:
- *://*.x.com/*
- *://puretwitter.ikeyly.cn/*
```

并在 X 页面注入 Content Script。

这与它的产品逻辑吻合：

- X 页面内识别 / 操作
- 远程服务提供公共名单或配置

没有必要把 FeedSieve 设计成一个传统 X OAuth 客户端。

## 4. 用户评论里最重要的需求

PureTwitter 的历史用户评论对 FeedSieve 非常有价值。

### 4.1 “关键词不够用了，应该收集大家手动屏蔽的账号”

有用户在 2023 年已经明确提出：

- 黄推越来越会绕关键词
- 应该收集用户手动屏蔽账号
- 设置阈值
- 同步给所有人的黑名单

这几乎就是 FeedSieve 的：

```text
Community Report
-> Candidate
-> Community Score
-> Recommended / Strong
```

因此 FeedSieve 的 Community Reputation 不是“凭空设计”，而是已经出现过的真实用户诉求。

### 4.2 用户希望有“可维护的规则源”

另一条评论明确认为单纯关键词不够现代，希望使用 source list / 规则列表持续维护。

这直接支持 FeedSieve：

```text
YAML public source
-> JSON runtime artifact
-> Filter Pack subscription
```

### 4.3 误杀是最大风险之一

用户评论里反复出现：

- 关键词太宽
- 日语账号容易误杀
- 普通账号被错误屏蔽
- 黑名单中出现用户认为正常的媒体 / 账号

因此 FeedSieve 必须从第一版就有：

```text
Personal Allowlist highest priority
Why / Explainability
Rescue
Community score
Open list
```

不能等产品做大再补“误判治理”。

### 4.4 UI 不应该污染 X

用户还反馈过：

- 屏蔽按钮影响美观
- 希望 hover 时才显示
- Dark Mode 对比度问题

FeedSieve Inline UI 应保持极简：

- 默认弱存在感
- hover / menu 中出现高频动作
- Light / Dark 都有 fixture / smoke test

## 5. PureTwitter 的优势

### 5.1 足够直接

它没有重新做一个 X 客户端，而是在用户已经使用的页面上解决问题。

这是对的。

### 5.2 关键词 + 名单两条腿

PureTwitter 很早就同时使用：

```text
content dictionary
+
account blacklist
```

说明单靠一种过滤维度不够。

### 5.3 低学习成本

用户安装插件后，不需要迁移客户端。

FeedSieve 应保持这个优点。

## 6. PureTwitter 的限制，也是 FeedSieve 的机会

### 6.1 黑名单缺少解释层

传统黑名单只有：

```text
in list / not in list
```

FeedSieve 应升级成：

```text
category
status
community_score
report_count
rescue_count
first_seen_at
updated_at
optional evidence
```

### 6.2 关键词规则容易误伤

FeedSieve 应逐步增加：

```text
exact phrase
regex
account reputation
content fingerprint
domain reputation
```

AI 最后再补语义判断。

### 6.3 缺少完整的社区治理模型

FeedSieve 要补：

```text
Report
Rescue
Reporter Trust
Candidate / Recommended / Strong
Appeal
Score decay
Open Policy
```

### 6.4 缺少 Filter Pack 生态

不应该所有用户共用一个宇宙总黑名单。

更好的结构：

```text
Official Bot Spam
Official Scam
Official AI Slop
Third-party Packs
Personal Rules
```

## 7. 对 FeedSieve v0.1 的直接启发

PureTwitter 已经告诉我们第一个版本最重要的不是 AI。

v0.1 应优先做好：

- X Reader Adapter
- Personal Account Block / Allow
- Keyword / Regex
- Inline Hide
- Why
- Restore
- 极简 UI
- 单账号 Browser-native Block

尤其要尽早加入 Allowlist，因为误杀是此类工具最容易破坏信任的问题。

## 8. 对 FeedSieve v0.2+ 的直接启发

真正超越 PureTwitter 的路线：

```text
PureTwitter Blacklist
        ↓
FeedSieve Open Reputation
        ↓
Community Score / Rescue / Trust
        ↓
YAML Open List
        ↓
Filter Packs
        ↓
Fingerprint / Domain / Campaign
```

FeedSieve 不应该只是“更漂亮、更开源的 PureTwitter”。

最终区别应该是：

> **PureTwitter 是净化插件。FeedSieve 试图把净化规则和信誉数据做成开放基础设施。**

## 9. Migration 机会

未来可以考虑 `Import from PureTwitter`。

如果 PureTwitter 的 Export 格式能够可靠识别，FeedSieve 可提供：

```text
导入个人账号名单
-> 转换为 Personal Blocklist
-> 不自动上传社区
```

这可以降低已有用户迁移成本。

在没有明确确认其导出格式之前，不应写死兼容实现。
