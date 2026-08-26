<p align="center">
  <img src="assets/brand/avatar.png" width="96" alt="FeedSieve avatar" />
</p>

# 福滤娃 FeedSieve

> **不信你看。看不见就对了。**

**FeedSieve / 福滤娃** 是一个专门清理 X（Twitter）垃圾信息的开源工具。

机器人刷屏、复制粘贴、色情引流、广告轰炸、互动钓鱼、低质量 AI 灌水和币圈老师，刚开口就被抬走。

你还没看见，它已经没了。

**X 赛博清洁工。**

## What is FeedSieve?

FeedSieve is an open-source X feed cleaner for bot spam, copy-paste replies, engagement bait and other things you were never supposed to see.

The technical rule is simple:

> **Local first. Community second. AI third. Browser-native actions when needed.**

明显垃圾先本地处理；社区已经认识的垃圾不需要再问模型；AI 只处理模糊情况；需要 X 原生 Block / Mute 时，浏览器插件直接辅助用户在当前已登录页面中完成。

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

第一阶段优先做 Chrome / Edge / Chromium 浏览器扩展，后续再支持 Firefox / Safari。

用户不需要换 X 客户端。FeedSieve 直接作用于 Home Timeline、Replies、Search 等原生页面，在垃圾内容进入视野前完成折叠或隐藏。

但浏览器插件只是产品外壳，真正长期维护的是独立 Filter Engine。

> **产品形态：浏览器插件。技术本体：Filter Engine。第一战场：X。长期方向：用户自己的互联网注意力过滤层。**

详细定位见 [`docs/VISION.md`](docs/VISION.md)。

## 核心架构

```text
x.com
  │
  ├── X Reader Adapter ──> FeedItem
  │                           │
  │                           v
  │                    Filter Engine
  │                ┌──────────┼──────────┐
  │                │          │          │
  │             Personal   Community   Optional AI
  │                │          │
  │                └──── Decision ──────┘
  │                           │
  │                  KEEP / COLLAPSE / HIDE
  │
  └── X Action Adapter ──> user-initiated Block / Mute
```

### Layer 0 — User Override

用户自己的明确选择优先级最高：

```text
Personal Allowlist
> Personal Blocklist
> Local Rules
> Community Reputation
> Optional AI
```

### Layer 1 — Local Rules

本地完成：

- Account Allow / Block
- Keyword
- Exact phrase
- Regex
- 后续 Domain
- 后续 Content Fingerprint

快、免费、离线可用。

### Layer 2 — Community Reputation

用户可以一键“抬走”垃圾账号，并选择匿名贡献给社区。

社区不是简单的 5 人永久黑名单：

```text
>= 5 independent reports -> Candidate
score + time spread       -> Recommended
higher trust + low rescue -> Strong
```

阈值公开在 [`community/policy/v1.yaml`](community/policy/v1.yaml)。

> **一个人发现垃圾，所有人都可以少看一次。**

详细设计见 [`docs/COMMUNITY_FILTERING.md`](docs/COMMUNITY_FILTERING.md)。

### Layer 3 — Optional AI

只处理前两层无法可靠判断的模糊内容：

- AI slop
- 软广告
- 隐蔽 engagement bait
- 自然语言个人过滤偏好

没有 AI Key，FeedSieve 也必须完整可用。

## X 原生 Block / Mute 怎么做

FeedSieve 是运行在用户已登录 `x.com` 页面里的浏览器插件。

因此默认路线不是 X OAuth / Developer API，而是：

> **Read the page. Filter locally. Act through the page.**

例如：

```text
用户点「抬走」
   ↓
FeedSieve Local Hide
   ↓
可选「顺手拉黑」
   ↓
X Action Adapter 打开 X 原生菜单
   ↓
Block
   ↓
确认页面结果
```

批量原生动作以后使用持久化 Native Action Queue，不做简单 for-loop。

详见 [`docs/X_ACTION_ADAPTER.md`](docs/X_ACTION_ADAPTER.md)。

## 开源的不只是代码

FeedSieve 希望做到：

> **Open Code + Open Rules + Open Lists + Open Governance**

公开范围包括：

- Browser Extension
- Filter Engine
- X Adapter
- Community Backend
- Community Score / Policy
- YAML Lists
- JSON Runtime Artifacts
- Schema
- Build Scripts
- Changelog

