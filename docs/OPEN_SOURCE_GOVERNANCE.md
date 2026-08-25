# FeedSieve Open Source & Governance

FeedSieve 不只开源浏览器插件代码。

项目希望做到：

> **Open Code + Open Rules + Open Lists + Open Governance**

也就是：前端开源、后端开源、过滤规则开源、社区名单公开、评分逻辑公开、名单变更可追踪。

透明不是附加功能，而是 FeedSieve 与传统平台黑箱审核机制的重要区别。

## 1. 开源范围

计划公开：

- Browser Extension
- Filter Engine
- X Adapter
- Community API
- Community Score 算法
- Reporter Trust 算法
- Filter Pack 定义
- JSON 社区过滤名单
- JSON Schema
- 生成名单的脚本
- CI 校验规则
- 名单变更记录

原则上，任何会影响“为什么某个账号被过滤”的核心逻辑，都应该能被社区查看和讨论。

## 2. 公开名单不是一个神秘黑盒

不建议只发布：

```json
[
  "@spam1",
  "@spam2"
]
```

更推荐发布带元数据的版本化快照：

```json
{
  "schema_version": 1,
  "list_version": "2026.08.26.1",
  "generated_at": "2026-08-26T00:00:00Z",
  "entries": [
    {
      "x_user_id": "123456789",
      "handle": "example_spam",
      "category": "bot_spam",
      "status": "recommended",
      "community_score": 0.91,
      "report_count": 27,
      "rescue_count": 2,
      "first_seen_at": "2026-08-20T12:00:00Z",
      "updated_at": "2026-08-26T00:00:00Z",
      "evidence_post_ids": ["0000000000000000000"]
    }
  ]
}
```

这样任何人都能回答：

- 这个账号为什么在名单里？
- 属于哪一类垃圾？
- 有多少有效报告？
- 有多少人认为是误判？
- 分数是多少？
- 什么时候进入名单？
- 最近什么时候更新？

## 3. 使用 X User ID 作为稳定主键

Handle 可以修改。

因此社区名单应该优先使用稳定的 `x_user_id` 作为主键，同时保留当前 `handle` 方便人类查看。

不要只依赖 `@handle`。

## 4. 建议的公开目录

```text
community/
├── README.md
├── lists/
│   ├── recommended.json
│   ├── strong.json
│   └── packs/
│       ├── bot-spam.json
│       ├── ai-slop.json
│       ├── crypto-scam.json
│       └── adult-spam.json
├── schema/
│   └── account-list.schema.json
└── changelog/
    └── YYYY-MM-DD.json
```

第一版可以只维护 `recommended.json`，以后再拆分。

## 5. 公开什么，不公开什么

### 应该公开

- 聚合后的账号名单
- 分类
- Community Score
- 有效报告数量
- Rescue 数量
- 公开证据 Post ID（可选）
- 算法
- 阈值
- 版本记录
- 加入 / 移除原因

### 不应该公开

- 用户真实身份
- IP 地址
- Cookie
- X 登录凭证
- 完整浏览历史
- 私信
- 原始匿名设备标识
- 可以反推出举报者身份的敏感数据

透明针对的是 **过滤决策**，不是举报者隐私。

## 6. 名单最好由程序生成

长期不建议管理员直接手工编辑最终 JSON。

推荐流程：

```text
Community Reports
      ↓
Open Scoring Algorithm
      ↓
Candidate Set
      ↓
Validation / Safeguards
      ↓
Generated JSON Snapshot
      ↓
Git Commit / Release
      ↓
Extension downloads snapshot
```

最终 JSON 是构建产物，原始社区信号和算法才是名单产生的来源。

## 7. Git 本身就是审计日志

把社区快照放在 GitHub 有天然优势：

- 每一次变化都有 diff
- 谁修改了什么可以追踪
- 可以通过 Issue / PR 讨论误判
- 可以 Fork
- 可以建立第三方 Filter Pack
- 社区可以独立审计

未来还可以给每个名单版本生成 SHA-256 checksum / signature，扩展只加载通过校验的快照。

## 8. Appeal / Rescue 必须是一等公民

FeedSieve 不应该只有“加入黑名单”。

同样重要的是：

- Rescue Vote
- Whitelist
- Appeal
- Removal
- Score decay

如果一个账号后来改变行为，或者社区发现误判，它应该可以离开名单。

名单不是永久刑罚。

## 9. 不把观点变成垃圾标签

社区默认 Filter Packs 应优先处理相对客观的模式：

- Bot spam
- Scam / phishing
- Adult / gray traffic spam
- Copy-paste spam
- AI slop
- Engagement bait

政治立场、价值观、兴趣领域、语言偏好等高度主观内容，不应进入默认全球名单。

这些更适合 Personal Rules 或用户主动订阅的第三方 Filter Pack。

## 10. FeedSieve 的治理目标

FeedSieve 不需要成为“互联网法官”。

它只需要把过滤过程做到：

- 用户可控
- 算法可解释
- 数据可审计
- 规则可 Fork
- 决策可恢复
- 代码可复现

一句话：

> **连黑名单本身都应该晒在阳光下。**
