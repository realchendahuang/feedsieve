<p align="center">
  <img src="assets/brand/avatar-hires.png" width="100" alt="福滤娃 FeedSieve" />
</p>

<h1 align="center">福滤娃 FeedSieve</h1>

<p align="center">
  <strong>用了福滤娃，评论区不骚了，好帖也不漏了。</strong><br>
  开源的中文 X（Twitter）刷推副驾驶：黄推一眼标出、一键原生拉黑；正在火的帖子、值得研究的博主，一眼看清。
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/feedsieve/amhdjglnonjaoenddnifpnljgmocfdph"><img src="https://img.shields.io/chrome-web-store/v/amhdjglnonjaoenddnifpnljgmocfdph?logo=googlechrome&logoColor=white&label=Chrome%20Web%20Store" alt="Chrome Web Store 版本" /></a>
  <a href="https://chromewebstore.google.com/detail/feedsieve/amhdjglnonjaoenddnifpnljgmocfdph"><img src="https://img.shields.io/chrome-web-store/users/amhdjglnonjaoenddnifpnljgmocfdph?label=users" alt="商店用户数" /></a>
  <a href="https://github.com/realchendahuang/feedsieve/stargazers"><img src="https://img.shields.io/github/stars/realchendahuang/feedsieve?logo=github&color=gold" alt="GitHub Stars" /></a>
  <a href="https://github.com/realchendahuang/feedsieve/releases"><img src="https://img.shields.io/github/v/release/realchendahuang/feedsieve?logo=github" alt="最新 Release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/realchendahuang/feedsieve" alt="MIT License" /></a>
  <a href="https://github.com/realchendahuang/feedsieve/commits/main"><img src="https://img.shields.io/github/commit-activity/m/realchendahuang/feedsieve?label=commits" alt="提交活跃度" /></a>
  <a href="CONTRIBUTING.md"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen" alt="PRs welcome" /></a>
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/feedsieve/amhdjglnonjaoenddnifpnljgmocfdph"><strong>⬇️ Chrome 商店一键安装</strong></a>
  ·
  <a href="https://feedsieve.win"><strong>🌐 官网与公示</strong></a>
  ·
  <a href="https://feedsieve.win/guide">使用教程</a>
  ·
  <a href="https://feedsieve.win/lists/blacklist">黑名单公示</a>
  ·
  <a href="https://feedsieve.win/lists/keywords">开源词库</a>
  ·
  <a href="CHANGELOG.md">更新日志</a>
</p>

---

## 它能做什么

|            | 清干净                                          | 看得准                                                                                   | 挖得深                                                             |
| ---------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **解决**   | 评论区的黄推、引流号、水军                      | 刷了一晚上，不知道哪条正在火                                                             | 想研究一个博主，X 只给你按时间排的帖子                             |
| **做法**   | 黄框标出写明理由，点一下走 X 原生拉黑，全端同步 | 每条帖子显示每小时浏览数和作者量级；「热帖」汇总你刷到的火帖，「全站」汇总所有用户刷到的 | 打开任意博主主页：每条帖子是他中位数的几倍，哪种形式、哪个时段最好 |
| **在哪看** | 时间线上、弹窗「清理」                          | 推文右上角、弹窗 / 侧边栏「热帖」                                                        | 博主资料卡下、侧边栏「主页」                                       |

