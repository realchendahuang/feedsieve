# Community Filtering

## 核心想法

FeedSieve 不应该只是每个用户各自维护一套关键词和黑名单。

更有价值的方向，是把用户每天主动“抬走”的垃圾账号沉淀为一个 **Community Filter Network**：

> **一个人发现垃圾，所有人都可以少看一次。**

用户越多，垃圾账号样本越多；样本越多，社区过滤清单越准确；过滤效果越好，产品越有价值。

这会形成 FeedSieve 最重要的网络效应。

---

## 用户侧交互

在 X 的推文或账号旁增加一个极简操作：

- `抬走这个账号`
- `这条还能抢救`
- `自己人，别开枪`

当用户点击“抬走这个账号”时，可以选择一个原因：

- Bot / 自动化刷屏
- Copy-paste / 复制怪
- AI slop / 低质量 AI 灌水
- 广告 / 营销
- 色情 / 灰产引流
- Scam / 钓鱼 / 诈骗
- Engagement bait / 互动钓鱼
- 其他

默认只提交用户明确触发的操作，不上传完整浏览历史。

---

## 不建议只用“5 个人屏蔽”作为最终规则

`5 个用户屏蔽 -> 自动进入全局黑名单` 很适合冷启动验证，但长期存在明显风险：

- 恶意刷票
- 小号批量举报
- 群体围攻 / brigading
- 竞争对手恶意举报
- 有争议但并非垃圾的正常账号被误伤

因此“5 人”更适合作为 **候选池门槛**，而不是永久自动封禁门槛。

推荐状态：

```text
0 - 4 个独立有效报告
    -> 普通账号

>= 5 个独立有效报告
    -> Candidate / 社区候选

可信度达到阈值
    -> Recommended Filter / 推荐过滤

高可信度 + 大量独立报告
    -> Strong Filter / 强过滤
```

用户可以选择：

- 保守：只过滤 Strong Filter
- 默认：过滤 Recommended + Strong
- 激进：Candidate 也折叠

---

## Community Score

最终判断不应该只看举报数量，而应该形成一个社区可信度分数。

建议输入信号：

### 正向信号

- 独立举报用户数量
- 举报者自身 Trust Score
- 多个不同时间段出现相同判断
- 多个不同地区 / 独立安装来源的判断
- 举报原因的一致性
- 是否存在多个公开垃圾样本

### 负向信号

- 用户点击“这条还能抢救”
- 用户主动加入白名单
- 大量举报集中在极短时间
- 新安装设备短时间大量举报
- 多个举报来源高度相关
- 举报原因主要是观点、立场或个人喜好

概念上可以理解为：

```text
Community Score
= Weighted Reports
- Weighted Rescue Votes
- Sybil / Burst Penalty
```

第一版不需要复杂机器学习，简单可解释的评分模型就够了。

---

## Reporter Trust

每个参与共创的安装实例维护一个匿名 Trust Score。

可以参考：

- 安装时间越长，权重逐步提高
- 历史举报和社区最终判断一致，权重提高
- 经常举报后被大量恢复，权重下降
- 短时间疯狂举报大量账号，权重下降
- 一个设备对同一个账号只能贡献一次有效票

为了隐私，扩展可以本地生成匿名密钥对 / installation id，不需要一开始就要求用户注册账号。

后续如果需要更强的防刷票能力，可以再加入可选登录。

---

## Community Filter Packs

不建议把所有东西塞进一个“全球总黑名单”。

更好的产品形态是多个可订阅 Filter Pack：

- Bot Spam
- Crypto Scam
- Adult / Gray Traffic
- AI Slop
- Engagement Bait
- Copy-paste Replies

用户可以自由订阅。

这样可以降低“一个全球标准替所有人做决定”的风险，也更符合 FeedSieve 的原则：

> **Hide garbage, not opinions.**

政治观点、兴趣偏好、语言偏好等高度主观内容，应优先留在用户自己的 Personal Rules，而不是进入默认社区黑名单。

---

## 一键屏蔽应该分成两层

### 1. FeedSieve Local Block — 默认方案

用户点击：

> **一键启用社区清单**

FeedSieve 下载社区过滤清单，在浏览器本地匹配账号并隐藏对应内容。

优点：

- 不需要逐个调用 X 接口
- 速度快
- 免费
- 可随时撤销
- 不修改用户 X 账号本身的 Block List
- 不依赖 X API 的写权限

这是 MVP 最推荐的实现。

### 2. Sync to X — 可选高级能力

以后可以考虑：

- 同步到 X Mute List
- 同步到 X Block List

但这属于独立能力，不能成为 FeedSieve 核心过滤链路的依赖。

---

## 最小后端

社区共创需要一个非常轻量的服务端。

建议第一版：

```text
Browser Extension
       |
       | explicit report only
       v
FeedSieve API
       |
       +---- reports
       +---- accounts
       +---- reporter trust
       +---- community scores
       |
       v
Versioned Filter Snapshot
       |
       v
Browser Extension local cache
```

可以使用 Cloudflare Workers + D1/KV，或者任何简单的 Serverless + SQL 方案。

建议最少数据表：

```text
accounts
- id
- x_user_id / handle
- first_seen_at
- community_score
- status

reporters
- installation_id
- trust_score
- created_at

reports
- reporter_id
- account_id
- reason
- evidence_post_id (optional)
- created_at

list_entries
- account_id
- category
- score
- status
- updated_at
```

---

## 隐私原则

默认只上传用户主动贡献的过滤信号。

不要默认上传：

- 用户完整浏览记录
- 所有看过的推文
- 私信
- Cookie
- X 登录凭证

社区报告建议只包含：

```text
目标账号 + 分类原因 + 时间 + 匿名报告者 ID + 可选公开 Post ID
```

---

## 网络效应

FeedSieve 最有意思的增长飞轮不是 AI，而是社区信号：

```text
更多用户
   ↓
更多人发现垃圾账号
   ↓
社区过滤清单更准确
   ↓
新用户安装后立即获得价值
   ↓
过滤效果更好
   ↓
更多用户
```

最终 FeedSieve 可以形成一种“垃圾账号信誉层”。

它不决定谁是好人，也不判断观点正确与否，只回答一个更简单的问题：

> **这个账号是不是正在以大量用户都认为低价值的方式消耗注意力？**
