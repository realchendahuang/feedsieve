<p align="center">
  <img src="assets/brand/avatar.png" width="96" alt="FeedSieve avatar" />
</p>

# 福滤娃 FeedSieve

> **不信你看。看不见就对了。**

**FeedSieve / 福滤娃** 是一个专门清理 X（Twitter）垃圾账号的开源工具：高置信社区名单会在你已登录的 `x.com` 页面上用黄框提示；插件没认出的账号，你也可以随手点「标记垃圾并拉黑」。所有拉黑都由你明确触发，并真实写入 X 黑名单。

机器人刷屏、色情引流、广告轰炸、互动钓鱼、币圈老师——拉黑发生在 X 服务器上：**手机端同步消失，被拉黑的号再也无法回复你、@ 你、关注你。**

**X 赛博清洁工。看不到之前，先送走。**

## What is FeedSieve?

FeedSieve is an open-source X spam account cleaner. It surfaces high-confidence community matches on your logged-in `x.com` page, lets you manually mark anything it missed, and blocks only after your explicit click.

The technical rule is simple:

> **可见优先，拉黑唯一。Local detect. Community list. AI last. Native Block through the page.**

黄框标注永不隐藏内容；社区公开名单提供识别弹药；AI 只识别模糊案例；所有拉黑通过用户已登录页面的原生菜单完成，不依赖 X API。

## 为什么是「拉黑」而不是「隐藏」

| 方案         | 生效范围                 | 阻断互动                    |
| ------------ | ------------------------ | --------------------------- |
| 本地隐藏     | 只有装了插件的这个浏览器 | 不能                        |
| X 原生 Block | 全端（手机同步消失）     | 能（无法再回复 / @ / 关注） |

隐藏是自欺欺人，拉黑才是真清理。误伤也不用怕：**原生 Unblock 一键放回。**

## 产品怎么用

```text
刷 X
  ↓
高置信垃圾账号被黄框标注（理由使用人数与普通分类，不展示算法术语）
  ↓
标注账号进入「待拉黑列表」（Popup 可查看、可移除）
  ↓
按下「一键拉黑 N 个」
  ↓
逐个通过 X 原生菜单执行（成功即移除，失败如实保留）
  ↓
完成：已送走 N 个，手机端已同步
```

漏识别场景：推文操作栏或扩展面板输入账号，点「标记垃圾并拉黑」。误伤场景：一键「放回来」。设置里的「同步关注列表」会把你关注的账号保存为本地私有保护名单；它不会上传社区。

「设置 → 关键词规则」支持添加自己的词或短语；官方词库按黄推、投资诈骗、加密骗局、兼职刷单、贷款诈骗、博彩引流、互动诱导、通用营销引流分成 8 个行业包，首次安装与本次升级默认全部开启，分类开关直接显示在第一层。关闭的包完全不参与检测；点分类标题后仍可逐条移除或恢复。当前预置 778 条公开规则，其中“黄推 / 成人引流”扩充到 629 条；昵称、账号名、正文和简介都会参与匹配。完整短语会忽略插入的空格、标点和 emoji，“同城 + 上门”一类有序组合还允许中间插入少量文字。词库不随扩展版本冻结：仓库公开源文件经校验后发布到 Cloudflare R2，扩展打开 X 页面时、回到前台时及每 15 分钟检查更新，校验失败则保留上一次可信版本。命中只显示黄框；所有黄标都会进入当前页面的一键拉黑清单，但拉黑必须由用户主动点击，自定义词永远只保存在本机。词库的收录依据、发布方式和边界见 [`docs/research/KEYWORD_PRESETS.md`](docs/research/KEYWORD_PRESETS.md)。

## 安装