所有数据都来自你浏览时 X 已经加载给页面的内容。扩展**不替你滚动页面、不额外请求 X、不碰你的登录凭证**，详见下文「[数据从哪来](#数据从哪来)」。

---

## 清干净：只框不藏，拉黑交给你

中文 X 的评论区，黄推复读机、币圈引流怪、洗稿僵尸号比真人还勤快。常见的自救工具走两个极端：本地隐藏只骗得了这一个浏览器，手机上照样骑脸；黑盒拉黑脚本规则不公开、误杀没人知道，还会因为狂刷接口把你自己的号送进风控。

福滤娃的做法：

- **只框不藏**：命中的账号打黄框，写明理由（`命中黑名单: 3人标记`、`全角变形: 那一夜你没有拒绝我`），推文原样保留，要不要送走由你决定。
- **原生拉黑**：用你已登录的 X 会话调用原生 Block，手机、平板、电脑同步生效，对方再也不能回复、@、私信你。
- **不连累你的号**：批量拉黑每 24 小时最多 400 个，带随机间隔；X 一返回 429 就停下休眠。
- **误伤能救**：关注的人自动保护；拉错了在「已拉黑」里一键放回；社区抢救票能让误标账号全网解封。
- **规则公开**：[社区黑名单](https://feedsieve.win/lists/blacklist)、[开源词库](https://feedsieve.win/lists/keywords)、[推荐白名单](https://feedsieve.win/lists/whitelist)全部公示；名单快照带 Ed25519 签名，本地验签后才生效。

|              | 本地隐藏       | 黑盒拉黑脚本       | **福滤娃**                          |
| ------------ | -------------- | ------------------ | ----------------------------------- |
| 生效范围     | 只有这个浏览器 | 全端               | **全端**                            |
| 你看得到什么 | 内容直接消失   | 后台静默拉黑       | **黄框 + 理由，内容原样**           |
| 谁来决定     | 插件           | 插件               | **你点了才拉黑**                    |
| 误伤         | 不知道         | 申诉无门           | **一键放回 + 社区抢救**             |
| 账号安全     | 不调接口       | 并发狂刷，容易 429 | **400 个/天 + 随机间隔 + 限流熔断** |

---

## 看得准：哪条正在火，一眼可见

- **流速**：推文右上角显示当前每小时浏览数，`1K/h` 以上变红，`10K/h` 以上实心红。算法和 X 推荐系统的浏览衰减模型一致，见 [docs/03](docs/03-X推荐算法与指标设计.md)。
- **量级**：作者名旁显示素人 / 尾部 / 腰部 / 肩部 / 头部 / 顶流和粉丝数；悬停看关注比、注册时间、疑似互关号等提示。
- **热帖**：弹窗或侧边栏里汇总你最近 2 小时在所有 X 标签页刷到的火帖。
  - 可按热度、回复机会、粉丝数、收藏数、最近刷到排序。
  - 没在看的时候新帖直接插到顶部，正在看的时候只出提示条，列表不会在你手底下跳。
  - 可以隐藏单条帖子或某个作者，同一作者的多条自动合并，支持 j / k 键盘操作。
- **全站热榜**：汇总所有福滤娃用户刷到的火帖，至少 3 个人看到才上榜。只上报正在火的公开帖子指标，不带你的账号，可在设置里关闭。

---

## 挖得深：打开任意博主主页

X 的主页只按时间排帖子，想找一个博主最好的那几条，只能一直往下翻。福滤娃在博主资料卡下加一行概况，侧边栏「主页」给出完整分析：

- **爆款倍数**：每条帖子的浏览 ÷ 他自己帖子浏览的中位数。用中位数不用平均数，一两条大爆款不会把基线拉偏；3 倍以上标金色。博主主页上，主人自己的帖子右上角也会直接显示倍数。
- **爆款率与基线**：只算原创和引用、发出满 24 小时的帖子；刚发的帖子按预计 24 小时浏览估算，标 `~`。
- **疑似投流**：浏览很高、互动却远低于他平时的水平，单独标出，不算进爆款。
- **规律**：纯文字 / 图片 / 视频 / 引用各自的中位倍数；7 天 × 6 个时段的发帖热力图。
- **补数据**：一键在 X 搜他的高赞帖（`from:他 min_faves:N`，N 按他的中位点赞自动选）；或者用 Google 站内搜索他的帖子，按关键词和时间范围找。
- **带走**：复制 Top 20 爆款给 AI 分析钩子和结构；导出 CSV。

---

## 数据从哪来

同类工具拿数据的方式差别很大，这直接关系到你的 X 账号安不安全：

| 做法                          | 谁在用                          | 能看多少         | 对你账号的风险                 |
| ----------------------------- | ------------------------------- | ---------------- | ------------------------------ |
| 读页面已经加载的数据          | **福滤娃**、Polaris、X-Insights | 你看到多少算多少 | 无                             |
| 扩展自动滚动页面              | X Sort                          | 几百条           | 大号会触发验证码、限流         |
| 用你的登录会话直接请求 X 接口 | XOutlier、TweetDigger           | 一年甚至全部     | X 条款禁止爬取，风控算在你头上 |

福滤娃只做第一种：只读 X 已经给页面的数据，不替你滚动、不翻页、不额外请求 X。看到的帖子不够时，你可以点「在 X 搜高赞帖」，那是一次普通的 X 搜索，和你自己搜完全一样。

本地数据（热帖、博主主页帖子库）只存在你的浏览器里，可在设置里一键清空。会离开设备的只有：你明确拉黑 / 加白的账号（「名单上传」）和正在火的公开帖子指标（「全站热榜」），两者都能关；打开「仅本地运行」后什么都不上传。完整说明见 [`PRIVACY.md`](PRIVACY.md)。

---

## 上手

1. **装好就能用**：打开 `x.com` 正常刷，黄推自动打黄框，帖子右上角出现流速。
2. **顺手送走**：黄框右上角点「顺手拉黑」；攒多了打开弹窗「清理」一键批量。
3. **看热帖**：点扩展图标，或者打开侧边栏一直挂着，「热帖」会跟着你的浏览自动更新。
4. **研究博主**：打开他的主页往下滚一点，资料卡下出现概况；侧边栏「主页」看完整分析。

更多见 [网页版使用指南](https://feedsieve.win/guide)。

---

## 安装方式

| 安装途径                                  | 说明与步骤                                                                                                                                                            |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Chrome 应用商店（推荐）**               | 打开 [Chrome 商店页面](https://chromewebstore.google.com/detail/feedsieve/amhdjglnonjaoenddnifpnljgmocfdph) 点「添加至 Chrome」，自动接收更新                         |
| **Edge / Brave / Arc 等 Chromium 浏览器** | 同上，允许来自其他商店的扩展即可                                                                                                                                      |
| **GitHub Releases**                       | 从 [Releases](https://github.com/realchendahuang/feedsieve/releases) 下载 `feedsieve-*-chrome.zip` 解压 → `chrome://extensions` 打开开发者模式 → 加载已解压的扩展程序 |
| **从源码构建**                            | 见下方本地开发（Node ≥ 22、pnpm）                                                                                                                                     |

---

## 系统工作流程

```text
x.com 页面
  │
  ├── [MAIN World] XHR Bridge：只读 X 自己的 GraphQL 响应（不发请求、不改请求）
  │        │
  │        ▼
  │   [ISOLATED World] 严格消毒后分三路
  │        │
  │        ├─ 检测：社区签名黑名单 + 开源词库 + 模糊指纹
  │        │        → 自己、关注、白名单一票豁免 → 黄框 + 理由
  │        │        → 用户点击 → 拉黑队列（400/24h、随机间隔、429 熔断）→ X 原生 Block
  │        │
  │        ├─ 热度：流速与量级徽标 → 后台汇总所有 X 标签页（storage.session）
  │        │        → 弹窗 / 侧边栏「热帖」
  │        │        → 正在火的公开帖子指标 → 全站热榜（可关）
  │        │
  │        └─ 主页：打开过的博主各建一份本地帖子库（storage.local，可清空）
  │                 → 资料卡概况 + 帖子倍数 → 侧边栏「主页」
  │
  └── 扩展后台 ──> 官方 API：签名名单与词库下载、名单上传、全站热榜
```

---

## 本地开发与贡献

本项目采用 Monorepo 架构管理：

| 模块路径                   | 职责与技术栈                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------- |
| `apps/extension`           | 扩展本体：**WXT + React 19 + TypeScript**，Manifest V3；弹窗与侧边栏共用一套界面                        |
| `apps/community-api`       | 社区后端：**Cloudflare Workers + Hono + PostgreSQL（Drizzle + Hyperdrive）+ R2**，支持 Ed25519 签名分发 |
| `apps/admin`               | 维护后台：React + Tailwind，受 Cloudflare Access 身份断言保护                                           |
| `packages/detector`        | 独立检测器纯逻辑与金标测试语料库（Golden Corpus）                                                       |
| `packages/block-queue`     | 具备自适应退避与熔断特性的拉黑队列状态机                                                                |
| `packages/x-adapter`       | X 页面 DOM/网络读取与原生动作适配层                                                                     |
| `packages/metrics`         | 流速、量级、热度分、爆款倍数与博主基线等指标的纯函数                                                    |
| `packages/community-lists` | 共享的社区名单序列化、解析与 Ed25519 验签契约                                                           |
| `community/`               | 规范的 YAML 名单源文件、Schema 与每日镜像快照                                                           |

### 常用命令

```sh
git clone https://github.com/realchendahuang/feedsieve.git
cd feedsieve
pnpm install
git config core.hooksPath .githooks     # 启用本地 pre-push 质量门禁

pnpm verify                   # 执行全量质量门禁（Lint + Typecheck + 全量单测 + 扩展构建）
pnpm build:extension          # 编译扩展，产物位于 apps/extension/.output/chrome-mv3
pnpm keyword-packs:build      # 由公开 YAML 词库构建签名官方词库 JSON
```

贡献准则见 [`CONTRIBUTING.md`](CONTRIBUTING.md)；设计文档在 [`docs/`](docs/README.md)。

---

## Star History

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=realchendahuang/feedsieve&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=realchendahuang/feedsieve&type=Date" />
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=realchendahuang/feedsieve&type=Date" />
  </picture>
</p>

---

## 开源许可

本项目依据 [MIT License](LICENSE) 开源。

### 开源范围

- **开源**：浏览器扩展、检测器、拉黑队列、X 适配层、社区 API、名单评分算法、名单 Schema、公开名单与词库、生成脚本。
- **闭源**：小刷子周刊（作者的另一款产品，独立仓库、独立服务）。它不依赖本仓库代码，也不接触本仓库的用户数据。
- **商标不在许可范围内**：FeedSieve、福滤娃、小刷子周刊 的名称与图标归作者所有。fork 可以改代码，但上架商店时请换名称与图标——商店要求唯一名称，也避免用户混淆。

### 开源不等于没有门禁

只接受 PR；名单改动必须过 Schema 校验与净票阈值；商店包由维护者本机签名发布，PR 不打包。
