<p align="center">
  <img src="assets/brand/avatar.png" width="96" alt="福滤娃 FeedSieve" />
</p>

<h1 align="center">福滤娃 FeedSieve</h1>

<p align="center">
  <strong>不信你看。看不见就对了。</strong><br>
  X（Twitter）赛博清洁工：高置信垃圾账号黄框标注，一键原生拉黑，全端同步消失。
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/feedsieve/amhdjglnonjaoenddnifpnljgmocfdph"><img src="https://img.shields.io/chrome-web-store/v/amhdjglnonjaoenddnifpnljgmocfdph?logo=googlechrome&logoColor=white&label=Chrome%20Web%20Store" alt="Chrome Web Store 版本" /></a>
  <a href="https://chromewebstore.google.com/detail/feedsieve/amhdjglnonjaoenddnifpnljgmocfdph"><img src="https://img.shields.io/chrome-web-store/users/amhdjglnonjaoenddnifpnljgmocfdph?label=users" alt="商店用户数" /></a>
  <a href="https://github.com/realchendahuang/feedsieve/releases"><img src="https://img.shields.io/github/v/release/realchendahuang/feedsieve?logo=github" alt="最新 Release" /></a>
  <a href="https://github.com/realchendahuang/feedsieve/stargazers"><img src="https://img.shields.io/github/stars/realchendahuang/feedsieve?logo=github" alt="GitHub Stars" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/realchendahuang/feedsieve" alt="MIT License" /></a>
  <a href="https://github.com/realchendahuang/feedsieve/commits/main"><img src="https://img.shields.io/github/commit-activity/m/realchendahuang/feedsieve?label=commits" alt="提交活跃度" /></a>
  <a href="CONTRIBUTING.md"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen" alt="PRs welcome" /></a>
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/feedsieve/amhdjglnonjaoenddnifpnljgmocfdph"><strong>⬇️ Chrome 应用商店安装</strong></a>
  ·
  <a href="#安装">本地构建</a>
  ·
  <a href="#使用教程">使用教程</a>
  ·
  <a href="CHANGELOG.md">更新日志</a>
  ·
  <a href="CONTRIBUTING.md">参与贡献</a>
  ·
  <a href="PRIVACY.md">隐私政策</a>
  ·
  <a href="https://feedsieve.win">官网</a>
</p>

<p align="center">
  <img src="assets/store/screenshot-1-marked.png" width="820" alt="FeedSieve 在时间线上用黄框标注垃圾账号" />
</p>

> [!TIP]
> **为什么是拉黑，而不是隐藏？** 本地隐藏只骗过你自己这一个浏览器；X 原生 Block 全端生效——手机同步消失，被拉黑的号再也无法回复你、@ 你、关注你。误伤也不怕，一键 Unblock 放回来。

## 这是什么

**FeedSieve / 福滤娃** 是一个开源的 X（Twitter）垃圾账号清理工具：高置信社区名单会在你已登录的 `x.com` 页面上用黄框提示；扩展没认出的账号，你可以随手点「标记垃圾并拉黑」。所有拉黑都由你明确触发，并真实写入 X 黑名单。

色情引流、机器人刷屏、广告轰炸、互动钓鱼，信号各不相同，处置只有一种：**写入 X 黑名单——手机端同步消失，被拉黑的号再也无法回复你、@ 你、关注你。**

| 方案 | 生效范围 | 阻断互动 |
| --- | --- | --- |
| 本地隐藏（多数同类工具） | 只有装了扩展的这个浏览器 | ❌ |
| **X 原生 Block（FeedSieve）** | 全端，手机同步消失 | ✅ 无法再回复 / @ / 关注 |

> **可见优先，拉黑唯一。Local detect. Community list. AI last. Native Block through the page.**

黄框标注永不隐藏内容；社区公开名单提供识别弹药；AI 只处理模糊案例；所有拉黑通过你已登录 X 会话的内部 Block 接口执行，无需 X Developer API / OAuth 应用。

## 安装

