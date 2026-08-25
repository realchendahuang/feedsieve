# 福滤娃 FeedSieve

> **不信你看。看不见就对了。**

**FeedSieve / 福滤娃** 是一个专门清理 X（Twitter）垃圾信息的开源工具。

机器人刷屏、复制粘贴、色情引流、广告轰炸、互动钓鱼、低质量 AI 灌水和币圈老师，刚开口就被抬走。

你还没看见，它已经没了。

**X 赛博清洁工。**

## What is FeedSieve?

FeedSieve is an AI-powered X feed cleaner for bot spam, copy-paste replies, engagement bait and other things you were never supposed to see.

The product follows a simple rule:

> **Fast local filtering first. Community intelligence second. Optional AI judgment third.**

Obvious junk should never need a model call. AI is reserved for ambiguous content that rules and community signals cannot reliably classify.

## 为什么做它

X 的问题已经不只是“信息太多”，而是越来越多内容根本不值得进入你的注意力：

- 机器人批量刷屏
- 复制粘贴式回复
- Engagement bait / 互动钓鱼
- 色情与灰产引流
- 广告轰炸
- 低质量 AI 灌水
- 重复内容和模板化账号
- 你明确不想再看到的人、关键词和话术

FeedSieve 想做的事情很简单：

> **先把垃圾抬走，再把注意力还给你。**

## 品牌定位

| 项目 | 定义 |
| --- | --- |
| 中文名 | 福滤娃 |
| English | FeedSieve |
| GitHub | `feedsieve` |
| 产品定位 | X 赛博清洁工 |
| 核心口号 | **不信你看。看不见就对了。** |
| 辅助口号 | **没有人比福滤娃更懂过滤。** |
| 人设 | 常年混迹 X 垃圾区，什么黑话都懂，垃圾号刚开口就被它抬走 |

## 产品形态与长期定位

### 第一阶段：浏览器扩展

MVP 优先做 Chrome / Edge / Chromium 浏览器扩展，后续再支持 Firefox / Safari。

用户不需要更换 X 客户端。FeedSieve 直接作用于 Home Timeline、Replies、Search 等原生页面，在垃圾内容进入用户视野前完成折叠或隐藏。

但 **浏览器插件只是产品外壳，真正应该长期维护的是独立的 Filter Engine。**

> **产品形态：浏览器插件。技术本体：Filter Engine。第一战场：X。长期方向：用户自己的互联网注意力过滤层。**

长期来看，同一套过滤引擎可以适配其他信息流和评论区；但第一阶段对外只讲一件事：

> **福滤娃 FeedSieve：把 X 的垃圾抬走。**

详细定位见 [`docs/VISION.md`](docs/VISION.md)。

## 三层过滤体系

```text
X Page
  |
  v
Content Observer + Post Extractor
  |
  +------> Personal Allowlist
  |
  v
Layer 1: Local Rules
  |
  +------> confident spam -> Hide
  |
  v
Layer 2: Community Reputation
  |
  +------> community-listed account -> Hide / Collapse
  |
  v
Layer 3: Optional AI Classifier
  |
  v
Decision
  |
  +------> keep
  +------> collapse
  +------> hide
  |
  v
Local Stats + Feedback
```

### Layer 1 — Local Rules

优先在本地完成明显垃圾判断：

- 关键词 / 正则
- 重复文本
- 高重复回复模式
- 个人黑名单 / 白名单
- 常见营销模板
- 用户自定义规则
- 页面结构与行为特征

特点：**快、便宜、隐私友好。**

### Layer 2 — Community Filter Network

用户可以在 X 页面上一键“抬走这个账号”。

用户主动贡献的信号会进入社区过滤网络，形成共享账号信誉：

- 多个独立用户都屏蔽同一账号
- 举报原因高度一致
- 举报者本身具有可信度
- 误判恢复票会降低分数
- 短时间刷票和异常行为会被降权

社区清单默认用于 **FeedSieve 本地过滤**，用户可以一键订阅，不需要逐个操作 X Block List。

一个简单但重要的原则：

> **一个人发现垃圾，所有人都可以少看一次。**

详细设计见 [`docs/COMMUNITY_FILTERING.md`](docs/COMMUNITY_FILTERING.md)。

### Layer 3 — AI Classifier

对规则和社区信号难以判断的内容再交给 AI：

