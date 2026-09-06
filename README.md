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
</p>

<p align="center">
  <img src="assets/store/screenshot-1-marked.png" width="820" alt="FeedSieve 在时间线上用黄框标注垃圾账号" />
</p>

> [!TIP]
> **为什么是拉黑，而不是隐藏？** 本地隐藏只骗过你自己这一个浏览器；X 原生 Block 全端生效——手机同步消失，被拉黑的号再也无法回复你、@ 你、关注你。误伤也不怕，一键 Unblock 放回来。

## 这是什么

**FeedSieve / 福滤娃** 是一个开源的 X（Twitter）垃圾账号清理工具：高置信社区名单会在你已登录的 `x.com` 页面上用黄框提示；插件没认出的账号，你可以随手点「标记垃圾并拉黑」。所有拉黑都由你明确触发，并真实写入 X 黑名单。

色情引流、机器人刷屏、广告轰炸、互动钓鱼——拉黑发生在 X 服务器上：**手机端同步消失，被拉黑的号再也无法回复你、@ 你、关注你。**

| 方案 | 生效范围 | 阻断互动 |
| --- | --- | --- |
| 本地隐藏（多数同类工具） | 只有装了插件的这个浏览器 | ❌ |
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

1. **装好即用** — 打开 [x.com](https://x.com) 正常刷。高置信垃圾账号会被**黄框**标出，下方一行显示理由与操作按钮，不隐藏任何内容。
2. **单个处理** — 黄框上点**「顺手拉黑」**：走你已登录 X 会话的内部 Block 接口，服务端拉黑，手机端同步消失。
3. **攒一批一起送走** — 黄标账号自动进入**待拉黑列表**；点扩展弹窗里的**「一键拉黑 N 个」**，逐个调用 X 内部 Block 接口执行，成功即移除，失败如实保留并显示原因。
4. **漏网的** — 在任意推文操作栏或扩展面板**「标记垃圾并拉黑」**，你不需要先理解任何检测规则。
5. **误伤了？** — 已拉黑列表里点**「放回来」**一键撤销（X 内部 Unblock 接口）；页面上点「误标？」会把账号加入本地白名单，并作为社区纠错证据。
6. **建议先做一次设置** —
   - **同步关注列表**：把你的关注存为本地私有保护名单，自动排除在一切清理之外，也不上传社区。
   - **关键词规则**：官方 8 个行业词库包共 778 条公开规则，默认只开启「黄推 / 成人引流」，其余 7 个包按需订阅，可整包或逐条关闭；也支持添加自己的词。收录边界见 [`docs/research/KEYWORD_PRESETS.md`](docs/research/KEYWORD_PRESETS.md)。
   - **识别强度**：清爽 / 标准 / 大扫除 三档，悬停可查看各自使用的证据范围。
   - **备份与迁移**：导出 JSON，在新设备预览后合并或替换，不包含任何 X 登录态。

产品流程一览：

```text
刷 X
  ↓
高置信垃圾账号被黄框标注（带理由，不隐藏）
  ↓
标注账号进入「待拉黑列表」（Popup 可查看、可移除）
  ↓
按下「一键拉黑 N 个」
  ↓
逐个调用 X 内部 Block 接口执行（成功即移除，失败如实保留）
  ↓
完成：已送走 N 个，手机端已同步
```

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

- **Layer 1 — 用户明确动作**：主动「标记垃圾并拉黑」是最高质量判断；插件漏识别时始终有入口。
- **Layer 2 — 社区名单**：公开名单命中即黄框；只有至少 3 个独立标记且没有抢救票的账号能进入批量候选。
- **Layer 3 — 本地词库与弱证据复核**：关键词命中给人工确认黄框，永不自动进入批量动作、也不回灌社区；相似内容、可疑域名只在「彻底」档提示复核。
- **本地保护层**：关注列表和个人白名单优先级最高，自动从一切清理中排除。

批量拉黑动作走持久化队列，绝不做 `for (...) click()`。架构边界见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)，X 原生操作见 [`docs/X_ACTION_ADAPTER.md`](docs/X_ACTION_ADAPTER.md)。

## 社区名单，晒在阳光下

> **Open Code + Open Rules + Open Lists + Open Governance**

- 每个安装对每个账号只有一张当前票，`净票数 = 拉黑票 − 误标票`，净票数达到 3 自动进入最终名单，低于 3 自动退出。
- 维护者通过受 Cloudflare Access 保护的 [React 管理后台](apps/admin)维护草稿、显式发布或回退条目。
- **YAML for humans, JSON for machines**：[`community/lists/blocklist.yaml`](community/lists/blocklist.yaml) 供审计 / Diff / Fork；[`community/lists/official.json`](community/lists/official.json) + [`community/lists/manifest.json`](community/lists/manifest.json) 供扩展下载与校验。
- 插件刷 X 时**零实时请求**：快照在本地建索引，滚动时间线不逐号查询服务器。

完整机制与字段见 [`community/README.md`](community/README.md) 与 [`docs/OPEN_SOURCE_GOVERNANCE.md`](docs/OPEN_SOURCE_GOVERNANCE.md)。

## 隐私

- 判断优先在本地完成；社区上报仅限 handle / 分类 / 话术指纹哈希（原文不出设备）/ 外链域名，绝无浏览历史。
- 拉黑通过你已登录 X 会话的内部 Block 接口执行，FeedSieve 服务器碰不到你的 X 账号。
- 自定义关键词、白名单、统计只存在本机。

双语隐私政策：[PRIVACY.md](PRIVACY.md)。

## 更新日志

- 完整版本历史：[CHANGELOG.md](CHANGELOG.md)
- 各版本详细工程记录：[docs/RELEASES.md](docs/RELEASES.md)
- 二进制产物：[GitHub Releases](https://github.com/realchendahuang/feedsieve/releases)

## 路线图

当前：v0.7.x 已上架 Chrome 应用商店，社区名单、行业词库、维护后台均已上线。

- [x] v0.1 能真正拉黑 · v0.2 社区名单闭环 · v0.4 / 0.5 垃圾网络识别 · v0.6 今日战报与分享 · v0.7 商店上架与词库生态
- [ ] Optional AI（最后一层增强，不是基础依赖）
- [ ] 更多平台 Adapter

完整路线见 [`docs/ROADMAP.md`](docs/ROADMAP.md)，长期定位见 [`docs/VISION.md`](docs/VISION.md)，品牌语言见 [`docs/BRAND.md`](docs/BRAND.md)。

## 参与贡献

欢迎 Issue 反馈漏识别 / 误标，提交垃圾话术样本与规则建议，以及 X DOM 兼容修复、UI / UX 改进。

```sh
git clone https://github.com/realchendahuang/feedsieve.git
cd feedsieve
pnpm install
git config core.hooksPath .githooks   # 启用 pre-push 本地质量门禁
```

本项目不用云端 CI，lint / typecheck / test / build（即 `pnpm verify`）在 pre-push 时本地执行。贡献规范见 [CONTRIBUTING.md](CONTRIBUTING.md)。

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

技术栈：WXT · React 19 · TypeScript · Manifest V3 · Vitest · Playwright · Cloudflare Workers + Hono + D1 + R2。

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