- Chrome Web Store：审核通过后补链接
- 开发者加载：`pnpm install && pnpm build:extension`，Chrome 载入 `apps/extension/.output/chrome-mv3`
- 隐私政策：[PRIVACY.md](PRIVACY.md) · 问题反馈：[Issues](https://github.com/realchendahuang/feedsieve/issues)

## 品牌定位

| 项目     | 定义                                                    |
| -------- | ------------------------------------------------------- |
| 中文名   | 福滤娃                                                  |
| English  | FeedSieve                                               |
| GitHub   | `feedsieve`                                             |
| 产品定位 | X 赛博清洁工                                            |
| 核心口号 | **不信你看。看不见就对了。**                            |
| 辅助口号 | **没有人比福滤娃更懂清理。**                            |
| 人设     | 常年混迹 X 垃圾区，什么黑话都懂，垃圾号刚开口就被它送走 |

## 产品形态与长期定位

第一阶段优先做 Chrome / Edge / Chromium 浏览器扩展，后续再支持 Firefox / Safari。

但浏览器插件只是产品外壳，真正长期维护的是独立 **Block Engine（Detector + Block Queue）**。

> **产品形态：浏览器插件。技术本体：Block Engine。第一战场：X。长期方向：用户自己的垃圾账号防御网络。**

详细定位见 [`docs/VISION.md`](docs/VISION.md)。

## 核心架构

```text
x.com
  │
  ├── X Reader Adapter ──> FeedItem
  │                           │
  │                           v
  │                      Safety Policy
  │                 ┌─────────┼─────────┐
  │                 │         │         │
  │          Community   Manual mark   Weak evidence
  │                 │
  │            黄框标注（带理由，不隐藏）
  │                 │
  │            待拉黑列表（持久，可增删）
  │                 │
  └── X Action Adapter <── Block Queue（用户按下「一键拉黑」）
                            │
                      原生 Block / Unblock
                      全端生效 + 阻断互动
```

### 判断来源分层

**Layer 1 — 用户明确动作**：用户主动「标记垃圾并拉黑」是最高质量判断；插件漏识别时也始终有入口。

**Layer 2 — 社区名单**：Strong / Recommended / Candidate 分级命中；只有 Strong、至少 3 个独立标记且没有抢救票的账号能进入批量候选。

**Layer 3 — 本地词库与弱证据复核**：用户自定义关键词和可逐条关闭的官方完整话术词库会给出人工确认黄框，永不进入批量动作、也不回灌社区。相似内容、可疑域名只在「彻底」档提示用户复核；未配置的算法关键词、默认昵称等单信号不直接给账号加黄框。

**本地保护层**：关注列表和个人白名单优先级最高，自动从页面清理与云端批量清理中排除。

### 分层原则

标注永远不隐藏内容；拉黑永远由用户显式触发。

## 一键批量拉黑怎么做

```text
用户按下「一键拉黑 N 个」
   ↓
逐个通过 X 原生菜单执行 Block
   ↓
成功即从待拉黑列表移除，失败如实保留
   ↓
完成：汇总回报（已拉黑 N 个 · 失败 M 个）
```

批量原生动作走持久化队列，绝不做 `for (...) click()`。详见 [`docs/X_ACTION_ADAPTER.md`](docs/X_ACTION_ADAPTER.md)。

## 开源的不只是代码

FeedSieve 希望做到：

> **Open Code + Open Rules + Open Lists + Open Governance**

公开范围包括：

- Browser Extension
- Block Engine（Detector + Block Queue）
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

[`community/lists/manifest.json`](community/lists/manifest.json) + [`community/lists/official.json`](community/lists/official.json)

用于：

- Extension 下载
- 本地缓存
- Schema 校验
- CDN / Release

更新入口：

[`community/lists/manifest.json`](community/lists/manifest.json)（由 `scripts/mirror-community-lists.sh` 从线上快照镜像）

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

### v0.1 — 能真正拉黑

- Chrome / Edge
- Home Timeline / Replies / Search 基础
- 黄框标注（内置名单 + 启发式，带理由）
- 待拉黑列表（持久、可增删）
- 一键批量拉黑（Block Queue）
- 单账号顺手拉黑
- 一键撤销（Unblock）
- 本地统计
- X DOM fixtures + Detector / Queue 单测

### v0.2 — Community Snapshot

- Manifest
- YAML / JSON List
- Local Community Index
- 标注强度（清爽 / 标准 / 大扫除）
- Block Pack 基础

### v0.3 — Community Contribution

- Report / Rescue API
- Community Score
- Reporter Trust
- Candidate / Recommended / Strong
- Open Snapshot pipeline

### v0.4 — 垃圾网络识别

- Content Fingerprint
- Domain Reputation
- Account / Fingerprint / Domain / Campaign

### v0.5 — Optional AI

最后再接 AI。

### v0.6 — 生态与增长

- 今日战报
- 分享卡片
- Third-party Block Pack
- Firefox / Safari
- 更多平台 Adapter

完整路线见 [`docs/ROADMAP.md`](docs/ROADMAP.md)。

## 福滤娃说人话

| 使用场景     | 文案                     |
| ------------ | ------------------------ |
| 检测标注     | 这个号味儿不对，框起来   |
| 黄框标签     | 疑似垃圾：名单命中       |
| 一键拉黑     | 送走 N 个                |
| 拉黑成功     | 已送走，全端清净         |
| 撤销误伤     | 拉错了？放回来           |
| 误判反馈     | 这条还能抢救             |
| 待拉黑列表空 | 今天的 X 居然挺像人      |
| 过滤统计     | 今日替你送走 38 个垃圾号 |

更多品牌语言见 [`docs/BRAND.md`](docs/BRAND.md)。

## 福滤娃今日战报

> **福滤娃今日战绩**
> 替你看了 428 条推文
> 标注垃圾号 45 个
> 送走机器人 31 个
> 请走色情引流 18 条
> 送走币圈老师 7 位
>
> **我的眼睛脏了，你的没有。**

增长循环：

**拉黑 → 统计 → 分享 → 新用户 → 社区信号 → 识别更准**

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

### 可见优先，拉黑唯一

插件永不隐藏内容。它只做两件事：认出垃圾（黄框），执行拉黑（队列）。

### Community is opt-in

只有用户主动贡献的识别信号才进入社区系统。上报内容仅限 handle / 分类 /
话术指纹哈希（原文不出设备）/ 外链域名，绝无浏览历史等被动数据。

### Explainable blocking

每个黄框都有理由，用户应该知道为什么这个号被标注。

### User controls the filter

福滤娃只负责标注，拉黑永远由用户按下按钮。

### Block garbage, not opinions

清理垃圾账号，而不是替用户决定观点正确与否。

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