| 方式 | 步骤 |
| --- | --- |
| **Chrome 应用商店（推荐）** | 前往[商店页面](https://chromewebstore.google.com/detail/feedsieve/amhdjglnonjaoenddnifpnljgmocfdph)点「添加至 Chrome」，自动接收更新 |
| **GitHub Releases** | 从 [Releases](https://github.com/realchendahuang/feedsieve/releases) 下载 `feedsieve-*-chrome.zip` 并解压 → 打开 `chrome://extensions` 开启「开发者模式」→「加载已解压的扩展程序」 |
| **从源码构建** | `git clone https://github.com/realchendahuang/feedsieve.git && pnpm install && pnpm build:extension`，然后加载 `apps/extension/.output/chrome-mv3`（需要 Node ≥ 22 与 pnpm） |

其他 Chromium 浏览器（Edge / Brave 等）可用后两种方式加载。

## 使用教程

分步教程（含打野排位、设置项逐条、常见问题）见 [docs/USAGE.md](docs/USAGE.md)，或读[网页版教程](https://feedsieve.win/guide)。核心就四步：

1. **刷 X，看黄框** — 高置信垃圾账号被黄框标出，带判定理由，内容不隐藏。
2. **单个送走** — 黄框上点「顺手拉黑」，走你已登录 X 会话的内部 Block 接口，手机端同步消失。
3. **攒一批** — 黄标账号自动进待拉黑列表，点「一键拉黑 N 个」逐个执行；成功移除，失败如实保留原因。
4. **漏网的自己补** — 任意推文操作栏点「标记垃圾并拉黑」，你的动作就是最高质量的判断；误伤点「放回来」一键撤销。

进阶两件事：弹窗「打野」tab 看本周战报与榜单速览（完整周榜在[官网](https://feedsieve.win/leaderboard)，想露脸需认领档案并邮箱验证）；首次使用建议在设置里**同步关注列表**（存为本地保护名单）并按需开启词库包。

## 工作原理

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

- **Layer 1 — 用户明确动作**：主动「标记垃圾并拉黑」是最高质量判断；扩展漏识别时始终有入口。
- **Layer 2 — 社区名单**：公开名单命中即黄框；只有至少 3 个独立标记且没有抢救票的账号能进入批量候选。
- **Layer 3 — 本地词库与弱证据复核**：关键词命中给人工确认黄框，永不自动进入批量动作、也不回灌社区；相似内容、可疑域名只在「彻底」档提示复核。
- **本地保护层**：关注列表和个人白名单优先级最高，自动从一切清理中排除。

批量拉黑动作走持久化队列，绝不做 `for (...) click()`。架构边界见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)，X 原生操作见 [`docs/X_ACTION_ADAPTER.md`](docs/X_ACTION_ADAPTER.md)。

> [!WARNING]
> **批量拉黑请节制。** FeedSieve 走的是你已登录 X 会话的内部 Block 接口，和手动点屏蔽是同一条请求。X 不公布每日上限，但社区实测大约每天 400–500 个之后容易被强制登出或要求验证。扩展默认按 400/24h 自动停，剩余队列会留到你下次点继续。这不是永久封号，但连续硬打会把临时锁定拖长。大名单先入队，不要指望一个晚上跑完。策略细节见 [`docs/BLOCK_SAFETY.md`](docs/BLOCK_SAFETY.md)。

## 社区名单，晒在阳光下

> **Open Code + Open Rules + Open Lists + Open Governance**

- 每个安装对每个账号只有一张当前票，`净票数 = 拉黑票 − 误标票`，净票数达到 3 自动进入最终名单，低于 3 自动退出。
- 维护者通过受 Cloudflare Access 保护的 [React 管理后台](apps/admin)维护草稿、显式发布或回退条目。
- **YAML for humans, JSON for machines**：[`community/lists/blocklist.yaml`](community/lists/blocklist.yaml) 供审计 / Diff / Fork；[`community/lists/official.json`](community/lists/official.json) + [`community/lists/manifest.json`](community/lists/manifest.json) 供扩展下载与校验。
- 扩展刷 X 时**零实时请求**：快照在本地建索引，滚动时间线不逐号查询服务器。
- **误伤有解药**：社区「验证正常」白名单（净抢救票 ≥3，与黑名单镜像）随签名快照一并下发，命中即一票豁免；另有维护者人工筛选的[推荐白名单](community/lists/whitelist.yaml)（含博主简介），两处白名单账号永不标注。
- **打野排位**：拉黑按共识击杀计分，周赛季排名公开可看；玩法见 [`docs/HUNTING.md`](docs/HUNTING.md)。

完整机制与字段见 [`community/README.md`](community/README.md) 与 [`docs/OPEN_SOURCE_GOVERNANCE.md`](docs/OPEN_SOURCE_GOVERNANCE.md)。

## 隐私

- 判断优先在本地完成；社区上报仅限 handle / 分类 / 话术指纹哈希（原文不出设备）/ 外链域名，以及你在关键词页主动提交的短语（匿名，进人工审阅），绝无浏览历史。
- 拉黑通过你已登录 X 会话的内部 Block 接口执行，FeedSieve 服务器碰不到你的 X 账号。
- 自定义关键词、白名单、统计只存在本机（备份文件除外，见[隐私政策](PRIVACY.md)）。

双语隐私政策：[PRIVACY.md](PRIVACY.md)。

## 更新日志

- 完整版本历史：[CHANGELOG.md](CHANGELOG.md)
- 各版本详细工程记录：[docs/RELEASES.md](docs/RELEASES.md)
- 二进制产物：[GitHub Releases](https://github.com/realchendahuang/feedsieve/releases)

## 路线图

当前：v0.8.x 已上架 Chrome 应用商店，社区名单、行业词库、维护后台、名单公示页、打野排位赛均已上线（最新功能随各版本陆续推送，见更新日志）。

- [x] v0.1 能真正拉黑 · v0.2 社区名单闭环 · v0.4 / 0.5 垃圾网络识别 · v0.6 今日战报与分享 · v0.7 商店上架与词库生态 · v0.8 批量拉黑安全预算与公示申请
- [ ] Optional AI（最后一层增强，不是基础依赖）

完整路线见 [`docs/ROADMAP.md`](docs/ROADMAP.md)，长期定位见 [`docs/VISION.md`](docs/VISION.md)，品牌语言见 [`docs/BRAND.md`](docs/BRAND.md)，打野玩法见 [`docs/HUNTING.md`](docs/HUNTING.md)。

## 参与贡献

欢迎 Issue 反馈漏识别 / 误标，提交垃圾话术样本与规则建议，以及 X DOM 兼容修复、UI / UX 改进。

```sh
git clone https://github.com/realchendahuang/feedsieve.git
cd feedsieve
pnpm install
git config core.hooksPath .githooks   # 启用 pre-push 本地质量门禁
```

PR 与 push 由 GitHub Actions 验证（`.github/workflows/verify.yml`：lint / 词库校验 / typecheck / 测试 / 扩展构建 / 依赖审计）；pre-push 钩子执行 `pnpm verify`（lint + 词库校验 + typecheck + 全部测试 + community-api workerd 测试 + 扩展构建）作为提交前的本地门禁。贡献规范见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 本地开发

| 目录 | 内容 |
| --- | --- |
| `packages/detector` | 检测器纯逻辑，可独立单测 |
| `packages/x-adapter` | X 页面读取与原生动作适配 |
| `packages/block-queue` | 持久化拉黑队列 |
| `packages/community-lists` | 社区名单消费协议 |
| `apps/extension` | WXT + React 19 扩展本体（Manifest V3） |
| `apps/community-api` | Cloudflare Workers + Hono + D1 社区后端 |
| `apps/admin` | React + Tailwind 维护后台 |
| `community/` | YAML 名单、词库源、Schema、快照镜像 |

常用命令：

```sh
pnpm verify                 # lint + 词库校验 + typecheck + 全部测试 + 扩展构建
pnpm build:extension        # 构建扩展，产物在 apps/extension/.output/chrome-mv3
pnpm keyword-packs:build    # 由公开词库源构建官方词库 JSON
```

技术栈：WXT · React 19 · TypeScript · Manifest V3 · Vitest · Cloudflare Workers + Hono + D1 + R2（E2E 层 Playwright 规划中，尚未引入）。

## Star History

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=realchendahuang/feedsieve&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=realchendahuang/feedsieve&type=Date" />
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=realchendahuang/feedsieve&type=Date" />
  </picture>
</p>

## License

[MIT](LICENSE)
