# Community Filtering

## 1. 核心想法

FeedSieve 不应该只是每个用户各自维护一套关键词和黑名单。

更有价值的方向，是把用户每天主动拉黑的垃圾账号沉淀为一个 **Community Network**：

> **一个人发现垃圾，所有人都可以少看一次。**

用户越多，垃圾账号样本越多；样本越多，社区过滤清单越准确；过滤效果越好，产品越有价值。

这会形成 FeedSieve 最重要的网络效应。

---

## 2. 用户侧交互

在 X 推文 / 账号旁提供极简动作：

- `标记垃圾并拉黑`（原生 Block；插件漏识别时也可用）
- `放回来`（原生 Unblock）
- `这条还能抢救`（Community Rescue Vote）

用户主动标记成功后，按「名单上传」设置决定是否把这次判断贡献给社区。从现有社区名单执行批量拉黑不会再次生成举报票，避免反馈回路自我放大。

推荐原因：

- `bot_spam`
- `copy_paste`
- `ai_slop`
- `advertising`
- `adult_gray_traffic`
- `scam_phishing`
- `engagement_bait`
- `other`

默认只上传用户明确触发的贡献，不上传完整浏览历史。

---

## 3. 分级门槛与批量安全线

`5 个用户屏蔽 -> 自动永久进入全球黑名单` 风险太大：

- 恶意刷票
- 小号批量举报
- brigading
- 竞争对手恶意举报
- 争议账号被当垃圾号

因此状态分层：

```text
0 - 1 independent reports
    -> normal

>= 2 independent reports
    -> candidate

>= 3 independent reports
    -> strong
```

Candidate 只在「彻底」档供复核。云端和页面批量拉黑的过渡门槛统一为：`strong + report_count >= 3 + rescue_count = 0`。任何抢救票都会让账号退出批量候选。

具体阈值不硬编码在后端，公开在：

[`../community/policy/v1.yaml`](../community/policy/v1.yaml)

用户标注强度：

- 清爽：仅 Strong 名单命中标注
- 标准：Strong + Recommended 标注
- 大扫除：Strong + Recommended + Candidate 标注

---

## 4. Community Score

第一版使用可解释算法：

```text
effective score
= weighted reports
- weighted rescues
+ consistency bonus
+ temporal spread bonus
- burst penalty
- abuse penalty
```

输入建议：

### 正向

- 独立有效 Report 数
- Reporter Trust
- 原因一致性
- 多个日期持续出现
- 可选公开 evidence post id

### 负向

- Rescue
- 短时间集中举报
- 新 installation 异常大量举报
- 多个高度相关来源的机械行为
- 举报原因明显属于观点 / 立场冲突

第一版不需要 ML 黑盒。

---

## 5. Reporter Trust

每个参与共创的安装实例维护匿名 Trust Score。

v1 原则：

- 默认 trust = 1.0
- 一个 installation 对一个账号只能有一个当前有效 vote
- 长期和社区结果一致可缓慢提升
- 经常被 Rescue 推翻则下降
- 短时间疯狂举报则下降
- 设置公开 min / max

不要求第一天注册账号。

插件本地生成随机 installation id；后端只存 hash / opaque identity。

后续遇到严重 Sybil 问题再增强身份系统。

---

## 6. Rescue / Appeal

`放回来` 不等于 Rescue。

区别：

```text
放回来
-> 本地原生 Unblock，恢复误伤
-> 不上传社区

这条还能抢救
-> explicit Rescue Vote
-> 上传社区
```

社区必须同时支持：

- Report
- Rescue
- Appeal
- Removal
- 本地撤销（放回来）
- Score decay（后续）

名单不是永久刑罚。

用户自己的 X 关注列表是另一个概念：它是本地私有保护名单，不作为 Rescue，不上传服务端。只有用户之后明确把其中某个账号「标记垃圾并拉黑」，最新的人工判断才覆盖这层保护。

---

## 7. Community Filter Packs

不维护一个“宇宙总黑名单”。