核心理念：

> **过滤权属于用户。**

> **连黑名单本身都应该晒在阳光下。**

## YAML for humans, JSON for machines

### YAML — 公开审计源

[`community/source/recommended.yaml`](community/source/recommended.yaml)

用于：

- GitHub 阅读
- PR Review
- Diff
- Fork
- Appeal / Governance

### JSON — Extension 运行产物

[`community/lists/recommended.json`](community/lists/recommended.json)

用于：

- Extension 下载
- 本地缓存
- Schema 校验
- CDN / Release

更新入口：

[`community/lists/manifest.json`](community/lists/manifest.json)

链路：

```text
Community Reports
      ↓
Open Scoring Policy
      ↓
YAML Snapshot
      ↓
Validate
      ↓
Deterministic JSON
      ↓
manifest + checksum
      ↓
Extension local cache
```

插件刷 X 时不会为每个账号实时请求服务器。

## Account Identity

浏览器插件通常能稳定获取 `@handle`，但不应该为了拿 stable X user id 强依赖 X API / 私有 runtime。

因此协议 v1：

```text
handle       required
x_user_id    optional
aliases      optional
```

Schema：[`community/schema/account-list.schema.json`](community/schema/account-list.schema.json)

## Roadmap

### v0.1 — 能真正用

- Chrome / Edge
- Home Timeline / Replies
- Account Allow / Block
- Keyword / Regex
- 抬走
- Hide / Collapse
- 我偏要看
- 为什么
- 本地统计
- 单账号「顺手拉黑」
- X DOM fixtures
- Filter Engine tests

### v0.2 — Community Snapshot

- Manifest
- YAML / JSON List
- Local Community Index
- Filter strength
- Filter Pack foundation

### v0.3 — Community Contribution

- Report / Rescue API
- Community Score
- Reporter Trust
- Candidate / Recommended / Strong
- Open Snapshot pipeline

### v0.4 — Native Action Queue

- Persistent queue
- Progress
- Pause / Resume / Cancel
- Incremental Native Sync

### v0.5 — Fingerprint / Domain

从“垃圾账号名单”升级成“垃圾网络识别”。

### v0.6 — Optional AI

最后再接 AI。

完整路线见 [`docs/ROADMAP.md`](docs/ROADMAP.md)。

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

> **福滤娃今日战绩**  
> 替你看了 428 条推文  
> 抬走机器人 31 个  
> 过滤复制怪 22 条  
> 请走色情引流 18 条  
> 送走币圈老师 7 位  
>
> **我的眼睛脏了，你的没有。**

增长循环：

**过滤 → 统计 → 分享 → 新用户 → 社区信号 → 过滤更准**

## 推荐技术栈

- **WXT**
- **TypeScript**
- **React**
- **Manifest V3**
- **Vitest**
- **Playwright**
- Browser Storage / IndexedDB
- **Cloudflare Workers + Hono + D1**（社区后端）
- Optional OpenAI-compatible AI Adapter

## 产品原则

### Local-first

能在本地判断的，不上传。

### Community is opt-in

只有用户主动贡献的过滤信号才进入社区系统。

### Explainable filtering

用户应该知道一条内容为什么被隐藏。

### User controls the filter

福滤娃可以嘴损，但不能替用户永久做主。

### Hide garbage, not opinions

过滤垃圾模式，而不是替用户决定观点正确与否。

## 开发从这里开始

如果准备正式实施，按这个顺序看：

1. [`TECHNICAL_SPEC.md`](docs/TECHNICAL_SPEC.md) — **主技术规范，开工基线**
2. [`IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) — 分阶段开发顺序与验收
3. [`ARCHITECTURE.md`](docs/ARCHITECTURE.md) — 架构边界
4. [`X_ACTION_ADAPTER.md`](docs/X_ACTION_ADAPTER.md) — 浏览器原生 X 操作
5. [`COMMUNITY_FILTERING.md`](docs/COMMUNITY_FILTERING.md) — 社区信誉
6. [`ROADMAP.md`](docs/ROADMAP.md) — 版本路线

## Research

- [`research/PURETWITTER.md`](docs/research/PURETWITTER.md)
- [`research/TWITTER_BLOCK_PORN.md`](docs/research/TWITTER_BLOCK_PORN.md)

## License

MIT