- 低质量 AI 灌水
- Engagement bait
- 广告软文
- 色情 / 灰产 / 社群引流
- 与用户偏好严重无关的内容
- 自然语言定义的过滤规则

特点：**更聪明，但不应该每条推文都调用模型。**

## MVP

### v0.1 — 先把个人过滤做对

- [ ] Chrome / Edge 扩展
- [ ] Home Timeline 过滤
- [ ] Replies 过滤
- [ ] 个人账号黑名单 / 白名单
- [ ] 关键词与正则过滤
- [ ] 重复回复识别
- [ ] 一键“抬走这个账号”
- [ ] “我偏要看”恢复入口
- [ ] 本地过滤统计
- [ ] 所有个人规则默认本地存储

### v0.2 — 社区共创

- [ ] Community Report API
- [ ] 社区候选账号池
- [ ] Community Score
- [ ] Reporter Trust
- [ ] Community Filter Packs
- [ ] 一键启用社区清单
- [ ] “这条还能抢救”反向反馈

### v0.3 — AI 会认

- [ ] 可选 AI 分类器
- [ ] 自然语言过滤规则
- [ ] OpenAI-compatible API
- [ ] 自定义模型与 Endpoint
- [ ] 更细粒度垃圾类型标签

### v0.4 — 会整活

- [ ] **福滤娃今日战报**
- [ ] 一键生成 X 分享卡片
- [ ] 垃圾类型统计
- [ ] 今日替你遭罪数量
- [ ] 可分享但不泄露原始推文内容

## 福滤娃说人话

| 使用场景 | 文案 |
| --- | --- |
| 开始检测 | 正在鉴定这条推文的成分 |
| 确认垃圾 | 这条味儿不对，抬走 |
| 隐藏成功 | 已滤，别看了 |
| 用户想恢复 | 你非看不可？ |
| 恢复按钮 | 我偏要看 |
| 加入白名单 | 自己人，别开枪 |
| 加入黑名单 | 下次见一次抬一次 |
| 误判反馈 | 这条还能抢救 |
| 今日无垃圾 | 今天的 X 居然挺像人 |
| 过滤统计 | 今日替你遭罪 38 条 |

更多品牌语言见 [`docs/BRAND.md`](docs/BRAND.md)。

## 福滤娃今日战报

FeedSieve 最值得做的传播功能之一，是让“过滤垃圾”本身变成分享素材。

> **福滤娃今日战绩**  
> 替你看了 428 条推文  
> 抬走机器人 31 个  
> 过滤复制怪 22 条  
> 请走色情引流 18 条  
> 送走币圈老师 7 位  
>
> **我的眼睛脏了，你的没有。**

增长循环：

**过滤 → 统计 → 生成梗图 → 发 X → 新用户安装 → 继续过滤**

## 推荐技术栈

首版建议保持轻量：

- **WXT**
- **TypeScript**
- **React**
- **WebExtension / Manifest V3**
- **Browser Storage**
- Optional FeedSieve Community API
- Optional OpenAI-compatible AI Adapter

详细设计见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

## 产品原则

### Local-first

能在本地判断的，不上传。

### Community is opt-in

只有用户主动贡献的过滤信号才进入社区系统；默认不上传完整浏览历史。

### AI is optional

没有 AI Key，FeedSieve 也应该能正常工作。

### Explainable filtering

用户应该知道一条内容为什么被隐藏。

### User controls the filter

福滤娃可以嘴损，但不能替用户永久做主。

### Hide garbage, not opinions

目标是过滤垃圾模式、机器人和用户主动定义的低价值内容，而不是替用户决定什么观点“正确”。

## Docs

- [`VISION.md`](docs/VISION.md) — 产品定位与长期方向
- [`PRODUCT.md`](docs/PRODUCT.md) — 产品说明
- [`ARCHITECTURE.md`](docs/ARCHITECTURE.md) — 技术架构
- [`COMMUNITY_FILTERING.md`](docs/COMMUNITY_FILTERING.md) — 社区过滤网络
- [`ROADMAP.md`](docs/ROADMAP.md) — Roadmap
- [`BRAND.md`](docs/BRAND.md) — 品牌语言

## Status

FeedSieve is currently in the **design / MVP stage**.

PRs, filter ideas, cursed X screenshots and better garbage-detection heuristics are welcome.

## License

MIT