官方可维护：

```text
Bot Spam
Copy-paste Replies
AI Slop
Crypto Scam
Adult / Gray Traffic Spam
Engagement Bait
```

用户自由订阅。

高度主观内容：

- 政治立场
- 价值观
- 兴趣领域
- 语言偏好

默认留在第三方可选 Pack。

核心原则：

> **Block garbage, not opinions.**

---

## 8. Account Identity：handle required, X User ID optional

浏览器插件从当前 X DOM 通常可以稳定获取 `@handle`，但不应该为了获取 stable X User ID 而强依赖 X OAuth / Developer API / 私有页面 runtime。

因此协议 v1：

```text
handle       required
x_user_id    optional
aliases      optional
```

示例：

```yaml
- handle: example_spam
  x_user_id: '123456789' # optional
  aliases:
    - old_handle
```

当未来可靠获得 stable ID 时，再把历史 handle 合并。

---

## 9. 名单命中标注 ≠ 批量 X Block

这是一个非常重要的产品边界。

### 默认：黄框标注

名单命中的账号：

```text
Community Snapshot
-> local index
-> Detector 黄框标注（带理由）
```

优点：

- 瞬时生效
- 零风险（不修改用户 X Block List）
- 不需要 X API
- 不需要 OAuth
- 平台页面结构临时变化时，Community 数据仍然存在

### 用户显式启动：批量拉黑

用户按下：

> **一键批量拉黑**

才通过 X Action Adapter 执行浏览器页面动作。

批量拉黑必须使用 Block Queue，详见：

[`X_ACTION_ADAPTER.md`](X_ACTION_ADAPTER.md)

---

## 10. YAML / JSON Open List

FeedSieve 名单不是后端黑箱。

```text
community/source/*.yaml
```

给人：

- Review
- Diff
- Fork
- Appeal

```text
community/lists/*.json
```

给 Extension：

- download
- validate
- cache
- local lookup

构建链：

```text
Community DB
  ↓
Open Scoring Policy
  ↓
YAML Snapshot
  ↓
Schema Validate
  ↓
Deterministic JSON
  ↓
manifest + checksum
```

---

## 11. 最小后端

推荐：

```text
Browser Extension
       |
       | explicit report / rescue only
       v
Cloudflare Worker + Hono
       |
       +---- accounts
       +---- aliases
       +---- reporters
       +---- votes
       +---- snapshots
       |
       v
D1
```

API：

```text
POST /v1/reports
POST /v1/rescues
GET  /v1/snapshots/latest
```

---

## 12. Snapshot 本地化

Timeline 滚动时不实时请求 Community API。

```text
startup / alarm
   ↓
manifest
   ↓
new version?
   ↓
JSON snapshot
   ↓
validate
   ↓
local index
   ↓
all-day local lookup
```

服务器失败时继续使用 last-known-good snapshot。

---

## 13. 隐私原则

默认只上传用户主动贡献的过滤信号。

不要上传：

- 用户完整浏览记录
- 所有看过的推文
- 私信
- Cookie
- X OAuth Token
- X 登录凭证

Report payload 建议只包含：

```text
handle
optional x_user_id
reason
optional evidence_post_id
anonymous installation id
time
client version
```

---

## 14. 长期不只是一张 Account List

Account 会换，垃圾模式可能继续存在。

长期 Community Entity：

```text
Account
Content Fingerprint
Domain
Campaign
```

网络效应最终应该从“垃圾账号黑名单”升级成“公开垃圾信誉图谱”。

---

## 15. 网络效应

```text
更多用户
   ↓
更多高质量 Report / Rescue
   ↓
信誉数据更准确
   ↓
Snapshot 更好
   ↓
新用户安装后直接受益
   ↓
产品价值更强
   ↓
更多用户
```

FeedSieve 不决定谁是好人，也不判断观点正确与否。

它只回答一个更窄的问题：

> **这个账号或内容模式，是否正在以大量用户都认为低价值的方式持续消耗注意力？**
